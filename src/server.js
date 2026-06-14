const { spawn } = require("node:child_process");
const express = require("express");
const http = require("node:http");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");
const pty = require("node-pty");
const { WebSocketServer } = require("ws");
const store = require("./serial-line");

const app = express();
const port = Number(process.env.PORT || 3000);
const tn3270Host = process.env.TN3270_HOST || "mainframe";
const tn3270Port = process.env.TN3270_PORT || "3270";
const dockerSocketPath = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
const mainframeContainerName = process.env.MAINFRAME_CONTAINER_NAME || "todo-mainframe-mainframe-1";
const activeTerminals = new Set();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(
  "/vendor/xterm",
  express.static(path.join(__dirname, "..", "node_modules", "@xterm", "xterm")),
);
app.use(
  "/vendor/xterm-fit",
  express.static(path.join(__dirname, "..", "node_modules", "@xterm", "addon-fit")),
);
app.use(
  "/vendor/htmx",
  express.static(path.join(__dirname, "..", "node_modules", "htmx.org", "dist")),
);

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    host: "todo-mainframe",
    transport: "HTTP REST facade over transaction gateway and emulated RJE line",
    cobolHost: process.env.TODO70_COBOL_HOST || process.platform,
    processArch: process.arch,
    serial: store.lineStatus(),
    datastore: "MVS COBOL-owned card-image master file",
  });
});


app.get(
  "/partials/todos",
  asyncRoute(async (_request, response) => {
    response.type("html").send(renderTodos(await store.listTodos()));
  }),
);

app.post(
  "/partials/todos",
  asyncRoute(async (request, response) => {
    await store.createTodo({
      title: request.body?.title,
      status: request.body?.status,
    });
    response.status(201).type("html").send(renderTodos(await store.listTodos()));
  }),
);

app.put(
  "/partials/todos/:id/status",
  asyncRoute(async (request, response) => {
    await store.setTodoStatus(request.params.id, request.body?.status);
    response.type("html").send(renderTodos(await store.listTodos()));
  }),
);

app.delete(
  "/partials/todos/:id",
  asyncRoute(async (request, response) => {
    await store.deleteTodo(request.params.id);
    response.type("html").send(renderTodos(await store.listTodos()));
  }),
);

app.get(
  "/api/todos",
  asyncRoute(async (_request, response) => {
    response.json(await store.listTodos());
  }),
);

app.get("/api/serial", (_request, response) => {
  response.json(store.lineStatus());
});

app.post(
  "/api/todos",
  asyncRoute(async (request, response) => {
    const body = request.body || {};
    const todo = await store.createTodo({
      title: body.title,
      status: body.status,
    });

    response.status(201).json(todo);
  }),
);

app.get(
  "/api/todos/:id",
  asyncRoute(async (request, response) => {
    response.json(await store.getTodo(request.params.id));
  }),
);

app.put(
  "/api/todos/:id",
  asyncRoute(async (request, response) => {
    const body = request.body || {};
    response.json(
      await store.updateTodo(request.params.id, {
        title: body.title,
        status: body.status,
      }),
    );
  }),
);

app.delete(
  "/api/todos/:id",
  asyncRoute(async (request, response) => {
    await store.deleteTodo(request.params.id);
    response.status(204).end();
  }),
);


const installMainframeAppRoute = asyncRoute(async (_request, response) => {
  await installTsoApp();
  response.json({
    ok: true,
    command: "At TSO READY, click Run Mainframe App or type EXEC 'HERC01.TODO74.CLIST'",
    message: "TODO-74 TSO management app submitted to MVS",
  });
});

app.post("/api/mainframe/app/install", installMainframeAppRoute);
app.post("/api/mainframe/viewer/install", installMainframeAppRoute);

app.post("/api/operator/terminal/disconnect", (_request, response) => {
  const dropped = forceDisconnectTerminals();
  response.json({
    ok: true,
    dropped,
    message: dropped
      ? `Dropped ${dropped} live 3270 session${dropped === 1 ? "" : "s"}`
      : "No live 3270 sessions were open",
  });
});

app.post(
  "/api/operator/mainframe/restart",
  asyncRoute(async (_request, response) => {
    const dropped = forceDisconnectTerminals();
    const result = await restartMainframeContainer();
    response.json({
      ok: true,
      dropped,
      message: `Restart requested for ${mainframeContainerName}`,
      ...result,
    });
  }),
);

app.post(
  "/api/terminal",
  asyncRoute(async (request, response) => {
    const command = String(request.body?.command || "").trim();
    const result = await runTerminalCommand(command);
    response.json(result);
  }),
);

async function runTerminalCommand(command) {
  const [verb, ...rest] = command.split(/\s+/);
  const text = rest.join(" ");

  switch ((verb || "").toUpperCase()) {
    case "":
      return { lines: ["READY."] };
    case "HELP":
      return {
        lines: [
          "COMMANDS:",
          "  LIST",
          "  ADD <TEXT>",
          "  DONE <ID>",
          "  OPEN <ID>",
          "  DELETE <ID>",
          "  SHOW <ID>",
          "  STATUS",
        ],
      };
    case "STATUS":
      return {
        lines: [
          "CARRIER DETECTED",
          "HOST TODO-MAINFRAME ONLINE",
          `SERIAL: ${store.lineStatus().name} ${store.lineStatus().baudRate} BAUD`,
          "HOST: HERCULES MVS 3.8J",
          "STORE: MVS COBOL CARD-IMAGE MASTER FILE",
          "GATEWAY: REST TO TRANSACTION MONITOR SHIM",
        ],
      };
    case "LIST": {
      const todos = await store.listTodos();
      return {
        lines: todos.length
          ? todos.map(formatTerminalTodo)
          : ["NO RECORDS IN MASTER FILE."],
      };
    }
    case "ADD": {
      const todo = await store.createTodo({ title: text });
      return { lines: ["RECORD WRITTEN.", formatTerminalTodo(todo)] };
    }
    case "SHOW": {
      if (!rest[0]) return { lines: ["? SHOW REQUIRES ID"] };
      const todo = await store.getTodo(rest[0]);
      return { lines: [formatTerminalTodo(todo)] };
    }
    case "DONE": {
      if (!rest[0]) return { lines: ["? DONE REQUIRES ID"] };
      const updated = await store.setTodoStatus(rest[0], "DONE");
      return { lines: ["RECORD UPDATED.", formatTerminalTodo(updated)] };
    }
    case "OPEN": {
      if (!rest[0]) return { lines: ["? OPEN REQUIRES ID"] };
      const updated = await store.setTodoStatus(rest[0], "OPEN");
      return { lines: ["RECORD UPDATED.", formatTerminalTodo(updated)] };
    }
    case "DELETE":
      if (!rest[0]) return { lines: ["? DELETE REQUIRES ID"] };
      await store.deleteTodo(rest[0]);
      return { lines: ["RECORD DELETED."] };
    default:
      return { lines: [`? UNKNOWN COMMAND: ${verb}`, "TYPE HELP"] };
  }
}

function installTsoApp() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "..", "scripts", "install-tso-app.js")], {
      cwd: path.join(__dirname, ".."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `TSO app installer exited ${code}`));
      }
    });
  });
}

function forceDisconnectTerminals() {
  const sessions = Array.from(activeTerminals);
  for (const session of sessions) {
    session.close("operator reset");
  }
  return sessions.length;
}

function restartMainframeContainer() {
  if (fs.existsSync(dockerSocketPath)) {
    return dockerRequest("POST", `/containers/${encodeURIComponent(mainframeContainerName)}/restart?t=2`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "restart", "mainframe"], {
      cwd: path.join(__dirname, ".."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ method: "docker compose", output: stdout.trim() });
      } else {
        reject(new Error(stderr.trim() || `docker compose restart exited ${code}`));
      }
    });
  });
}

function dockerRequest(method, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: dockerSocketPath,
        method,
        path: requestPath,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({ method: "docker socket", statusCode: response.statusCode });
            return;
          }
          reject(new Error(`Docker API ${response.statusCode}: ${body.trim()}`));
        });
      },
    );

    request.on("error", reject);
    request.end();
  });
}

function renderTodos(todos) {
  if (!todos.length) {
    return '<p class="empty">NO RECORDS IN MASTER FILE.</p>';
  }

  const rows = todos.map((todo) => `
    <article class="todo-card">
      <div>
        <strong>${escapeHtml(todo.title)}</strong>
        <span>${escapeHtml(todo.id)} · ${escapeHtml(todo.status.toUpperCase())}</span>
      </div>
      <div class="todo-actions">
        <button hx-put="/partials/todos/${encodeURIComponent(todo.id)}/status" hx-vals='{"status":"${todo.status === "done" ? "OPEN" : "DONE"}"}' hx-target="#todo-list" hx-swap="innerHTML">${todo.status === "done" ? "Reopen" : "Done"}</button>
        <button class="danger" hx-delete="/partials/todos/${encodeURIComponent(todo.id)}" hx-target="#todo-list" hx-swap="innerHTML">Delete</button>
      </div>
    </article>`);

  return rows.join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTerminalTodo(todo) {
  return `${todo.id.padEnd(8)} ${todo.status.toUpperCase().padEnd(12)} ${todo.title}`;
}

app.use((error, _request, response, _next) => {
  let status = 500;
  if (/not found/i.test(error.message)) {
    status = 404;
  } else if (/required|status must|usage|unknown operation/i.test(error.message)) {
    status = 400;
  } else if (/duplicate/i.test(error.message)) {
    status = 409;
  }
  response.status(status).json({ error: error.message || "internal error" });
});

function attachTerminalGateway(server) {
  const wss = new WebSocketServer({ server, path: "/ws/3270" });

  wss.on("connection", (socket) => {
    const scriptPort = 41000 + Math.floor(Math.random() * 1000);
    let terminal;
    try {
      terminal = pty.spawn(
        "c3270",
        [
          "-model",
          "3279-4-E",
          "-scriptport",
          `127.0.0.1:${scriptPort}`,
          `${tn3270Host}:${tn3270Port}`,
        ],
        {
          name: "xterm-256color",
          cols: 132,
          rows: 43,
          cwd: process.cwd(),
          env: {
            ...process.env,
            TERM: "xterm-256color",
          },
        },
      );
    } catch (error) {
      socket.send(`\r\nUnable to start c3270: ${error.message}\r\n`);
      socket.close();
      return;
    }

    const session = {
      close(reason = "closed") {
        if (socket.readyState === socket.OPEN) {
          socket.send(`\r\n3270 session ${reason}.\r\n`);
          socket.close();
        }
        terminal.kill();
      },
    };
    activeTerminals.add(session);

    terminal.onData((data) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(data);
      }
    });

    terminal.onExit(({ exitCode }) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(`\r\n3270 session ended (${exitCode}).\r\n`);
        socket.close();
      }
    });

    socket.on("message", (message) => {
      const text = message.toString();
      if (text === "TODO70-DISCONNECT") {
        session.close("disconnected");
        return;
      }

      const action = parseTerminalAction(text);
      if (action) {
        send3270Action(scriptPort, action).catch((error) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(`\r\n3270 action failed: ${error.message}\r\n`);
          }
        });
        return;
      }

      terminal.write(text);
    });

    socket.on("close", () => {
      activeTerminals.delete(session);
      terminal.kill();
    });
  });
}

function parseTerminalAction(text) {
  if (!text.startsWith("TODO70-AID:")) {
    return null;
  }

  const aid = text.slice("TODO70-AID:".length).trim().toUpperCase();
  const actions = {
    CLEAR: "Clear()",
    ENTER: "Enter()",
    ERASEEOF: "EraseEOF()",
    RESET: "Reset()",
    PF3: "PF(3)",
    PF24: "PF(24)",
  };

  return actions[aid] || null;
}

function send3270Action(port, action) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: "127.0.0.1", port }, () => {
      client.end(`${action}\n`);
    });

    client.on("error", reject);
    client.on("close", resolve);
  });
}

if (require.main === module) {
  const server = http.createServer(app);
  attachTerminalGateway(server);
  server.listen(port, () => {
    console.log(`todo-mainframe listening on http://localhost:${port}`);
  });
}

module.exports = app;
module.exports.attachTerminalGateway = attachTerminalGateway;
