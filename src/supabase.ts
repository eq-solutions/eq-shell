// Browser-side Supabase client builder.
//
// The shell's session payload includes `supabase_jwt` — a short-lived
// JWT minted by shell-login / verify-shell-session and signed with the
// project's JWT secret. We feed it to @supabase/supabase-js as the
// session access token, which makes every subsequent call hit Supabase
// as an authenticated user whose claims include `user_metadata.tenant_id`.
// Tenant scope is then enforced by RLS policies on each table and by
// the eq_intake_commit_batch RPC.
//
// The JWT is short-lived (1h). The shell refreshes it implicitly on
// every verify-shell-session call (route-mount). If a long-running
// operation outlives the JWT, the next call will 401 — handle that
// by triggering a session refresh from the host. Today we just create
// a new client on each `useSupabaseClient()` so the freshest JWT in
// session state is always used.

import { useMemo } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useSession } from './session';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function buildClient(jwt: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in the eq-shell deploy. ' +
        'Find them in the Supabase dashboard under Settings → API.',
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
    },
  });
}

/**
 * Returns a Supabase client authenticated with the current session's JWT,
 * or null when no session exists. Recomputes only when the JWT changes.
 */
export function useSupabaseClient(): SupabaseClient | null {
  const { session } = useSession();
  return useMemo(() => {
    if (!session?.supabase_jwt) return null;
    return buildClient(session.supabase_jwt);
  }, [session?.supabase_jwt]);
}
