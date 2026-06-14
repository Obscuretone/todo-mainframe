# todo-mainframe

A deliberately anachronistic todo app: a normal REST/HTMX web application backed by COBOL business logic running inside an emulated Hercules/MVS 3.8J mainframe.

It looks like an ordinary todo app from the outside, but every REST operation is processed through a mainframe-style transaction path: card deck in, COBOL on MVS, printer spool out. There is also a live 3270 terminal for manual verification and direct access to the COBOL todo manager.

## What It Includes

- Modern Express REST API for todo CRUD operations.
- HTMX web UI that behaves like a regular website.
- xterm.js terminal connected to a real `c3270` TN3270 client.
- Hercules + MVS 3.8J TK4- running in Docker.
- IBM ANS COBOL programs compiled and run on MVS.
- Emulated card-reader/RJE transaction bridge on port `3505`.
- Spool/printer result parsing from `mainframe/prt/`.
- Fixed-width card-image master file storage.
- No local COBOL fallback: if the mainframe path is down, requests fail.

## Architecture

```text
Browser / REST client
  -> Express REST + HTMX facade
  -> transaction gateway shim
  -> emulated serial/RJE card-reader bridge
  -> Hercules MVS 3.8J TK4-
  -> IBM ANS COBOL transaction program
  -> card-image master file rewrite
  -> printer/spool result parser
  -> HTTP/HTML response
```

The REST API is modern. The business boundary is not. Each API operation submits a JCL/card deck to MVS, COBOL applies validation and todo rules, then the Node gateway reads the printed result markers from spool.

The terminal is a separate live 3270 path:

```text
Browser xterm.js
  -> WebSocket /ws/3270
  -> c3270 process
  -> Hercules TN3270 port 3270
  -> TSO on MVS
  -> TODO-74 COBOL management app
```

## Storage Model

The persisted store is `mainframe/cards/todo70-master.cards`.

It is a fixed-width, card-image master file maintained from COBOL output. The Node layer reads and writes that file only as the host-side persistence mechanism; it does not reimplement todo validation, IDs, status changes, deletes, or state rewriting.

## Requirements

- Docker Desktop or Docker Engine.
- A machine capable of running the `linux/amd64` Hercules image.
- Node is only needed for local development outside Docker.

## Start

```sh
docker compose up --build
```

Open:

```text
http://localhost:3000
```

Docker Compose exposes:

- `3000`: Express app.
- `3270`: TN3270 terminal service.
- `3505`: virtual card reader/RJE input.

## REST API

```sh
curl http://localhost:3000/api/health
curl http://localhost:3000/api/serial
curl http://localhost:3000/api/todos
curl -X POST http://localhost:3000/api/todos \
  -H 'content-type: application/json' \
  -d '{"title":"replace printer ribbon"}'
```

Endpoints:

- `GET /api/health`
- `GET /api/serial`
- `GET /api/todos`
- `POST /api/todos`
- `GET /api/todos/:id`
- `PUT /api/todos/:id`
- `DELETE /api/todos/:id`

## Terminal Flow

The **Dial-In Terminal** tab is a guided live MVS session. It does not fake the terminal UI; it drives `c3270` against Hercules.

Clean path:

1. Open `http://localhost:3000` and click **Dial-In Terminal**.
2. Click **Install/Refresh App** to submit the COBOL TSO app and current todos to MVS.
3. On the Hercules splash screen, click **Reset Keyboard**, then **Open Logon Panel**.
4. Click **Send HERC01**, then **Send CUL8TR**.
5. Click **Continue / Enter** through welcome screens.
6. On the TSO Applications menu, click **Exit Menu to READY**. This sends PF3.
7. At `READY`, click **Run Mainframe App**. This runs:

```text
EXEC 'HERC01.TODO74.CLIST'
```

Inside the COBOL app:

- `L`: first todo.
- `N`: next todo.
- `P`: previous todo.
- `A`: add todo, then type a title.
- `D`: mark done, then type the shown 8-character todo ID.
- `O`: reopen, then type the shown 8-character todo ID.
- `X`: delete, then type the shown 8-character todo ID.
- `H`: help.
- `Q`: quit back to TSO `READY`.

Best logout: at `READY`, type `LOGOFF` and press Enter, then click **Disconnect**.

If TSO says the userid is already in use, click **Force Drop Sessions**. If MVS is wedged, click **Reboot Mainframe** and wait about 90 seconds.

## Development

Run syntax checks:

```sh
npm run check
```

Reinstall the TSO management app from the API container or UI when todos change and you want the terminal app to see the latest card-image store.

```sh
npm run install:tso-app
```

## Notes

This is intentionally overbuilt for a todo app. The point is the shape: a modern facade over a legacy host where the host still owns business behavior.
