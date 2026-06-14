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
  await submitDeck(buildDeck("HERC01", "CUL8TR", "HERC01", cards));
  console.log("submitted TODO74 TSO management app installer");
  console.log("TSO launch: allocate terminal DDs, then CALL 'HERC01.TODO74.LOAD(TODO74)'");
}

async function readCards() {
  try {
    const raw = await fs.readFile(cardStorePath, "utf8");
    return raw.split(/\r?\n/).filter((line) => line.trim());
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function buildDeck(jobUser, jobPassword, targetUser, cards) {
  const dataCards = cards.length ? cards.map(toDataCard) : [fixed("", 80)];
  return [
    "//TODOAPP JOB (TODO),'TODO APP',CLASS=A,MSGCLASS=A,MSGLEVEL=(1,1),",
    `//        USER=${jobUser},PASSWORD=${jobPassword}`,
    "//DEL     EXEC PGM=IEFBR14",
    `//D1      DD DSN=${targetUser}.TODO70.DATA,DISP=(MOD,DELETE,DELETE),`,
    "//        UNIT=SYSDA,SPACE=(TRK,(1,1)),",
    "//        DCB=(DSORG=PS,RECFM=FB,LRECL=80,BLKSIZE=3120)",
    `//D2      DD DSN=${targetUser}.TODO74.LOAD,DISP=(MOD,DELETE,DELETE),`,
    "//        UNIT=SYSDA,SPACE=(TRK,(2,1,5)),",
    "//        DCB=(DSORG=PO,RECFM=U,BLKSIZE=1024)",
    `//D3      DD DSN=${targetUser}.TODO74.CLIST,DISP=(MOD,DELETE,DELETE),`,
    "//        UNIT=SYSDA,SPACE=(TRK,(1,1)),",
    "//        DCB=(DSORG=PS,RECFM=FB,LRECL=80,BLKSIZE=3120)",
    "//DATA    EXEC PGM=IEBGENER",
    "//SYSPRINT DD SYSOUT=*",
    `//SYSUT2   DD DSN=${targetUser}.TODO70.DATA,DISP=(NEW,CATLG,DELETE),`,
    "//        UNIT=SYSDA,SPACE=(TRK,(1,1)),",
    "//        DCB=(DSORG=PS,RECFM=FB,LRECL=80,BLKSIZE=3120)",
    "//SYSUT1   DD *",
    ...dataCards,
    "/*",
    "//SYSIN    DD DUMMY",
    "//LOAD    EXEC PGM=IEFBR14",
    `//SYSLMOD DD DSN=${targetUser}.TODO74.LOAD,DISP=(NEW,CATLG,DELETE),`,
    "//        UNIT=SYSDA,SPACE=(1024,(50,20,5)),",
    "//        DCB=(DSORG=PO,RECFM=U,BLKSIZE=1024)",
    "//CLIST   EXEC PGM=IEBGENER",
    "//SYSPRINT DD SYSOUT=*",
    `//SYSUT2   DD DSN=${targetUser}.TODO74.CLIST,DISP=(NEW,CATLG,DELETE),`,
    "//        UNIT=SYSDA,SPACE=(TRK,(1,1)),",
    "//        DCB=(DSORG=PS,RECFM=FB,LRECL=80,BLKSIZE=3120)",
    "//SYSUT1   DD *",
    ...clist(targetUser),
    "/*",
    "//SYSIN    DD DUMMY",
    "//COB     EXEC PGM=IKFCBL00,",
    "//        PARM='LOAD,SUPMAP,SIZE=2048K,BUF=1024K'",
    "//SYSPRINT DD SYSOUT=*",
    "//SYSUT1   DD UNIT=SYSDA,SPACE=(460,(700,100))",
    "//SYSUT2   DD UNIT=SYSDA,SPACE=(460,(700,100))",
    "//SYSUT3   DD UNIT=SYSDA,SPACE=(460,(700,100))",
    "//SYSUT4   DD UNIT=SYSDA,SPACE=(460,(700,100))",
    "//SYSLIN   DD DSN=&&LOADSET,DISP=(MOD,PASS),UNIT=SYSDA,",
    "//        SPACE=(80,(500,100))",
    "//SYSIN    DD *",
    ...cobolSource(),
    "/*",
    "//LKED    EXEC PGM=IEWL,PARM='LIST,XREF,LET',COND=(5,LT,COB)",
    "//SYSLIN   DD DSN=&&LOADSET,DISP=(OLD,DELETE)",
    "//         DD DDNAME=SYSIN",
    `//SYSLMOD  DD DSN=${targetUser}.TODO74.LOAD(TODO74),DISP=SHR`,
    "//SYSLIB   DD DSN=SYS1.COBLIB,DISP=SHR",
    "//SYSUT1   DD UNIT=SYSDA,SPACE=(1024,(50,20))",
    "//SYSPRINT DD SYSOUT=*",
    "//",
    "",
  ].join("\r\n");
}

function clist(user) {
  return [
    "PROC 0",
    "ALLOC F(SYSIN) DA(*) REUSE",
    "ALLOC F(SYSOUT) DA(*) REUSE",
    "ALLOC F(SYSPRINT) DA(*) REUSE",
    `ALLOC F(TODODATA) DA('${user}.TODO70.DATA') OLD REUSE`,
    `CALL '${user}.TODO74.LOAD(TODO74)'`,
    "SET RC=&LASTCC",
    "FREE F(SYSIN SYSOUT SYSPRINT TODODATA)",
    "EXIT",
  ].map((line) => fixed(line, 80));
}

function toDataCard(card) {
  const id = fixed(card.slice(0, 8).trim(), 8);
  const status = fixed(card.slice(8, 12).trim() || "OPEN", 4);
  const title = fixed(card.slice(40, 80).trim(), 40);
  return fixed(`${id}${status}${title}`, 80);
}

function cobolSource() {
  return [
    "       IDENTIFICATION DIVISION.",
    "       PROGRAM-ID. TODO74.",
    "       ENVIRONMENT DIVISION.",
    "       INPUT-OUTPUT SECTION.",
    "       FILE-CONTROL.",
    "           SELECT TODO-FILE ASSIGN TO UT-S-TODODATA.",
    "       DATA DIVISION.",
    "       FILE SECTION.",
    "       FD TODO-FILE",
    "           RECORDING MODE IS F",
    "           LABEL RECORDS ARE STANDARD",
    "           BLOCK CONTAINS 0 RECORDS.",
    "       01 FILE-REC.",
    "          05 F-ID PIC X(8).",
    "          05 F-STATUS PIC X(4).",
    "          05 F-TITLE PIC X(40).",
    "          05 F-FILLER PIC X(28).",
    "       WORKING-STORAGE SECTION.",
    "       01 T-COUNT PIC 999 VALUE 0.",
    "       01 IDX PIC 999 VALUE 0.",
    "       01 SLOT PIC 999 VALUE 0.",
    "       01 CURSOR-IDX PIC 999 VALUE 0.",
    "       01 FOUND-FLAG PIC X VALUE 'N'.",
    "       01 NEXT-ID-N PIC 9(8) VALUE 0.",
    "       01 INPUT-REC.",
    "          05 IN-CMD PIC X.",
    "          05 IN-REST PIC X(79).",
    "       01 IN-ID PIC X(8).",
    "       01 IN-TITLE PIC X(40).",
    "       01 TODO-TABLE.",
    "          05 TODO-ROW OCCURS 100 TIMES.",
    "             10 T-ID PIC X(8).",
    "             10 T-STATUS PIC X(4).",
    "             10 T-TITLE PIC X(40).",
    "       PROCEDURE DIVISION.",
    "           PERFORM LOAD-DATA THRU LOAD-DONE.",
    "           DISPLAY 'TODO-74 MAINFRAME MANAGEMENT V6'.",
    "           PERFORM SHOW-HELP THRU SHOW-HELP-DONE.",
    "       MENU.",
    "           DISPLAY 'CMD L/N/P A/D/O/X H/Q:'.",
    "           ACCEPT INPUT-REC.",
    "           IF IN-CMD = 'L' GO TO DO-LIST.",
    "           IF IN-CMD = 'N' GO TO DO-NEXT.",
    "           IF IN-CMD = 'P' GO TO DO-PREV.",
    "           IF IN-CMD = 'A' GO TO DO-ADD.",
    "           IF IN-CMD = 'D' GO TO DO-DONE.",
    "           IF IN-CMD = 'O' GO TO DO-OPEN.",
    "           IF IN-CMD = 'X' GO TO DO-DELETE.",
    "           IF IN-CMD = 'H' GO TO DO-HELP.",
    "           IF IN-CMD = 'Q' GO TO FINISH.",
    "           IF IN-CMD = ' ' GO TO MENU.",
    "           DISPLAY 'UNKNOWN OPTION'.",
    "           GO TO MENU.",
    "       DO-HELP.",
    "           PERFORM SHOW-HELP THRU SHOW-HELP-DONE.",
    "           GO TO MENU.",
    "       DO-LIST.",
    "           IF T-COUNT = 0 GO TO LIST-EMPTY.",
    "           MOVE 1 TO CURSOR-IDX.",
    "           PERFORM SHOW-CURRENT THRU SHOW-CURRENT-DONE.",
    "           GO TO MENU.",
    "       DO-NEXT.",
    "           IF T-COUNT = 0 GO TO LIST-EMPTY.",
    "           IF CURSOR-IDX = 0 MOVE 1 TO CURSOR-IDX.",
    "           IF CURSOR-IDX < T-COUNT ADD 1 TO CURSOR-IDX.",
    "           PERFORM SHOW-CURRENT THRU SHOW-CURRENT-DONE.",
    "           GO TO MENU.",
    "       DO-PREV.",
    "           IF T-COUNT = 0 GO TO LIST-EMPTY.",
    "           IF CURSOR-IDX = 0 MOVE 1 TO CURSOR-IDX.",
    "           IF CURSOR-IDX > 1 SUBTRACT 1 FROM CURSOR-IDX.",
    "           PERFORM SHOW-CURRENT THRU SHOW-CURRENT-DONE.",
    "           GO TO MENU.",
    "       DO-ADD.",
    "           DISPLAY 'TITLE:'.",
    "           ACCEPT IN-TITLE.",
    "           IF IN-TITLE = SPACES GO TO TITLE-ERR.",
    "           IF T-COUNT > 99 GO TO FULL-ERR.",
    "           ADD 1 TO T-COUNT.",
    "           MOVE T-COUNT TO NEXT-ID-N.",
    "           MOVE NEXT-ID-N TO T-ID(T-COUNT).",
    "           MOVE 'OPEN' TO T-STATUS(T-COUNT).",
    "           MOVE IN-TITLE TO T-TITLE(T-COUNT).",
    "           MOVE T-COUNT TO CURSOR-IDX.",
    "           PERFORM SAVE-DATA THRU SAVE-DONE.",
    "           DISPLAY 'ADDED'.",
    "           PERFORM SHOW-CURRENT THRU SHOW-CURRENT-DONE.",
    "           GO TO MENU.",
    "       DO-DONE.",
    "           DISPLAY 'ID TO MARK DONE:'.",
    "           ACCEPT IN-ID.",
    "           PERFORM FIND-ID THRU FIND-DONE.",
    "           IF FOUND-FLAG NOT = 'Y' GO TO NOTFOUND-ERR.",
    "           MOVE 'DONE' TO T-STATUS(SLOT).",
    "           MOVE SLOT TO CURSOR-IDX.",
    "           PERFORM SAVE-DATA THRU SAVE-DONE.",
    "           DISPLAY 'UPDATED'.",
    "           PERFORM SHOW-CURRENT THRU SHOW-CURRENT-DONE.",
    "           GO TO MENU.",
    "       DO-OPEN.",
    "           DISPLAY 'ID TO REOPEN:'.",
    "           ACCEPT IN-ID.",
    "           PERFORM FIND-ID THRU FIND-DONE.",
    "           IF FOUND-FLAG NOT = 'Y' GO TO NOTFOUND-ERR.",
    "           MOVE 'OPEN' TO T-STATUS(SLOT).",
    "           MOVE SLOT TO CURSOR-IDX.",
    "           PERFORM SAVE-DATA THRU SAVE-DONE.",
    "           DISPLAY 'UPDATED'.",
    "           PERFORM SHOW-CURRENT THRU SHOW-CURRENT-DONE.",
    "           GO TO MENU.",
    "       DO-DELETE.",
    "           DISPLAY 'ID TO DELETE:'.",
    "           ACCEPT IN-ID.",
    "           PERFORM FIND-ID THRU FIND-DONE.",
    "           IF FOUND-FLAG NOT = 'Y' GO TO NOTFOUND-ERR.",
    "           IF SLOT = T-COUNT GO TO DELETE-LAST.",
    "           MOVE T-ID(T-COUNT) TO T-ID(SLOT).",
    "           MOVE T-STATUS(T-COUNT) TO T-STATUS(SLOT).",
    "           MOVE T-TITLE(T-COUNT) TO T-TITLE(SLOT).",
    "       DELETE-LAST.",
    "           SUBTRACT 1 FROM T-COUNT.",
    "           IF T-COUNT = 0 GO TO DELETE-SAVE.",
    "           IF SLOT > T-COUNT MOVE T-COUNT TO SLOT.",
    "           MOVE SLOT TO CURSOR-IDX.",
    "       DELETE-SAVE.",
    "           PERFORM SAVE-DATA THRU SAVE-DONE.",
    "           DISPLAY 'DELETED'.",
    "           IF T-COUNT = 0 GO TO MENU.",
    "           PERFORM SHOW-CURRENT THRU SHOW-CURRENT-DONE.",
    "           GO TO MENU.",
    "       TITLE-ERR.",
    "           DISPLAY 'TITLE IS REQUIRED'.",
    "           GO TO MENU.",
    "       FULL-ERR.",
    "           DISPLAY 'TODO FILE FULL'.",
    "           GO TO MENU.",
    "       NOTFOUND-ERR.",
    "           DISPLAY 'ID NOT FOUND'.",
    "           GO TO MENU.",
    "       LOAD-DATA.",
    "           OPEN INPUT TODO-FILE.",
    "       LOAD-LOOP.",
    "           READ TODO-FILE AT END GO TO LOAD-CLOSE.",
    "           IF F-ID = SPACES GO TO LOAD-LOOP.",
    "           IF T-COUNT > 99 GO TO LOAD-LOOP.",
    "           ADD 1 TO T-COUNT.",
    "           MOVE F-ID TO T-ID(T-COUNT).",
    "           MOVE F-STATUS TO T-STATUS(T-COUNT).",
    "           MOVE F-TITLE TO T-TITLE(T-COUNT).",
    "           GO TO LOAD-LOOP.",
    "       LOAD-CLOSE.",
    "           CLOSE TODO-FILE.",
    "       LOAD-DONE.",
    "           MOVE 0 TO IDX.",
    "       LIST-EMPTY.",
    "           DISPLAY 'NO TODOS'.",
    "           GO TO MENU.",
    "       SHOW-HELP.",
    "           DISPLAY 'L FIRST  N NEXT  P PREV'.",
    "           DISPLAY 'A ADD    D DONE  O OPEN'.",
    "           DISPLAY 'X DELETE H HELP  Q QUIT'.",
    "           DISPLAY 'D/O/X PROMPT FOR THE 8-CHAR TODO ID'.",
    "       SHOW-HELP-DONE.",
    "           MOVE 0 TO IDX.",
    "       SHOW-CURRENT.",
    "           MOVE CURSOR-IDX TO SLOT.",
    "           DISPLAY 'ITEM ' SLOT ' OF ' T-COUNT.",
    "           PERFORM SHOW-ROW THRU SHOW-DONE.",
    "       SHOW-CURRENT-DONE.",
    "           MOVE 0 TO IDX.",
    "       SHOW-ROW.",
    "           DISPLAY T-ID(SLOT) ' ' T-STATUS(SLOT) ' ' T-TITLE(SLOT).",
    "       SHOW-DONE.",
    "           MOVE 0 TO IDX.",
    "       FIND-ID.",
    "           MOVE 'N' TO FOUND-FLAG.",
    "           MOVE 1 TO IDX.",
    "       FIND-LOOP.",
    "           IF IDX > T-COUNT GO TO FIND-DONE.",
    "           IF T-ID(IDX) = IN-ID GO TO FIND-HIT.",
    "           ADD 1 TO IDX.",
    "           GO TO FIND-LOOP.",
    "       FIND-HIT.",
    "           MOVE 'Y' TO FOUND-FLAG.",
    "           MOVE IDX TO SLOT.",
    "       FIND-DONE.",
    "           MOVE 0 TO IDX.",
    "       SAVE-DATA.",
    "           OPEN OUTPUT TODO-FILE.",
    "           MOVE 1 TO IDX.",
    "       SAVE-LOOP.",
    "           IF IDX > T-COUNT GO TO SAVE-CLOSE.",
    "           MOVE T-ID(IDX) TO F-ID.",
    "           MOVE T-STATUS(IDX) TO F-STATUS.",
    "           MOVE T-TITLE(IDX) TO F-TITLE.",
    "           MOVE SPACES TO F-FILLER.",
    "           WRITE FILE-REC.",
    "           ADD 1 TO IDX.",
    "           GO TO SAVE-LOOP.",
    "       SAVE-CLOSE.",
    "           CLOSE TODO-FILE.",
    "       SAVE-DONE.",
    "           MOVE 0 TO IDX.",
    "       FINISH.",
    "           DISPLAY 'GOODBYE'.",
    "           STOP RUN.",
  ];
}

function fixed(value, length) {
  return String(value ?? "").replace(/[\r\n]/g, " ").toUpperCase().padEnd(length, " ").slice(0, length);
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
      if (submitted && error.code === "ECONNRESET") return;
      reject(error);
    });
    socket.on("close", () => {
      if (submitted) resolve();
    });
  });
}
