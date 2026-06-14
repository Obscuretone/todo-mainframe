const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

const readerHost = process.env.MAINFRAME_READER_HOST || "mainframe";
const readerPort = Number(process.env.MAINFRAME_READER_PORT || 3505);
const spoolDir = path.resolve(process.env.MAINFRAME_SPOOL_DIR || "mainframe/prt");
const cardStorePath = path.resolve(process.env.MAINFRAME_CARD_STORE || "mainframe/cards/todo70-master.cards");
const jobTimeoutMs = Number(process.env.MAINFRAME_JOB_TIMEOUT_MS || 30000);
const pollMs = Number(process.env.MAINFRAME_POLL_MS || 500);

function parseTodo(line) {
  const [kind, id, status, created, updated, ...titleParts] = line.split("|");
  if (kind !== "TODO") {
    return null;
  }

  return {
    id: cleanField(id),
    status: cleanField(status).toLowerCase(),
    createdAt: stampToIso(cleanField(created)),
    updatedAt: stampToIso(cleanField(updated)),
    title: cleanField(titleParts.join("|")),
  };
}

function stampToIso(stamp) {
  if (!/^\d{14}$/.test(stamp)) {
    return stamp;
  }

  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z`;
}

async function invoke(args) {
  const operation = args[0];
  const fields = args.slice(1);
  const jobName = makeJobName();
  const submittedAfter = Date.now();
  const cards = await readCardStore();
  const deck = buildDeck(jobName, operation, fields, cards);

  await submitDeck(deck);
  const output = await waitForSpoolResult(jobName, submittedAfter);
  const lines = extractResultLines(output, jobName);
  const errorLine = lines.find((line) => line.startsWith("ERR|"));
  if (errorLine) {
    throw new Error(errorLine.split("|").slice(1).join(": "));
  }

  const rewrittenCards = lines
    .filter((line) => line.startsWith("CARD|"))
    .map((line) => fixed(line.slice(5), 80));

  if (rewrittenCards.length || ["CREATE", "UPDATE", "SETSTATUS", "DELETE", "LIST", "GET"].includes(operation)) {
    await writeCardStore(rewrittenCards);
  }

  return lines.filter((line) => line.startsWith("TODO|") || line.startsWith("OK|"));
}

function buildDeck(jobName, operation, fields, cards) {
  const sysin = buildSysin(operation, fields);
  const stateCards = cards.map((card) => fixed(card, 80));
  const stateCount = String(stateCards.length).padStart(3, "0");

  return [
    `//${jobName} JOB (TODO),'TODO-70',CLASS=A,MSGCLASS=A,MSGLEVEL=(1,1)`,
    "//* TODO-70 REST GATEWAY SUBMITTED THIS CARD DECK",
    "//* THE API HAS NO LOCAL COBOL FALLBACK; THIS JOB MUST RUN ON MVS.",
    "//COBRUN  EXEC COBUCLG",
    "//COB.SYSIN DD *",
    ...todoCobolSource(jobName, makeStamp()),
    "/*",
    "//GO.SYSOUT DD SYSOUT=*",
    "//GO.SYSIN DD *",
    sysin,
    stateCount,
    ...stateCards,
    "/*",
    "//",
    "",
  ].join("\r\n");
}

function buildSysin(operation, fields) {
  let id = "";
  let status = "";
  let title = "";

  switch (operation) {
    case "CREATE":
      status = fields[0];
      title = fields[1];
      break;
    case "UPDATE":
      id = fields[0];
      status = fields[1];
      title = fields[2];
      break;
    case "SETSTATUS":
      id = fields[0];
      status = fields[1];
      break;
    case "GET":
    case "DELETE":
      id = fields[0];
      break;
  }

  return `${fixed(operation, 12)}${fixed(id, 8)}${fixed(status, 4)}${fixed(title, 40)}`;
}

function todoCobolSource(jobName, stamp) {
  return [
    "       IDENTIFICATION DIVISION.",
    "       PROGRAM-ID. TODO70MF.",
    "       DATA DIVISION.",
    "       WORKING-STORAGE SECTION.",
    "       01 FOUND-FLAG PIC X VALUE 'N'.",
    "       01 T-COUNT PIC 999 VALUE 0.",
    "       01 LOAD-COUNT PIC 999 VALUE 0.",
    "       01 IDX PIC 999 VALUE 0.",
    "       01 SLOT-IDX PIC 999 VALUE 0.",
    `       01 WS-ID PIC X(8) VALUE '${jobName}'.`,
    `       01 WS-NOW PIC X(14) VALUE '${stamp}'.`,
    "       01 INPUT-REC.",
    "          05 IN-OP PIC X(12).",
    "          05 IN-ID PIC X(8).",
    "          05 IN-STATUS-FLD PIC X(4).",
    "          05 IN-TITLE PIC X(40).",
    "       01 STATE-REC.",
    "          05 S-ID PIC X(8).",
    "          05 S-STATUS PIC X(4).",
    "          05 S-CREATED PIC X(14).",
    "          05 S-UPDATED PIC X(14).",
    "          05 S-TITLE PIC X(40).",
    "       01 TODO-TABLE.",
    "          05 TODO-ROW OCCURS 200 TIMES.",
    "             10 T-ID PIC X(8).",
    "             10 T-STATUS PIC X(4).",
    "             10 T-CREATED PIC X(14).",
    "             10 T-UPDATED PIC X(14).",
    "             10 T-TITLE PIC X(40).",
    "       PROCEDURE DIVISION.",
    `           DISPLAY 'TODO70-RESULT-BEGIN ${jobName}'.`,
    "           ACCEPT INPUT-REC.",
    "           ACCEPT LOAD-COUNT.",
    "           PERFORM LOAD-STATE THRU LOAD-DONE.",
    "           PERFORM PREPARE-STATUS THRU PREPARE-DONE.",
    "           IF IN-OP = 'LIST        ' GO TO DO-LIST.",
    "           IF IN-OP = 'GET         ' GO TO DO-GET.",
    "           IF IN-OP = 'CREATE      ' GO TO DO-CREATE.",
    "           IF IN-OP = 'UPDATE      ' GO TO DO-UPDATE.",
    "           IF IN-OP = 'SETSTATUS   ' GO TO DO-STATUS.",
    "           IF IN-OP = 'DELETE      ' GO TO DO-DELETE.",
    "           DISPLAY 'ERR|UNKNOWN OPERATION'.",
    "           GO TO FINISH.",
    "       DO-LIST.",
    "           PERFORM LIST-TODOS THRU LIST-DONE.",
    "           PERFORM DUMP-STATE THRU DUMP-DONE.",
    "           GO TO FINISH.",
    "       DO-GET.",
    "           PERFORM FIND-INPUT THRU FIND-DONE.",
    "           IF FOUND-FLAG = 'Y' PERFORM DISPLAY-FOUND.",
    "           IF FOUND-FLAG NOT = 'Y' DISPLAY 'ERR|NOT FOUND'.",
    "           PERFORM DUMP-STATE THRU DUMP-DONE.",
    "           GO TO FINISH.",
    "       DO-CREATE.",
    "           IF IN-TITLE = SPACES GO TO CREATE-ERR.",
    "           IF T-COUNT > 199 GO TO FULL-ERR.",
    "           ADD 1 TO T-COUNT.",
    "           MOVE T-COUNT TO SLOT-IDX.",
    "           MOVE WS-ID TO T-ID(SLOT-IDX).",
    "           MOVE IN-STATUS-FLD TO T-STATUS(SLOT-IDX).",
    "           MOVE WS-NOW TO T-CREATED(SLOT-IDX).",
    "           MOVE WS-NOW TO T-UPDATED(SLOT-IDX).",
    "           MOVE IN-TITLE TO T-TITLE(SLOT-IDX).",
    "           PERFORM DISPLAY-FOUND.",
    "           PERFORM DUMP-STATE THRU DUMP-DONE.",
    "           GO TO FINISH.",
    "       DO-UPDATE.",
    "           IF IN-TITLE = SPACES GO TO CREATE-ERR.",
    "           PERFORM FIND-INPUT THRU FIND-DONE.",
    "           IF FOUND-FLAG NOT = 'Y' GO TO NOTFOUND-ERR.",
    "           MOVE IN-STATUS-FLD TO T-STATUS(SLOT-IDX).",
    "           MOVE WS-NOW TO T-UPDATED(SLOT-IDX).",
    "           MOVE IN-TITLE TO T-TITLE(SLOT-IDX).",
    "           PERFORM DISPLAY-FOUND.",
    "           PERFORM DUMP-STATE THRU DUMP-DONE.",
    "           GO TO FINISH.",
    "       DO-STATUS.",
    "           PERFORM FIND-INPUT THRU FIND-DONE.",
    "           IF FOUND-FLAG NOT = 'Y' GO TO NOTFOUND-ERR.",
    "           MOVE IN-STATUS-FLD TO T-STATUS(SLOT-IDX).",
    "           MOVE WS-NOW TO T-UPDATED(SLOT-IDX).",
    "           PERFORM DISPLAY-FOUND.",
    "           PERFORM DUMP-STATE THRU DUMP-DONE.",
    "           GO TO FINISH.",
    "       DO-DELETE.",
    "           PERFORM FIND-INPUT THRU FIND-DONE.",
    "           IF FOUND-FLAG NOT = 'Y' GO TO NOTFOUND-ERR.",
    "           IF SLOT-IDX = T-COUNT GO TO DELETE-LAST.",
    "           MOVE T-ID(T-COUNT) TO T-ID(SLOT-IDX).",
    "           MOVE T-STATUS(T-COUNT) TO T-STATUS(SLOT-IDX).",
    "           MOVE T-CREATED(T-COUNT) TO T-CREATED(SLOT-IDX).",
    "           MOVE T-UPDATED(T-COUNT) TO T-UPDATED(SLOT-IDX).",
    "           MOVE T-TITLE(T-COUNT) TO T-TITLE(SLOT-IDX).",
    "       DELETE-LAST.",
    "           SUBTRACT 1 FROM T-COUNT.",
    "           DISPLAY 'OK|DELETED|' IN-ID.",
    "           PERFORM DUMP-STATE THRU DUMP-DONE.",
    "           GO TO FINISH.",
    "       CREATE-ERR.",
    "           DISPLAY 'ERR|TITLE IS REQUIRED'.",
    "           GO TO FINISH.",
    "       FULL-ERR.",
    "           DISPLAY 'ERR|MASTER FILE FULL'.",
    "           GO TO FINISH.",
    "       NOTFOUND-ERR.",
    "           DISPLAY 'ERR|NOT FOUND'.",
    "           GO TO FINISH.",
    "       PREPARE-STATUS.",
    "           IF IN-STATUS-FLD = SPACES MOVE 'OPEN' TO IN-STATUS-FLD.",
    "           IF IN-STATUS-FLD = 'OPEN' GO TO PREPARE-DONE.",
    "           IF IN-STATUS-FLD = 'DONE' GO TO PREPARE-DONE.",
    "           DISPLAY 'ERR|STATUS MUST BE OPEN OR DONE'.",
    "           GO TO FINISH.",
    "       PREPARE-DONE.",
    "       LOAD-STATE.",
    "           MOVE 1 TO IDX.",
    "       LOAD-LOOP.",
    "           IF IDX > LOAD-COUNT GO TO LOAD-DONE.",
    "           ACCEPT STATE-REC.",
    "           IF T-COUNT > 199 GO TO LOAD-NEXT.",
    "           ADD 1 TO T-COUNT.",
    "           MOVE T-COUNT TO SLOT-IDX.",
    "           MOVE S-ID TO T-ID(SLOT-IDX).",
    "           MOVE S-STATUS TO T-STATUS(SLOT-IDX).",
    "           MOVE S-CREATED TO T-CREATED(SLOT-IDX).",
    "           MOVE S-UPDATED TO T-UPDATED(SLOT-IDX).",
    "           MOVE S-TITLE TO T-TITLE(SLOT-IDX).",
    "       LOAD-NEXT.",
    "           ADD 1 TO IDX.",
    "           GO TO LOAD-LOOP.",
    "       LOAD-DONE.",
    "       FIND-INPUT.",
    "           MOVE 'N' TO FOUND-FLAG.",
    "           MOVE 1 TO IDX.",
    "       FIND-LOOP.",
    "           IF IDX > T-COUNT GO TO FIND-DONE.",
    "           IF T-ID(IDX) = IN-ID GO TO FIND-HIT.",
    "           ADD 1 TO IDX.",
    "           GO TO FIND-LOOP.",
    "       FIND-HIT.",
    "           MOVE 'Y' TO FOUND-FLAG.",
    "           MOVE IDX TO SLOT-IDX.",
    "       FIND-DONE.",
    "       LIST-TODOS.",
    "           MOVE 1 TO IDX.",
    "       LIST-LOOP.",
    "           IF IDX > T-COUNT GO TO LIST-DONE.",
    "           MOVE IDX TO SLOT-IDX.",
    "           PERFORM DISPLAY-FOUND.",
    "           ADD 1 TO IDX.",
    "           GO TO LIST-LOOP.",
    "       LIST-DONE.",
    "       DISPLAY-FOUND.",
    "           DISPLAY 'TODO|' T-ID(SLOT-IDX) '|' T-STATUS(SLOT-IDX) '|'",
    "               T-CREATED(SLOT-IDX) '|' T-UPDATED(SLOT-IDX) '|'",
    "               T-TITLE(SLOT-IDX).",
    "       DUMP-STATE.",
    "           MOVE 1 TO IDX.",
    "       DUMP-LOOP.",
    "           IF IDX > T-COUNT GO TO DUMP-DONE.",
    "           DISPLAY 'CARD|' T-ID(IDX) T-STATUS(IDX) T-CREATED(IDX)",
    "               T-UPDATED(IDX) T-TITLE(IDX).",
    "           ADD 1 TO IDX.",
    "           GO TO DUMP-LOOP.",
    "       DUMP-DONE.",
    "       FINISH.",
    `           DISPLAY 'TODO70-RESULT-END ${jobName}'.`,
    "           STOP RUN.",
  ];
}

async function readCardStore() {
  try {
    const raw = await fs.readFile(cardStorePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => fixed(line, 96))
      .filter((line) => line.trim());
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeCardStore(cards) {
  await fs.mkdir(path.dirname(cardStorePath), { recursive: true });
  await fs.writeFile(cardStorePath, cards.map((card) => fixed(card, 80)).join("\n") + (cards.length ? "\n" : ""));
}

function submitDeck(deck) {
  return new Promise((resolve, reject) => {
    let submitted = false;
    const socket = net.createConnection({ host: readerHost, port: readerPort }, () => {
      submitted = true;
      socket.write(deck.endsWith("\r\n") ? deck : `${deck}\r\n`);
      socket.end();
    });

    socket.on("error", (error) => {
      if (submitted && error.code === "ECONNRESET") {
        return;
      }

      reject(
        new Error(
          `mainframe reader unavailable at ${readerHost}:${readerPort}; no local COBOL fallback is configured (${error.message})`,
        ),
      );
    });

    socket.on("close", () => {
      if (submitted) {
        resolve();
      }
    });
  });
}

async function waitForSpoolResult(jobName, submittedAfter) {
  const deadline = Date.now() + jobTimeoutMs;

  while (Date.now() < deadline) {
    const outputs = await readRecentSpoolFiles(submittedAfter);
    const match = outputs.find((output) => hasRuntimeMarker(output, jobName));

    if (match) {
      return match;
    }

    await sleep(pollMs);
  }

  throw new Error(
    `mainframe job ${jobName} did not produce spool output within ${jobTimeoutMs}ms; no local COBOL fallback is configured`,
  );
}

async function readRecentSpoolFiles(submittedAfter) {
  let entries;
  try {
    entries = await fs.readdir(spoolDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`mainframe spool directory unavailable at ${spoolDir}: ${error.message}`);
  }

  const outputs = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) {
      continue;
    }

    const filePath = path.join(spoolDir, entry.name);
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs + 1000 < submittedAfter) {
      continue;
    }

    outputs.push(await fs.readFile(filePath, "utf8"));
  }

  return outputs;
}

function extractResultLines(output, jobName) {
  const begin = `TODO70-RESULT-BEGIN ${jobName}`;
  const end = `TODO70-RESULT-END ${jobName}`;
  const lines = output.split(/\r?\n/).map(cleanPrinterLine);
  const beginIndex = lines.findIndex((line) => line === begin);
  const endIndex = lines.findIndex((line, index) => index > beginIndex && line === end);

  if (beginIndex === -1 || endIndex === -1) {
    throw new Error(`mainframe job ${jobName} spool output is missing TODO-70 result markers`);
  }

  return lines.slice(beginIndex + 1, endIndex).filter(Boolean);
}

function hasRuntimeMarker(output, jobName) {
  const begin = `TODO70-RESULT-BEGIN ${jobName}`;
  return output.split(/\r?\n/).map(cleanPrinterLine).some((line) => line === begin);
}

function cleanPrinterLine(line) {
  return line.replace(/^\d?\s*/, "").trimEnd().trimStart();
}

function makeJobName() {
  const suffix = Date.now().toString(36).slice(-5).toUpperCase();
  return `TD${suffix}`.slice(0, 8);
}

function makeStamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function fixed(value, length) {
  return cardSafe(value).toUpperCase().padEnd(length, " ").slice(0, length);
}

function cardSafe(value) {
  return String(value ?? " ")
    .replace(/[\r\n]/g, " ")
    .replace(/'/g, " ")
    .slice(0, 80);
}

function cleanField(value) {
  return String(value ?? "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  invoke,
  parseTodo,
};
