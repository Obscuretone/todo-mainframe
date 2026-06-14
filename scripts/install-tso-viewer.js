#!/usr/bin/env node
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

const readerHost = process.env.MAINFRAME_READER_HOST || "127.0.0.1";
const readerPort = Number(process.env.MAINFRAME_READER_PORT || 3505);
const cardStorePath = path.resolve(process.env.MAINFRAME_CARD_STORE || "mainframe/cards/todo70-master.cards");

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  const cards = await readCards();
  const deck = [buildDeck(cards, "HERC03"), buildDeck(cards, "HERC04")].join("\r\n");
  await submitDeck(deck);
  console.log("submitted TSO viewer installers to mainframe reader");
  console.log("TSO command after logon: EXEC 'HERC04.TODO70.CLIST'");
}

async function readCards() {
  try {
    const raw = await fs.readFile(cardStorePath, "utf8");
    return raw.split(/\r?\n/).filter((line) => line.trim());
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function buildDeck(cards, user) {
  const clistLines = [
    "PROC 0",
    "WRITE TODO-MAINFRAME TODO VIEWER",
    "WRITE TYPE REFRESH IN THE WEB PROJECT TO REINSTALL SNAPSHOT",
    "WRITE ",
    "WRITE ID       STATUS  TITLE",
    "WRITE -------- ------- ----------------------------------------",
  ];

  if (!cards.length) {
    clistLines.push("WRITE NO RECORDS IN MASTER FILE");
  } else {
    for (const card of cards) {
      const id = card.slice(0, 8).trim();
      const status = card.slice(8, 12).trim();
      const title = card.slice(40, 80).trim();
      clistLines.push(`WRITE ${fixed(`${id} ${status}`, 16)} ${title || "(NO TITLE)"}`);
    }
  }

  clistLines.push("EXIT");

  return [
    "//TODOVWR JOB (TODO),'TSO VIEW',CLASS=A,MSGCLASS=A,MSGLEVEL=(1,1),",
    `${"//"}        USER=${user},PASSWORD=PASS4U`,
    "//DEL     EXEC PGM=IEFBR14",
    `${"//OLD     DD DSN="}${user}.TODO70.CLIST,DISP=(MOD,DELETE,DELETE),`,
    "//        UNIT=SYSDA,SPACE=(TRK,(1,1)),",
    "//        DCB=(DSORG=PS,RECFM=FB,LRECL=80,BLKSIZE=3120)",
    "//COPY    EXEC PGM=IEBGENER",
    "//SYSPRINT DD SYSOUT=*",
    `${"//SYSUT2   DD DSN="}${user}.TODO70.CLIST,DISP=(NEW,CATLG,DELETE),`,
    "//        UNIT=SYSDA,SPACE=(TRK,(1,1)),",
    "//        DCB=(DSORG=PS,RECFM=FB,LRECL=80,BLKSIZE=3120)",
    "//SYSUT1   DD *",
    ...clistLines.map((line) => fixed(line, 80)),
    "/*",
    "//SYSIN    DD DUMMY",
    "//",
    "",
  ].join("\r\n");
}

function fixed(value, length) {
  return String(value ?? "").replace(/[\r\n]/g, " ").padEnd(length, " ").slice(0, length);
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
      reject(error);
    });

    socket.on("close", () => {
      if (submitted) {
        resolve();
      }
    });
  });
}
