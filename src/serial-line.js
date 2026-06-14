const cobol = require("./cobol");

const STX = "\x02";
const ETX = "\x03";
const baudRate = Number(process.env.SERIAL_BAUD || 300);
const maxTranscript = Number(process.env.SERIAL_TRANSCRIPT_LINES || 80);

let sequence = 0;
let queue = Promise.resolve();
const transcript = [];

function lineStatus() {
  return {
    name: "LINE 03",
    baudRate,
    mode: "8N1",
    framing: "STX payload ETX LRC",
    state: "CARRIER DETECTED",
    queued: false,
    transcript: [...transcript],
  };
}

function transmit(operation, fields = []) {
  const transaction = queue.then(() => transact(operation, fields));
  queue = transaction.catch(() => {});
  return transaction;
}

async function transact(operation, fields) {
  const frameSequence = nextSequence();
  const normalizedFields = fields.map(toCobolArgument);
  const payload = [frameSequence, operation, ...normalizedFields].map(escapeField).join("|");
  const requestFrame = frame(payload);

  record("TX", printableFrame(requestFrame));
  await serialDelay(requestFrame);

  try {
    const lines = await cobol.invoke([operation, ...normalizedFields]);
    const responsePayload = [frameSequence, "ACK", ...lines].map(escapeField).join("|");
    const responseFrame = frame(responsePayload);

    await serialDelay(responseFrame);
    record("RX", printableFrame(responseFrame));

    return lines;
  } catch (error) {
    const responsePayload = [frameSequence, "NAK", error.message].map(escapeField).join("|");
    const responseFrame = frame(responsePayload);

    await serialDelay(responseFrame);
    record("RX", printableFrame(responseFrame));

    throw error;
  }
}

async function listTodos() {
  const lines = await transmit("LIST");
  return lines.map(cobol.parseTodo).filter(Boolean);
}

async function getTodo(id) {
  const lines = await transmit("GET", [id]);
  return cobol.parseTodo(lines[0]);
}

async function createTodo({ title, status }) {
  const lines = await transmit("CREATE", [status, title]);

  return cobol.parseTodo(lines[0]);
}

async function updateTodo(id, { title, status }) {
  const lines = await transmit("UPDATE", [id, status, title]);

  return cobol.parseTodo(lines[0]);
}

async function setTodoStatus(id, status) {
  const lines = await transmit("SETSTATUS", [id, status]);
  return cobol.parseTodo(lines[0]);
}

async function deleteTodo(id) {
  await transmit("DELETE", [id]);
}

function frame(payload) {
  const body = `${STX}${payload}${ETX}`;
  return `${body}${lrc(body)}`;
}

function lrc(value) {
  let checksum = 0;
  for (const char of value) {
    checksum ^= char.charCodeAt(0);
  }
  return checksum.toString(16).toUpperCase().padStart(2, "0");
}

function printableFrame(value) {
  return value.replaceAll(STX, "<STX>").replaceAll(ETX, "<ETX>");
}

function escapeField(value) {
  return String(value)
    .replace(/[|\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toCobolArgument(value) {
  if (value === undefined || value === null || value === "") {
    return " ";
  }

  return String(value);
}

async function serialDelay(value) {
  const bitsPerCharacter = 10;
  const milliseconds = Math.ceil((value.length * bitsPerCharacter * 1000) / baudRate);
  await new Promise((resolve) => setTimeout(resolve, Math.min(milliseconds, 250)));
}

function nextSequence() {
  sequence = (sequence + 1) % 10000;
  return sequence.toString().padStart(4, "0");
}

function record(direction, text) {
  transcript.push({
    at: new Date().toISOString(),
    direction,
    text,
  });

  while (transcript.length > maxTranscript) {
    transcript.shift();
  }
}

module.exports = {
  createTodo,
  deleteTodo,
  getTodo,
  lineStatus,
  listTodos,
  setTodoStatus,
  transmit,
  updateTodo,
};
