import { publicIntakeOrigins, type WorkerEnv } from "./env";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("X-Frame-Options", "DENY");
  responseHeaders.set("Referrer-Policy", "no-referrer");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export async function readJson(request: Request, maxBytes = 32_768): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "Content-Type must be application/json.");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(413, "Request body is too large.");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ApiError(413, "Request body is too large.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "Request body is not valid JSON.");
  }
}

export function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const entry of cookie.split(";")) {
    const [key, ...parts] = entry.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

export function publicCorsHeaders(request: Request, env: WorkerEnv): Headers {
  const origin = request.headers.get("origin");
  const allowed = publicIntakeOrigins(env);
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });

  if (origin && (allowed.includes(origin) || allowed.includes("*"))) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

export function isPublicOriginAllowed(request: Request, env: WorkerEnv): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = publicIntakeOrigins(env);
  return allowed.includes("*") || allowed.includes(origin);
}

export function methodNotAllowed(allowed: string): ApiError {
  return new ApiError(405, `Method not allowed. Use ${allowed}.`);
}

export function apiErrorDetails(error: unknown): { status: number; message: string } | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown; message?: unknown };
  if (
    typeof candidate.status === "number" &&
    candidate.status >= 400 &&
    candidate.status <= 599 &&
    typeof candidate.message === "string"
  ) {
    return { status: candidate.status, message: candidate.message };
  }
  return null;
}
