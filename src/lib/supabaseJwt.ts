// Phase 1.F — client-side Supabase JWT helper.
//
// Caches the JWT minted by /.netlify/functions/mint-supabase-jwt and
// refreshes it transparently before expiry. Components don't need to
// know the TTL or the refresh cadence — they call getSupabaseJwt() or
// use createSupabaseClient() and the helper handles everything.
//
// Three caller patterns:
//
//   1. Direct fetch (e.g. mid-component Supabase REST call):
//      const jwt = await getSupabaseJwt();
//      fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
//
//   2. Supabase JS client (preferred — handles auto-refresh + types):
//      const sb = await createSupabaseClient();
//      sb.from('staff').select();
//
//   3. Bridge to iframe-embedded modules (e.g. Cards Flutter app):
//      window.addEventListener('message', async (e) => {
//        if (e.data?.type === 'eq:request-supabase-jwt') {
//          const jwt = await getSupabaseJwt();
//          e.source?.postMessage({ type: 'eq:supabase-jwt', jwt }, '*');
//        }
//      });
//
// Spec: IDENTITY-MODEL.md §6.2 + §7.2 (Cards-side consumer pattern).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface CachedJwt {
  token: string;
  exp: number; // unix seconds — when the token actually expires
}

const REFRESH_BUFFER_SECONDS = 60; // refetch when <60s remain

let cached: CachedJwt | null = null;
let inflight: Promise<string> | null = null;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function cacheIsFresh(): boolean {
  return !!cached && cached.exp - nowSeconds() > REFRESH_BUFFER_SECONDS;
}

async function fetchFreshJwt(ttlSeconds?: number): Promise<CachedJwt> {
  const url = ttlSeconds
    ? `/.netlify/functions/mint-supabase-jwt?ttl=${encodeURIComponent(String(ttlSeconds))}`
    : '/.netlify/functions/mint-supabase-jwt';

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`mint-supabase-jwt: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { token: string; exp: number };
  if (!body.token || typeof body.exp !== 'number') {
    throw new Error('mint-supabase-jwt: malformed response');
  }
  return { token: body.token, exp: body.exp };
}

/**
 * Get a valid Supabase JWT for the current session.
 *
 * - Returns the cached token if it has more than 60s of life left.
 * - Otherwise refetches from the shell. Concurrent calls share one
 *   in-flight request — no thundering herd on cache miss.
 *
 * Throws if the user has no valid session (401 from the mint endpoint).
 * Callers should catch + redirect to login.
 */
export async function getSupabaseJwt(): Promise<string> {
  if (cacheIsFresh() && cached) {
    return cached.token;
  }
  if (inflight) {
    return inflight;
  }
  inflight = fetchFreshJwt()
    .then((fresh) => {
      cached = fresh;
      return fresh.token;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Clear the cached JWT. Call after logout, or after a 401 response
 * from Supabase (the token may have been revoked server-side).
 */
export function clearSupabaseJwt(): void {
  cached = null;
}

/**
 * Build a Supabase JS client wired up to use the cached JWT.
 *
 * The client refreshes the token via a global fetch interceptor — on
 * every Supabase request, it calls getSupabaseJwt() and attaches the
 * result as the `apikey` + `Authorization: Bearer` header.
 *
 * Requires `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` at build time
 * (the anon key is fine to ship to the browser — RLS is the gate).
 */
export async function createSupabaseClient(): Promise<SupabaseClient> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase client misconfigured — VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY must be set at build time.',
    );
  }

  const jwt = await getSupabaseJwt();

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
      // Intercept every fetch so a token refresh between client-create
      // and the actual call still uses the current cached JWT.
      fetch: async (input, init) => {
        const fresh = await getSupabaseJwt();
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${fresh}`);
        headers.set('apikey', anonKey);
        return fetch(input, { ...init, headers });
      },
    },
  });
}
