const modeButtons = document.querySelectorAll("[data-panel]");
const aidButtons = document.querySelectorAll("[data-aid]");
const textButtons = document.querySelectorAll("[data-send-text]");
const sequenceButtons = document.querySelectorAll("[data-send-sequence]");
const refreshButton = document.querySelector("[data-refresh-viewer]");
const disconnectButton = document.querySelector("[data-disconnect-terminal]");
const forceDisconnectButton = document.querySelector("[data-force-disconnect]");
const rebootMainframeButton = document.querySelector("[data-reboot-mainframe]");
const terminalElement = document.querySelector("#terminal");

let term;
let fitAddon;
let socket;
let connected = false;
let connecting = false;

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    for (const other of modeButtons) {
      other.classList.toggle("active", other === button);
      const panel = document.getElementById(other.dataset.panel);
      if (panel) {
        panel.hidden = other !== button;
        panel.classList.toggle("active-panel", other === button);
      }
    }

    document.body.classList.toggle("terminal-page", button.dataset.panel === "terminal-panel");

    if (button.dataset.panel === "terminal-panel") {
      requestAnimationFrame(() => {
        ensureTerminal();
        fitTerminal();
        term.focus();
        connect3270();
      });
    }
  });
});

window.addEventListener("resize", () => fitTerminal());

aidButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    await connect3270();
    sendAid(button.dataset.aid);
    term.focus();
  });
});

textButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    await connect3270();
    sendTextAndEnter(button.dataset.sendText);
    term.focus();
  });
});

sequenceButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    await connect3270();
    button.disabled = true;
    const commands = button.dataset.sendSequence.split("\n").map((command) => command.trim()).filter(Boolean);
    try {
      if (button.dataset.aidBeforeSequence) {
        sendAid(button.dataset.aidBeforeSequence);
        await delay(500);
      }
      await sendCommandSequence(commands);
    } finally {
      button.disabled = false;
      term.focus();
    }
  });
});

disconnectButton?.addEventListener("click", () => {
  disconnect3270();
});

forceDisconnectButton?.addEventListener("click", async () => {
  await operatorAction(forceDisconnectButton, "/api/operator/terminal/disconnect", "Dropping sessions...");
  disconnect3270();
});

rebootMainframeButton?.addEventListener("click", async () => {
  await operatorAction(rebootMainframeButton, "/api/operator/mainframe/restart", "Rebooting...");
  disconnect3270();
  term?.writeln("Wait about 90 seconds, then click Dial-In Terminal again.");
});

refreshButton?.addEventListener("click", async () => {
  ensureTerminal();
  refreshButton.disabled = true;
  const previous = refreshButton.textContent;
  refreshButton.textContent = "Installing...";

  try {
    const response = await fetch("/api/mainframe/app/install", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "refresh failed");
    }
    term.writeln("\r\nTODO-74 management app submitted to MVS.");
    term.writeln(payload.command);
  } catch (error) {
    term.writeln(`\r\nApp install failed: ${error.message}`);
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = previous;
    term.focus();
  }
});

async function operatorAction(button, url, busyText) {
  ensureTerminal();
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = busyText;

  try {
    const response = await fetch(url, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "operator action failed");
    }
    term.writeln(`\r\n${payload.message}`);
  } catch (error) {
    term.writeln(`\r\nOperator action failed: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = previous;
    term.focus();
  }
}

function ensureTerminal() {
  if (term) {
    return;
  }

  term = new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: 15,
    lineHeight: 1.18,
    convertEol: false,
    scrollback: 2000,
    tabStopWidth: 8,
    theme: {
      background: "#061005",
      foreground: "#83ff70",
      cursor: "#dad5ad",
      cursorAccent: "#061005",
      selectionBackground: "#2f6132",
      black: "#061005",
      red: "#ff8a65",
      green: "#83ff70",
      yellow: "#dad56d",
      blue: "#70b7ff",
      magenta: "#e09cff",
      cyan: "#7fffe4",
      white: "#e7ffd6",
      brightBlack: "#3aa84b",
      brightRed: "#ffb870",
      brightGreen: "#c6ffb8",
      brightYellow: "#fff3a0",
      brightBlue: "#a8d7ff",
      brightMagenta: "#ffc0ff",
      brightCyan: "#c4fff3",
      brightWhite: "#ffffff",
    },
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminalElement);
  fitTerminal();

  term.onData((data) => {
    if (connected && socket?.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  });
}

function fitTerminal() {
  if (!fitAddon || terminalElement.offsetParent === null) {
    return;
  }

  try {
    fitAddon.fit();
  } catch (_error) {
    // The terminal may be mid-layout while the tab is being revealed.
  }
}

function connect3270() {
  ensureTerminal();

  if (connected || socket?.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  if (connecting) {
    return waitForOpen();
  }

  connecting = true;
  term.clear();
  term.write("Connecting to Hercules MVS 3.8J TN3270...\r\n");

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${window.location.host}/ws/3270`);

  socket.addEventListener("open", () => {
    connected = true;
    connecting = false;
  });

  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      term.write(event.data);
      return;
    }

    event.data.arrayBuffer().then((buffer) => {
      term.write(new Uint8Array(buffer));
    });
  });

  socket.addEventListener("close", () => {
    connected = false;
    connecting = false;
    socket = undefined;
    term.write("\r\n3270 link closed. Switch away and back to reconnect.\r\n");
  });

  socket.addEventListener("error", () => {
    connecting = false;
    term.write("\r\n3270 link error: check API container logs.\r\n");
  });

  return waitForOpen();
}

function waitForOpen() {
  return new Promise((resolve) => {
    if (socket?.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    const timer = window.setInterval(() => {
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        window.clearInterval(timer);
        resolve();
      } else if (socket.readyState === WebSocket.OPEN) {
        window.clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}

function disconnect3270() {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send("TODO70-DISCONNECT");
    socket.close();
  }
  connected = false;
  connecting = false;
  socket = undefined;
  if (term) {
    term.write("\r\n3270 disconnected. Click Dial-In Terminal to reconnect.\r\n");
    term.focus();
  }
}

function sendAid(aid) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(`TODO70-AID:${aid}`);
  }
}

function sendTextAndEnter(text) {
  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(text);
  window.setTimeout(() => sendAid("ENTER"), 100);
}

async function sendCommandSequence(commands) {
  for (const command of commands) {
    term.writeln(`\r\n→ ${command}`);
    sendTextAndEnter(command);
    await delay(900);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
