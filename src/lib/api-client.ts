export type AdminIdentity = {
  id: string;
  email: string;
  displayName: string;
};

export type AuthState = {
  bootstrapRequired: boolean;
  user: AdminIdentity | null;
};

export type QuoteStatus = "pending" | "accepted" | "declined";

export type QuoteRequest = {
  id: string;
  status: QuoteStatus;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  insuranceType: string | null;
  vehicleYear: number | null;
  vehicleMakeModel: string | null;
  vehicleValue: string | null;
  usagePurpose: string | null;
  policyStartDate: string | null;
  repairLocation: string | null;
  selectedOffer: Record<string, unknown> | null;
  internalNote: string | null;
  reviewedAt: string | null;
  reviewedByEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QuoteActivity = {
  id: string;
  actorType: "public" | "admin" | "system";
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
  admin: { email: string; displayName: string | null } | null;
};

export async function getAuthState(): Promise<AuthState> {
  return apiFetch<AuthState>("/api/auth/state");
}

export async function bootstrapAdmin(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<{ user: AdminIdentity }> {
  return apiFetch("/api/auth/bootstrap", { method: "POST", body: JSON.stringify(input) });
}

export async function loginAdmin(input: {
  email: string;
  password: string;
}): Promise<{ user: AdminIdentity }> {
  return apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export async function logoutAdmin(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST", body: "{}" });
}

export async function listQuoteRequests(input: {
  status: QuoteStatus | "all";
  query: string;
  limit?: number;
  offset?: number;
}): Promise<{ requests: QuoteRequest[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams({
    status: input.status,
    q: input.query,
    limit: String(input.limit ?? 50),
    offset: String(input.offset ?? 0),
  });
  return apiFetch(`/api/admin/quote-requests?${params}`);
}

export async function getQuoteActivity(
  quoteRequestId: string,
): Promise<{ activity: QuoteActivity[] }> {
  return apiFetch(`/api/admin/quote-requests/${encodeURIComponent(quoteRequestId)}/activity`);
}

export async function reviewQuoteRequest(
  quoteRequestId: string,
  input: { status: "accepted" | "declined"; internalNote?: string },
): Promise<{ request: QuoteRequest }> {
  return apiFetch(`/api/admin/quote-requests/${encodeURIComponent(quoteRequestId)}/review`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}
