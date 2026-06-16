// Browser-side Supabase client for the SESSION tenant's data plane.
//
// Generalises sksSupabaseClient.ts: instead of a hardcoded plane
// (VITE_SKS_SUPABASE_URL), it resolves the signed-in tenant's URL + anon key +
// a short-lived JWT from /.netlify/functions/mint-tenant-jwt (which reads
// shell_control.tenant_routing for session.tenant_id). So one build talks to
// whatever tenant is signed in — the foundation for EQ Ops/Field/Service all
// running on one tenant canonical.
//
// Schema routing matches the SKS client:
//   .rpc()  → public   (PostgREST default; the Proxy leaves it untouched)
//   .from() → app_data  (explicitly switched)
//
// Security: the anon key is browser-safe (RLS is the gate). The returned URL is
// the caller's OWN tenant plane only — never an enumeration of other tenants.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface MintResponse {
  token: string;
  exp: number;
  url: string;
  anon_key: string;
}

const REFRESH_BUFFER = 60;

let cached: MintResponse | null = null;
let inflight: Promise<MintResponse> | null = null;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function cacheIsFresh(): boolean {
  return !!cached && cached.exp - nowSeconds() > REFRESH_BUFFER;
}

async function fetchTenantMint(): Promise<MintResponse> {
  if (cacheIsFresh() && cached) return cached;
  if (inflight) return inflight;

  inflight = fetch('/.netlify/functions/mint-tenant-jwt', { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`mint-tenant-jwt: ${res.status} ${res.statusText}`);
      const body = (await res.json()) as MintResponse;
      if (!body.token || typeof body.exp !== 'number' || !body.url || !body.anon_key) {
        throw new Error('mint-tenant-jwt: malformed response');
      }
      cached = body;
      return body;
    })
    .finally(() => { inflight = null; });

  return inflight;
}

export function clearTenantJwt(): void {
  cached = null;
}

/**
 * Build a Supabase client pointing at the session tenant's data plane, with
 * schema routing: .rpc() → public, .from() → app_data. The URL + anon key come
 * from the mint response (tenant_routing), not a build-time env var.
 */
export async function createTenantDataClient(): Promise<SupabaseClient> {
  const first = await fetchTenantMint();

  const client = createClient(first.url, first.anon_key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${first.token}` },
      fetch: async (input, init) => {
        const fresh = await fetchTenantMint();
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${fresh.token}`);
        headers.set('apikey', fresh.anon_key);
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
