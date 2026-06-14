# todo-mainframe Mainframe Mode

This folder contains the emulated mainframe path. Hercules runs an IBM
System/370-class MVS 3.8J TK4- environment, and the Node API treats it as the
only supported COBOL business host.

```text
REST / HTMX facade
  -> transaction gateway shim
  -> Hercules card reader on port 3505
  -> MVS 3.8J
  -> IBM ANS COBOL transaction program
  -> printer/spool output
```

## Start

```sh
docker compose up mainframe
```

Useful ports and folders:

- `3270` is the TN3270 terminal port used by the browser terminal via `c3270`.
- `3505` is the virtual card reader.
- `prt/` receives printer/spool output.
- `cards/todo70-master.cards` stores the card-image master file used by the app.

## Submit a Deck Manually

```sh
node scripts/submit-deck.js mainframe/decks/TODO70.jcl
```

## Runtime Contract

The API submits operation-specific JCL through the Hercules card reader and waits
for printer/spool output. The COBOL program emits result lines between
`TODO70-RESULT-BEGIN <job>` and `TODO70-RESULT-END <job>` markers:

- `TODO|...` for records returned to callers.
- `OK|...` for successful non-record operations.
- `ERR|...` for business-rule failures.
- `CARD|...` for replacement card-image master records.

There is no local GnuCOBOL fallback.
