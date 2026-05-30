/**
 * SPIKE — Isolated Supabase Auth client for the auth re-platform PoC.
 *
 * HARD ISOLATION CONTRACT:
 *   - This file is ONLY imported by spike/ files. Never imported by the live
 *     auth path (session.ts, netlify/functions/*, supabase.ts, supabaseJwt.ts).
 *   - The live supabase.ts and lib/supabaseJwt.ts are UNCHANGED by this spike.
 *   - This client uses Supabase Auth's native session management (persistSession:true),
 *     intentionally separate from the shell's HMAC cookie session.
 *
 * Config reads from VITE_SPIKE_SUPABASE_URL and VITE_SPIKE_SUPABASE_ANON_KEY —
 * deliberately different env vars to prevent cross-wiring with the production
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY used by the live client.
 *
 * Supabase-side setup still required (see AUTH-SPIKE-README.md):
 *   - eq-canonical-internal project must have Supabase Auth enabled.
 *   - WebAuthn / passkey support enabled in Auth dashboard.
 *   - Custom Access Token Hook registered (SQL in README).
 *   - public.tenant_members table populated.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Dedicated spike env vars — intentionally NOT VITE_SUPABASE_URL to prevent
// any accidental cross-wiring with the production canonical project.
// Set in .env.local for local testing. Never commit real values.
const SPIKE_URL = import.meta.env.VITE_SPIKE_SUPABASE_URL as string | undefined;
const SPIKE_ANON_KEY = import.meta.env.VITE_SPIKE_SUPABASE_ANON_KEY as string | undefined;

let _client: SupabaseClient | null = null;

/**
 * Returns the spike-scoped Supabase Auth client. Singleton per page load.
 *
 * Returns null if the spike env vars are not configured — the spike UI
 * renders a "not configured" state rather than throwing. The live app is
 * unaffected even if the spike route is accidentally reached without config.
 */
export function getSpikeSupabaseClient(): SupabaseClient | null {
  if (!SPIKE_URL || !SPIKE_ANON_KEY) {
    return null;
  }
  if (!_client) {
    _client = createClient(SPIKE_URL, SPIKE_ANON_KEY, {
      auth: {
        // Persist the Supabase Auth session so a page refresh doesn't
        // require re-authentication during the spike demo.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Scoped storage key so it cannot clash with any existing
        // Supabase client storage in the live shell.
        storageKey: 'eq_spike_auth',
      },
    });
  }
  return _client;
}

/**
 * True when real Supabase credentials are configured in env vars.
 * Used by the demo UI to show a "configure credentials" state vs live demo.
 */
export function isSpikeConfigured(): boolean {
  return Boolean(SPIKE_URL && SPIKE_ANON_KEY);
}
