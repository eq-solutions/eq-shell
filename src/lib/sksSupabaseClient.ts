// Browser-side Supabase client for sks-canonical (ehowgjardagevnrluult) —
// the SKS tenant data plane.
//
// Why a separate client from createSupabaseClient():
//   - createSupabaseClient() points to eq-canonical (control plane). It has
//     no app_data entity tables and no eq_tidy_* / eq_quality_* RPCs.
//   - All Intake operations (health scores, licence checks, entity reads,
//     canonical commits) must target sks-canonical instead.
//
// Schema routing:
//   Entity tables (customers, sites, staff, assets, contacts, licences) live
//   in app_data on sks-canonical. RPCs (eq_tidy_read_entity, eq_commit_batch,
//   etc.) live in public. A single Supabase JS client can only default to one
//   schema. We return a Proxy that:
//     .rpc()  → public  (PostgREST default; the Proxy leaves it untouched)
//     .from() → app_data (explicitly switched via supabase.schema('app_data'))
//
// Required env vars (set at build time via Netlify):
//   VITE_SKS_SUPABASE_URL      — https://ehowgjardagevnrluult.supabase.co
//   VITE_SKS_SUPABASE_ANON_KEY — sks-canonical anon key (safe in browser; RLS is the gate)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface CachedJwt {
  token: string;
  exp: number;
}

const REFRESH_BUFFER = 60;

let cached: CachedJwt | null = null;
let inflight: Promise<string> | null = null;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function cacheIsFresh(): boolean {
  return !!cached && cached.exp - nowSeconds() > REFRESH_BUFFER;
}

async function fetchSKSJwt(): Promise<string> {
  if (cacheIsFresh() && cached) return cached.token;
  if (inflight) return inflight;

  inflight = fetch('/.netlify/functions/mint-sks-jwt', { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`mint-sks-jwt: ${res.status} ${res.statusText}`);
      const body = (await res.json()) as { token: string; exp: number };
      if (!body.token || typeof body.exp !== 'number') throw new Error('mint-sks-jwt: malformed response');
      cached = { token: body.token, exp: body.exp };
      return body.token;
    })
    .finally(() => { inflight = null; });

  return inflight;
}

export function clearSKSJwt(): void {
  cached = null;
}

/**
 * Build a Supabase client pointing at sks-canonical, with schema routing:
 * .rpc() → public schema (RPCs live here)
 * .from() → app_data schema (entity tables live here)
 */
export async function createSKSSupabaseClient(): Promise<SupabaseClient> {
  const url = import.meta.env.VITE_SKS_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SKS_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) {
    throw new Error(
      'SKS Supabase client misconfigured — VITE_SKS_SUPABASE_URL + VITE_SKS_SUPABASE_ANON_KEY must be set.',
    );
  }

  const jwt = await fetchSKSJwt();

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
      fetch: async (input, init) => {
        const fresh = await fetchSKSJwt();
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${fresh}`);
        headers.set('apikey', anonKey);
        return fetch(input, { ...init, headers });
      },
    },
  });

  // Proxy: route .from() through app_data schema, leave .rpc() on public default.
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => target.schema('app_data').from(table);
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}
