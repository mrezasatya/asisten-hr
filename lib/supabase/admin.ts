import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "../config/env";

let cached: SupabaseClient | null = null;

/**
 * Supabase client using the service role key. Bypasses RLS, so it must only run on the
 * server or in local scripts (ingest, eval). Never expose to the browser.
 */
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cached;
}
