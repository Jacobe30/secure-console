# Ops Socket Server

Lightweight Socket.IO relay for real-time operational monitoring.

## Run

```bash
cd server
npm install
PORT=4000 CORS_ORIGIN=http://localhost:8080 npm start
```

Health check: `GET /health` → `{ ok: true }`.

## Rooms

- `session:<sessionId>` — one per connected client.
- `monitors` — external monitoring clients call `monitor:join` to receive
  every relayed event.

## Env

- `PORT` (default `4000`)
- `CORS_ORIGIN` (default `*`)
