# Cloudflare Worker to Railway PostgreSQL architecture

Cloudflare Hyperdrive is the supported connection-pooling layer for an existing public PostgreSQL database. The Worker should bind a Hyperdrive configuration as `HYPERDRIVE`, create a new `pg.Client` per request with `env.HYPERDRIVE.connectionString`, connect, execute parameterized queries, and close the client. Hyperdrive maintains the underlying pool.

Cloudflare identifies `pg` (node-postgres) as the recommended JavaScript/TypeScript PostgreSQL driver for Workers. The Worker configuration must enable `nodejs_compat`; the documented minimum `pg` version for Hyperdrive is 8.16.3.

Railway PostgreSQL must be reachable through its public TCP connection string when creating the Hyperdrive configuration. The production Worker stores only the Hyperdrive binding ID, not `DATABASE_URL`. Local development can use a local Hyperdrive connection string override or direct test database configuration as documented by Cloudflare.

Sources:

- https://developers.cloudflare.com/hyperdrive/get-started/
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/
