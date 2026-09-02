# Secure Console

Secure Console is a **Cloudflare Worker application** that serves the administrator interface and API from one deployment. Its durable state lives in **Railway PostgreSQL**. The Worker connects to Railway through **Cloudflare Hyperdrive**, using the Worker-compatible `pg` driver and `nodejs_compat` runtime flag.[1] [2]

The root route (`/`) is the email/password sign-in screen. If `admin_users` is empty, it becomes a one-time bootstrap form for the first administrator. The protected `/admin` route provides pending, accepted, declined, and all-request filters; name/email search; accept/decline decisions with an internal note; and per-request activity history.

| Layer              | Responsibility                                                                          |
| ------------------ | --------------------------------------------------------------------------------------- |
| Railway PostgreSQL | `admin_users`, `admin_sessions`, `quote_requests`, and `quote_activity` persistence     |
| Cloudflare Worker  | Static dashboard, authentication/session API, review API, public quote intake, and CORS |
| Hyperdrive         | Managed connection pooling between the Worker and Railway PostgreSQL                    |

## Security Boundary

Administrator sessions use a random opaque cookie. Only a SHA-256 hash of the session token is stored in PostgreSQL. Cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` in production. Passwords are stored as PBKDF2-SHA256 hashes with a random salt. The first-admin endpoint is protected by a PostgreSQL advisory transaction lock and permanently returns `409` after the first account exists.

> The quote API accepts contact and quote information only. Raw card numbers, CVV/CVC, account passwords, security PINs, payment OTPs, and identity OTPs are not accepted or stored. Nested offer data is checked for credential-like keys.

## Repository Structure

```text
secure-console/
├── db/schema.sql
├── src/api/
│   ├── auth.ts
│   ├── db.ts
│   ├── env.ts
│   ├── http.ts
│   ├── router.ts
│   └── validation.ts
├── src/lib/api-client.ts
├── src/routes/index.tsx
├── src/routes/_authenticated/route.tsx
├── src/routes/_authenticated/admin.tsx
├── src/server.ts
├── wrangler.jsonc
└── .env.example
```

## 1. Create Railway PostgreSQL

Provision PostgreSQL in Railway and copy its connection string. Apply the schema once from a trusted machine with `psql` installed:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
```

The migration creates the following tables and indexes idempotently:

| Table            | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| `admin_users`    | Administrator identity and password-verification material     |
| `admin_sessions` | Hashed opaque sessions, expiry, and minimal security metadata |
| `quote_requests` | Customer contact and quote-review state                       |
| `quote_activity` | Append-only public/admin/system activity history              |

## 2. Configure Cloudflare Hyperdrive

Hyperdrive supports an existing publicly reachable PostgreSQL database and maintains the underlying connection pool for Workers.[1] Create the configuration with Railway’s public PostgreSQL connection string:

```bash
npx wrangler login
npx wrangler hyperdrive create secure-console-postgres \
  --connection-string="$DATABASE_PUBLIC_URL"
```

Copy the returned Hyperdrive ID into `wrangler.jsonc`, replacing `REPLACE_WITH_HYPERDRIVE_ID`. Cloudflare recommends creating a new `pg.Client` per request with `env.HYPERDRIVE.connectionString`; Hyperdrive maintains the pooled origin connections.[2]

Update `PUBLIC_INTAKE_ORIGINS` in `wrangler.jsonc` to the exact customer-site origins allowed to submit requests. Multiple origins are comma-separated.

## 3. Configure the Worker Secret

Generate a secret used only to HMAC-hash client IP addresses before session metadata is stored:

```bash
openssl rand -base64 48
npx wrangler secret put IP_HASH_SECRET --config wrangler.jsonc
```

The secret must contain at least 32 characters. Do not add Railway’s database password directly to Worker variables when Hyperdrive is configured.

## 4. Install, Build, and Deploy

```bash
npm install
npm run lint
npm run build
npm run deploy
```

The existing TanStack Start/Nitro build produces a Cloudflare Worker entry and static asset bundle. The root `wrangler.jsonc` adds Hyperdrive and runtime variables to the generated deployment.[3]

For local development, copy `.env.example` to `.env`, use a disposable local PostgreSQL database, set `COOKIE_SECURE=false`, and run:

```bash
npm install
cp .env.example .env
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
npm run dev
```

## API Reference

| Method and route                             | Access              | Purpose                                                         |
| -------------------------------------------- | ------------------- | --------------------------------------------------------------- |
| `GET /api/auth/state`                        | Public              | Returns bootstrap requirement and current administrator session |
| `POST /api/auth/bootstrap`                   | Empty database only | Creates the first administrator and starts a session            |
| `POST /api/auth/login`                       | Public              | Authenticates an administrator and starts a session             |
| `POST /api/auth/logout`                      | Session cookie      | Revokes the current session                                     |
| `POST /api/public/quote-requests`            | CORS allowlist      | Creates a pending quote request and initial activity event      |
| `GET /api/admin/quote-requests`              | Administrator       | Lists and searches the review queue                             |
| `POST /api/admin/quote-requests/:id/review`  | Administrator       | Accepts or declines with an optional internal note              |
| `GET /api/admin/quote-requests/:id/activity` | Administrator       | Returns the request’s chronological activity history            |

### Public Quote Intake

The customer site should post JSON directly to the deployed Worker. Browsers receive explicit `OPTIONS` and `Access-Control-Allow-Origin` handling only for configured origins.

```js
await fetch("https://secure-console.example.workers.dev/api/public/quote-requests", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    customerName: "Customer Name",
    customerEmail: "customer@example.com",
    customerPhone: "+966500000000",
    insuranceType: "Comprehensive",
    vehicleYear: 2024,
    vehicleMakeModel: "Example Vehicle",
    vehicleValue: 85000,
    usagePurpose: "Personal",
    policyStartDate: "2026-09-15",
    repairLocation: "Agency",
    selectedOffer: {
      provider: "Example Insurer",
      price: 1200,
    },
  }),
});
```

The required fields are `customerName` and `customerEmail`. Optional fields are bounded and validated. The `website` property is a honeypot and, when present, must remain empty.

### Queue Filtering

```text
GET /api/admin/quote-requests?status=pending&q=customer&limit=50&offset=0
```

`status` accepts `pending`, `accepted`, `declined`, or `all`. Search matches the customer name or email. `limit` is capped at 100.

## Production Checklist

| Check                     | Required result                                                   |
| ------------------------- | ----------------------------------------------------------------- |
| `db/schema.sql`           | Applies successfully with `ON_ERROR_STOP=1`                       |
| Hyperdrive                | Uses Railway’s public PostgreSQL URL and is bound as `HYPERDRIVE` |
| `IP_HASH_SECRET`          | Stored with `wrangler secret put`, not committed                  |
| Public CORS               | Contains only real customer-site origins; avoid `*` in production |
| Cookies                   | `COOKIE_SECURE` remains `true` in production                      |
| First administrator       | Created once at `/`; later bootstrap requests return `409`        |
| Unauthenticated admin API | Returns `401` JSON                                                |
| Quote review              | Writes both the new status and an activity record transactionally |
| Sensitive fields          | Rejected by the public request schema                             |

## References

[1]: https://developers.cloudflare.com/hyperdrive/get-started/ "Cloudflare Hyperdrive — Getting started"
[2]: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/ "Cloudflare Hyperdrive — node-postgres"
[3]: https://developers.cloudflare.com/workers/wrangler/configuration/ "Cloudflare Workers — Wrangler configuration"
