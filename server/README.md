# Marker-only Socket.IO relay

This Railway service broadcasts operational state markers. It never accepts or relays payment card numbers, CVV/CVC values, payment or identity OTPs, PINs, passwords, or nested credential fields.

## Run and test

```bash
cd server
npm install
PORT=4000 CORS_ORIGIN=http://localhost:5173 npm start
```

In a second terminal, run the integration test:

```bash
cd server
TEST_SOCKET_URL=http://127.0.0.1:4000 npm test
```

The health endpoint is `GET /health`. It reports `transit: "marker-only"` when the hardened relay is running.

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Railway-injected listening port | `4000` |
| `CORS_ORIGIN` | Comma-separated exact customer and dashboard origins | `http://localhost:5173` |

## Realtime contract

Customer sessions emit only `session:state_changed`. Monitoring clients call `monitor:join` and receive that same event. A valid event may contain only `sessionId`, `eventType`, `state`, `referenceId`, `cardBrand`, `cardLast4`, `pagePath`, and `provider`.

```json
{
  "sessionId": "request_123",
  "eventType": "payment_method_submitted",
  "state": "tokenization_required",
  "cardBrand": "visa",
  "cardLast4": "1234"
}
```

The relay recursively rejects prohibited keys, unknown properties, invalid identifiers, PAN-like digit sequences, non-allowlisted brands or states, query-bearing page paths, and unsafe administrator navigation. Rejections return `safe:rejected` to the sender and are never broadcast to monitors.

## Railway deployment

Deploy the `server` directory as the service root, set `CORS_ORIGIN` to the exact comma-separated production origins, and use `/health` as the health-check path. Railway supplies `PORT` automatically. Do not use `*` for production CORS.
