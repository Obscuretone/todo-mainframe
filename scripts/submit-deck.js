#!/usr/bin/env node
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const deckPath = process.argv[2];
const host = process.env.MAINFRAME_READER_HOST || "127.0.0.1";
const port = Number(process.env.MAINFRAME_READER_PORT || 3505);
let submitted = false;

if (!deckPath) {
  console.error("usage: node scripts/submit-deck.js <deck.jcl>");
  process.exit(1);
}

const resolvedDeckPath = path.resolve(deckPath);
const deck = fs.readFileSync(resolvedDeckPath, "utf8").replace(/\r?\n/g, "\r\n");

const socket = net.createConnection({ host, port }, () => {
  socket.write(deck.endsWith("\r\n") ? deck : `${deck}\r\n`);
  submitted = true;
  socket.end();
});

socket.on("error", (error) => {
  if (submitted && error.code === "ECONNRESET") {
    return;
  }

  console.error(`failed to submit ${resolvedDeckPath} to ${host}:${port}: ${error.message}`);
  process.exitCode = 1;
});

socket.on("close", () => {
  if (!process.exitCode) {
    console.log(`submitted ${resolvedDeckPath} to ${host}:${port}`);
  }
});
