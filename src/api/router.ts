import type { Client } from "pg";
import { ZodError } from "zod";
import {
  adminCount,
  bootstrapAdmin,
  clearedSessionCookie,
  loginAdmin,
  requireAdmin,
  revokeSession,
  sessionCookie,
} from "./auth";
import { query, transaction } from "./db";
import type { WorkerEnv } from "./env";
import {
  ApiError,
  apiErrorDetails,
  isPublicOriginAllowed,
  json,
  methodNotAllowed,
  publicCorsHeaders,
  readJson,
} from "./http";
import { bootstrapSchema, loginSchema, publicQuoteSchema, reviewSchema } from "./validation";

export async function handleApiRequest(request: Request, env: WorkerEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;

  try {
    if (url.pathname === "/api/public/quote-requests") {
      return await handlePublicQuoteRequest(request, env);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { Allow: "GET,POST,OPTIONS" } });
    }

    if (url.pathname === "/api/auth/state") {
      if (request.method !== "GET") throw methodNotAllowed("GET");
      return await authState(request, env);
    }
    if (url.pathname === "/api/auth/bootstrap") {
      if (request.method !== "POST") throw methodNotAllowed("POST");
      return await authBootstrap(request, env);
    }
    if (url.pathname === "/api/auth/login") {
      if (request.method !== "POST") throw methodNotAllowed("POST");
      return await authLogin(request, env);
    }
    if (url.pathname === "/api/auth/logout") {
      if (request.method !== "POST") throw methodNotAllowed("POST");
      await revokeSession(request, env);
      return json({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie(env) });
    }

    const listMatch = url.pathname === "/api/admin/quote-requests";
    if (listMatch) {
      if (request.method !== "GET") throw methodNotAllowed("GET");
      return await listQuoteRequests(request, env);
    }

    const activityMatch = url.pathname.match(
      /^\/api\/admin\/quote-requests\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/activity$/i,
    );
    if (activityMatch) {
      if (request.method !== "GET") throw methodNotAllowed("GET");
      return await quoteActivity(request, env, activityMatch[1] ?? "");
    }

    const reviewMatch = url.pathname.match(
      /^\/api\/admin\/quote-requests\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/review$/i,
    );
    if (reviewMatch) {
      if (request.method !== "POST") throw methodNotAllowed("POST");
      return await reviewQuoteRequest(request, env, reviewMatch[1] ?? "");
    }

    throw new ApiError(404, "API route not found.");
  } catch (error) {
    const apiError = apiErrorDetails(error);
    if (apiError) return json({ error: apiError.message }, apiError.status);
    if (error instanceof ZodError) {
      return json({ error: "Invalid request.", details: error.flatten().fieldErrors }, 400);
    }
    console.error("API request failed", error);
    return json({ error: "The API could not process the request." }, 500);
  }
}

async function authState(request: Request, env: WorkerEnv) {
  const count = await adminCount(env);
  let user = null;
  try {
    user = await requireAdmin(request, env);
  } catch (error) {
    const details = apiErrorDetails(error);
    if (!details || details.status !== 401) throw error;
  }
  return json({ bootstrapRequired: count === 0, user });
}

async function authBootstrap(request: Request, env: WorkerEnv) {
  const input = bootstrapSchema.parse(await readJson(request));
  const result = await bootstrapAdmin(env, input, request);
  return json({ user: result.user }, 201, { "Set-Cookie": sessionCookie(env, result.token) });
}

async function authLogin(request: Request, env: WorkerEnv) {
  const input = loginSchema.parse(await readJson(request));
  const result = await loginAdmin(env, input, request);
  return json({ user: result.user }, 200, { "Set-Cookie": sessionCookie(env, result.token) });
}

async function handlePublicQuoteRequest(request: Request, env: WorkerEnv) {
  const cors = publicCorsHeaders(request, env);
  if (request.method === "OPTIONS") {
    if (!isPublicOriginAllowed(request, env)) return json({ error: "Origin not allowed." }, 403);
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed. Use POST." }, 405, cors);
  }
  if (!isPublicOriginAllowed(request, env)) {
    return json({ error: "Origin not allowed." }, 403);
  }

  try {
    const input = publicQuoteSchema.parse(await readJson(request));
    const record = await transaction(env, async (client) => {
      const inserted = await client.query<{ id: string; status: string; created_at: string }>(
        `INSERT INTO quote_requests (
           customer_name, customer_email, customer_phone, insurance_type,
           vehicle_year, vehicle_make_model, vehicle_value, usage_purpose,
           policy_start_date, repair_location, selected_offer
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
         RETURNING id, status, created_at`,
        [
          input.customerName,
          input.customerEmail,
          input.customerPhone ?? null,
          input.insuranceType ?? null,
          input.vehicleYear ?? null,
          input.vehicleMakeModel ?? null,
          input.vehicleValue ?? null,
          input.usagePurpose ?? null,
          input.policyStartDate ?? null,
          input.repairLocation ?? null,
          input.selectedOffer ? JSON.stringify(input.selectedOffer) : null,
        ],
      );
      const quote = inserted.rows[0];
      if (!quote) throw new Error("Quote request insert returned no row.");
      await appendActivity(client, quote.id, "public", null, "quote.submitted", {
        source: "public_intake",
      });
      return quote;
    });

    return json(
      {
        id: record.id,
        status: record.status,
        createdAt: record.created_at,
        message: "Quote request received.",
      },
      201,
      cors,
    );
  } catch (error) {
    const apiError = apiErrorDetails(error);
    if (apiError) return json({ error: apiError.message }, apiError.status, cors);
    if (error instanceof ZodError) {
      return json(
        { error: "Invalid quote request.", details: error.flatten().fieldErrors },
        400,
        cors,
      );
    }
    console.error("Public quote request failed", error);
    return json({ error: "The quote request could not be saved." }, 500, cors);
  }
}

async function listQuoteRequests(request: Request, env: WorkerEnv) {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  if (!["pending", "accepted", "declined", "all"].includes(status)) {
    throw new ApiError(400, "Unsupported status filter.");
  }
  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const limit = boundedInteger(url.searchParams.get("limit"), 50, 1, 100);
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 0, 10_000);
  const values: unknown[] = [];
  const conditions: string[] = [];

  if (status !== "all") {
    values.push(status);
    conditions.push(`requests.status = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(
      `(requests.customer_name ILIKE $${values.length} OR requests.customer_email ILIKE $${values.length})`,
    );
  }
  values.push(limit, offset);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await query<QuoteRequestRow>(
    env,
    `SELECT requests.id, requests.status, requests.customer_name, requests.customer_email,
            requests.customer_phone, requests.insurance_type, requests.vehicle_year,
            requests.vehicle_make_model, requests.vehicle_value::text, requests.usage_purpose,
            requests.policy_start_date::text, requests.repair_location,
            requests.selected_offer, requests.internal_note, requests.reviewed_at,
            requests.created_at, requests.updated_at, users.email AS reviewed_by_email,
            COUNT(*) OVER()::text AS total_count
       FROM quote_requests AS requests
       LEFT JOIN admin_users AS users ON users.id = requests.reviewed_by
       ${where}
      ORDER BY requests.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  return json({
    requests: result.rows.map(serializeQuoteRequest),
    total: Number(result.rows[0]?.total_count ?? "0"),
    limit,
    offset,
  });
}

async function quoteActivity(request: Request, env: WorkerEnv, quoteRequestId: string) {
  await requireAdmin(request, env);
  const result = await query<QuoteActivityRow>(
    env,
    `SELECT activity.id::text, activity.actor_type, activity.action, activity.details,
            activity.created_at, users.email AS admin_email,
            users.display_name AS admin_display_name
       FROM quote_activity AS activity
       LEFT JOIN admin_users AS users ON users.id = activity.admin_user_id
      WHERE activity.quote_request_id = $1
      ORDER BY activity.created_at DESC
      LIMIT 200`,
    [quoteRequestId],
  );
  return json({
    activity: result.rows.map((row) => ({
      id: row.id,
      actorType: row.actor_type,
      action: row.action,
      details: row.details,
      createdAt: row.created_at,
      admin: row.admin_email
        ? { email: row.admin_email, displayName: row.admin_display_name }
        : null,
    })),
  });
}

async function reviewQuoteRequest(request: Request, env: WorkerEnv, quoteRequestId: string) {
  const admin = await requireAdmin(request, env);
  const input = reviewSchema.parse(await readJson(request));

  const updated = await transaction(env, async (client) => {
    const existing = await client.query<{ id: string; status: string }>(
      "SELECT id, status FROM quote_requests WHERE id = $1 FOR UPDATE",
      [quoteRequestId],
    );
    const previous = existing.rows[0];
    if (!previous) throw new ApiError(404, "Quote request not found.");

    const result = await client.query<QuoteRequestRow>(
      `UPDATE quote_requests
          SET status = $1,
              internal_note = $2,
              reviewed_by = $3,
              reviewed_at = NOW(),
              updated_at = NOW()
        WHERE id = $4
        RETURNING id, status, customer_name, customer_email, customer_phone,
                  insurance_type, vehicle_year, vehicle_make_model, vehicle_value::text,
                  usage_purpose, policy_start_date::text, repair_location, selected_offer,
                  internal_note, reviewed_at, created_at, updated_at,
                  NULL::text AS reviewed_by_email, '1'::text AS total_count`,
      [input.status, input.internalNote || null, admin.id, quoteRequestId],
    );
    await appendActivity(client, quoteRequestId, "admin", admin.id, `quote.${input.status}`, {
      previousStatus: previous.status,
      internalNotePresent: Boolean(input.internalNote),
    });
    return result.rows[0];
  });

  if (!updated) throw new Error("Quote review update returned no row.");
  return json({ request: serializeQuoteRequest({ ...updated, reviewed_by_email: admin.email }) });
}

async function appendActivity(
  client: Client,
  quoteRequestId: string,
  actorType: "public" | "admin" | "system",
  adminUserId: string | null,
  action: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO quote_activity (
       quote_request_id, actor_type, admin_user_id, action, details
     ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [quoteRequestId, actorType, adminUserId, action, JSON.stringify(details)],
  );
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

type QuoteRequestRow = {
  id: string;
  status: "pending" | "accepted" | "declined";
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  insurance_type: string | null;
  vehicle_year: number | null;
  vehicle_make_model: string | null;
  vehicle_value: string | null;
  usage_purpose: string | null;
  policy_start_date: string | null;
  repair_location: string | null;
  selected_offer: Record<string, unknown> | null;
  internal_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  reviewed_by_email: string | null;
  total_count: string;
};

type QuoteActivityRow = {
  id: string;
  actor_type: "public" | "admin" | "system";
  action: string;
  details: Record<string, unknown>;
  created_at: string;
  admin_email: string | null;
  admin_display_name: string | null;
};

function serializeQuoteRequest(row: QuoteRequestRow) {
  return {
    id: row.id,
    status: row.status,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    insuranceType: row.insurance_type,
    vehicleYear: row.vehicle_year,
    vehicleMakeModel: row.vehicle_make_model,
    vehicleValue: row.vehicle_value,
    usagePurpose: row.usage_purpose,
    policyStartDate: row.policy_start_date,
    repairLocation: row.repair_location,
    selectedOffer: row.selected_offer,
    internalNote: row.internal_note,
    reviewedAt: row.reviewed_at,
    reviewedByEmail: row.reviewed_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
