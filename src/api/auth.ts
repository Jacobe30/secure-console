import type { Client } from "pg";
import { query, transaction } from "./db";
import {
  passwordIterations,
  secureCookies,
  sessionCookieName,
  sessionTtlHours,
  type WorkerEnv,
} from "./env";
import { ApiError, cookieValue } from "./http";

const encoder = new TextEncoder();

export type AdminIdentity = {
  id: string;
  email: string;
  displayName: string;
};

type AdminCredentialRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  is_active: boolean;
};

type SessionRow = {
  session_id: string;
  id: string;
  email: string;
  display_name: string;
};

export async function adminCount(env: WorkerEnv): Promise<number> {
  const result = await query<{ count: string }>(
    env,
    "SELECT COUNT(*)::text AS count FROM admin_users",
  );
  return Number(result.rows[0]?.count ?? "0");
}

export async function bootstrapAdmin(
  env: WorkerEnv,
  input: { email: string; password: string; displayName: string },
  request: Request,
): Promise<{ user: AdminIdentity; token: string }> {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();
  const password = input.password;
  validateCredentials(email, password, displayName);

  return transaction(env, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [918_402_771]);
    const count = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM admin_users",
    );
    if (Number(count.rows[0]?.count ?? "0") !== 0) {
      throw new ApiError(409, "Administrator bootstrap is no longer available.");
    }

    const iterations = passwordIterations(env);
    const passwordRecord = await hashPassword(password, iterations);
    const inserted = await client.query<{ id: string; email: string; display_name: string }>(
      `INSERT INTO admin_users (
         email, display_name, password_hash, password_salt, password_iterations
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, display_name`,
      [email, displayName, passwordRecord.hash, passwordRecord.salt, iterations],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Administrator insert returned no row.");

    const token = await createSession(client, env, row.id, request);
    return {
      token,
      user: { id: row.id, email: row.email, displayName: row.display_name },
    };
  });
}

export async function loginAdmin(
  env: WorkerEnv,
  input: { email: string; password: string },
  request: Request,
): Promise<{ user: AdminIdentity; token: string }> {
  const email = normalizeEmail(input.email);
  const result = await query<AdminCredentialRow>(
    env,
    `SELECT id, email, display_name, password_hash, password_salt,
            password_iterations, is_active
       FROM admin_users
      WHERE email = $1
      LIMIT 1`,
    [email],
  );
  const row = result.rows[0];
  const valid =
    row?.is_active === true &&
    (await verifyPassword(
      input.password,
      row.password_salt,
      row.password_hash,
      row.password_iterations,
    ));

  if (!valid || !row) throw new ApiError(401, "Invalid email or password.");

  return transaction(env, async (client) => {
    const token = await createSession(client, env, row.id, request);
    await client.query(
      "UPDATE admin_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1",
      [row.id],
    );
    return {
      token,
      user: { id: row.id, email: row.email, displayName: row.display_name },
    };
  });
}

export async function requireAdmin(request: Request, env: WorkerEnv): Promise<AdminIdentity> {
  const token = cookieValue(request, sessionCookieName(env));
  if (!token) throw new ApiError(401, "Authentication required.");
  const tokenHash = await sha256Hex(token);

  const result = await query<SessionRow>(
    env,
    `UPDATE admin_sessions AS sessions
        SET last_seen_at = NOW()
       FROM admin_users AS users
      WHERE sessions.token_hash = $1
        AND sessions.expires_at > NOW()
        AND users.id = sessions.admin_user_id
        AND users.is_active = TRUE
      RETURNING sessions.id AS session_id, users.id, users.email, users.display_name`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(401, "Session is invalid or expired.");
  return { id: row.id, email: row.email, displayName: row.display_name };
}

export async function revokeSession(request: Request, env: WorkerEnv): Promise<void> {
  const token = cookieValue(request, sessionCookieName(env));
  if (!token) return;
  await query(env, "DELETE FROM admin_sessions WHERE token_hash = $1", [await sha256Hex(token)]);
}

export function sessionCookie(env: WorkerEnv, token: string): string {
  const maxAge = sessionTtlHours(env) * 60 * 60;
  return [
    `${sessionCookieName(env)}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    secureCookies(env) ? "Secure" : "",
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearedSessionCookie(env: WorkerEnv): string {
  return [
    `${sessionCookieName(env)}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    secureCookies(env) ? "Secure" : "",
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}

async function createSession(
  client: Client,
  env: WorkerEnv,
  adminUserId: string,
  request: Request,
) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + sessionTtlHours(env) * 60 * 60 * 1000).toISOString();
  await client.query(
    `INSERT INTO admin_sessions (
       admin_user_id, token_hash, expires_at, user_agent, ip_hash
     ) VALUES ($1, $2, $3, $4, $5)`,
    [adminUserId, tokenHash, expiresAt, userAgent(request), await clientIpHash(request, env)],
  );
  return token;
}

async function hashPassword(password: string, iterations: number) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, iterations);
  return { salt: toBase64(salt), hash: toBase64(hash) };
}

async function verifyPassword(
  password: string,
  salt: string,
  expected: string,
  iterations: number,
) {
  const actual = await derivePassword(password, fromBase64(salt), iterations);
  return timingSafeEqual(actual, fromBase64(expected));
}

async function derivePassword(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256),
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function clientIpHash(request: Request, env: WorkerEnv): Promise<string | null> {
  const address = request.headers.get("cf-connecting-ip")?.trim();
  if (!address) return null;
  if (!env.IP_HASH_SECRET || env.IP_HASH_SECRET.length < 32) {
    throw new Error("IP_HASH_SECRET must contain at least 32 characters.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.IP_HASH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(address));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validateCredentials(email: string, password: string, displayName: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ApiError(400, "Enter a valid email address.");
  }
  if (displayName.length < 1 || displayName.length > 120) {
    throw new ApiError(400, "Display name must contain 1 to 120 characters.");
  }
  if (password.length < 12 || password.length > 256) {
    throw new ApiError(400, "Password must contain 12 to 256 characters.");
  }
}

function randomToken(bytes: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function userAgent(request: Request): string | null {
  const value = request.headers.get("user-agent")?.trim();
  return value ? value.slice(0, 500) : null;
}

function timingSafeEqual(actual: Uint8Array, expected: Uint8Array): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
