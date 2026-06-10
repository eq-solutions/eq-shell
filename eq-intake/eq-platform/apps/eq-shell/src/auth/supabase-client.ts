/**
 * Supabase client for the shell. Single instance, configured from env.
 *
 * Per the tenancy model: each tenant has their own Supabase project. The
 * URL + anon key here come from that tenant's deployment env config.
 * When the project hasn't been configured yet (VITE_SUPABASE_URL is
 * empty), `getSupabase()` returns null and the auth layer falls back to
 * a "no-auth dev mode" that doesn't gate routes.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    cached = null;
    return null;
  }
  cached = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return cached;
}

export function isAuthEnabled(): boolean {
  return getSupabase() !== null;
}
