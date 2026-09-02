import { Client, type QueryResult, type QueryResultRow } from "pg";
import type { WorkerEnv } from "./env";

function connectionString(env: WorkerEnv): string {
  const value = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!value) {
    throw new Error("PostgreSQL is not configured. Bind HYPERDRIVE or set DATABASE_URL locally.");
  }
  return value;
}

export async function withDatabase<T>(
  env: WorkerEnv,
  callback: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: connectionString(env) });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

export async function query<T extends QueryResultRow>(
  env: WorkerEnv,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return withDatabase(env, (client) => client.query<T>(text, values));
}

export async function transaction<T>(
  env: WorkerEnv,
  callback: (client: Client) => Promise<T>,
): Promise<T> {
  return withDatabase(env, async (client) => {
    await client.query("BEGIN");
    try {
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
