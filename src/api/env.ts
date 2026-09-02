export interface HyperdriveBinding {
  connectionString: string;
}

export interface WorkerEnv {
  HYPERDRIVE?: HyperdriveBinding;
  DATABASE_URL?: string;
  SESSION_COOKIE_NAME?: string;
  SESSION_TTL_HOURS?: string;
  PASSWORD_ITERATIONS?: string;
  COOKIE_SECURE?: string;
  PUBLIC_INTAKE_ORIGINS?: string;
  IP_HASH_SECRET: string;
}

export function resolveWorkerEnv(env?: WorkerEnv): WorkerEnv {
  const bindings = env ?? ({} as WorkerEnv);
  const local = typeof process !== "undefined" ? process.env : {};
  return {
    ...bindings,
    DATABASE_URL: bindings.DATABASE_URL ?? local.DATABASE_URL,
    SESSION_COOKIE_NAME: bindings.SESSION_COOKIE_NAME ?? local.SESSION_COOKIE_NAME,
    SESSION_TTL_HOURS: bindings.SESSION_TTL_HOURS ?? local.SESSION_TTL_HOURS,
    PASSWORD_ITERATIONS: bindings.PASSWORD_ITERATIONS ?? local.PASSWORD_ITERATIONS,
    COOKIE_SECURE: bindings.COOKIE_SECURE ?? local.COOKIE_SECURE,
    PUBLIC_INTAKE_ORIGINS: bindings.PUBLIC_INTAKE_ORIGINS ?? local.PUBLIC_INTAKE_ORIGINS,
    IP_HASH_SECRET: bindings.IP_HASH_SECRET ?? local.IP_HASH_SECRET ?? "",
  };
}

export function sessionCookieName(env: WorkerEnv): string {
  return env.SESSION_COOKIE_NAME?.trim() || "admin_session";
}

export function sessionTtlHours(env: WorkerEnv): number {
  const value = Number(env.SESSION_TTL_HOURS ?? "12");
  return Number.isInteger(value) && value >= 1 && value <= 168 ? value : 12;
}

export function passwordIterations(env: WorkerEnv): number {
  const value = Number(env.PASSWORD_ITERATIONS ?? "210000");
  return Number.isInteger(value) && value >= 100000 ? value : 210000;
}

export function secureCookies(env: WorkerEnv): boolean {
  return env.COOKIE_SECURE !== "false";
}

export function publicIntakeOrigins(env: WorkerEnv): string[] {
  return (env.PUBLIC_INTAKE_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
