// Standalone Supabase client for the live "sessions" table.
// Uses the new opaque publishable API key format, so we strip the
// default Authorization: Bearer header and pass the key via `apikey`.
import { createClient } from "@supabase/supabase-js";

export const SESSIONS_SUPABASE_URL = "https://btcrhisxmrvmjwkigvan.supabase.co";
export const SESSIONS_SUPABASE_KEY = "sb_publishable_y5pq98qXFuC5e1Ka4ZakpA_HNIkDq8G";

function sessionsFetch(input, init) {
  const headers = new Headers(
    typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
  );
  if (init && init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  // New-format keys are opaque, not JWTs — drop the Bearer variant.
  if (headers.get("Authorization") === `Bearer ${SESSIONS_SUPABASE_KEY}`) {
    headers.delete("Authorization");
  }
  headers.set("apikey", SESSIONS_SUPABASE_KEY);
  return fetch(input, { ...(init || {}), headers });
}

let _client;

export function getSessionClient() {
  if (_client) return _client;
  _client = createClient(SESSIONS_SUPABASE_URL, SESSIONS_SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: { fetch: sessionsFetch },
    realtime: { params: { apikey: SESSIONS_SUPABASE_KEY } },
  });
  return _client;
}

export const sessionClient = getSessionClient();
