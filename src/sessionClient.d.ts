import type { SupabaseClient } from "@supabase/supabase-js";
export const SESSIONS_SUPABASE_URL: string;
export const SESSIONS_SUPABASE_KEY: string;
export function getSessionClient(): SupabaseClient;
export const sessionClient: SupabaseClient;
