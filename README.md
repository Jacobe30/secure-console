# Secure quote operations dashboard

This TanStack Start application provides an authenticated administrator dashboard for ordinary quote data and non-sensitive payment or verification state markers. The dashboard never fetches, subscribes to, derives, renders, or searches full card numbers, CVV/CVC, expiry, PINs, passwords, or OTP/passcode values.

## Architecture

| Component | Responsibility |
| --- | --- |
| Supabase Auth | Administrator sign-in and role guard |
| `starter-api` Edge Function | Authenticated quote review endpoints and safe marker history |
| `starter_quote_requests` | Quote, review, masked card metadata, and current provider state |
| Supabase Realtime | Change notification on the safe quote table; the UI refetches allowlisted API fields |
| Railway Socket.IO service | Optional low-latency broadcast of validated `session:state_changed` markers |
| TanStack Start | Dashboard routes, server rendering, and Cloudflare Worker output |

## Local development

```bash
npm install
npm run dev
```

Configure the existing Supabase variables used by the application:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_BACKEND_WS_URL=http://localhost:4000
```

`VITE_BACKEND_WS_URL` is optional. When it is absent, `/admin` polls the authenticated Edge Function every five seconds. Never place a service-role key or database password in a `VITE_*` variable.

## Dashboard behavior

The `/admin` route loads only the explicit allowlist returned by `GET /starter-api/admin/requests`. Payment confirmation is rendered as a brand plus `•••• 1234`, or as “no card data stored.” Provider verification is represented by states such as `pending_provider_verification`, `verified`, or `failed`; the corresponding challenge answer is never returned.

The `/sessions` route subscribes to `starter_quote_requests`, not the legacy raw `sessions` table. Realtime payloads are used only as refresh signals, and displayed records come from the authenticated Edge Function field allowlist.

Administrator review actions call the Edge Function’s accept/decline endpoint. Free-form redirect query strings and credential-step redirects have been removed; optional Socket.IO navigation is limited to a small path allowlist and contains only a session identifier and path.

## Railway marker relay

```bash
cd server
npm install
PORT=4000 CORS_ORIGIN=http://localhost:5173 npm start
```

Run its security integration test separately:

```bash
cd server
TEST_SOCKET_URL=http://127.0.0.1:4000 npm test
```

Deploy `server/` as the Railway service root and configure `CORS_ORIGIN` as a comma-separated list of exact production customer and dashboard origins. See `server/README.md` for the event contract.

## Build and deploy

```bash
npm run build
```

The build generates the Cloudflare-compatible output under `.output/`. Deploy through the project’s established Lovable/Cloudflare workflow after applying the customer repository’s `20260903100000_add_safe_transit_markers.sql` migration and deploying the updated `starter-api` function.

## Verification

```bash
npx eslint src/lib/backend.ts \
  src/routes/_authenticated/admin.tsx \
  src/routes/_authenticated/sessions.tsx \
  server/index.js server/test-safe-relay.mjs
npm run build
```

A repository scan should show no raw credential fields in the dashboard or Railway relay. The customer repository contains the complementary deterministic bundle verifier and browser-level evidence.
