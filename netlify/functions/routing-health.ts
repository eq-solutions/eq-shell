// GET /.netlify/functions/routing-health
//
// Zero-auth health check that exercises the full tenant routing stack:
//   1. TENANT_ROUTING_MASTER_KEY is present + valid hex
//   2. jvkn control-plane is reachable (shell_control.tenant_routing read)
//   3. AES-256-GCM decrypt succeeds for the 'sks' tenant routing row
//   4. Decrypted service_role_key looks like a Supabase JWT (starts with "eyJ")
//
// Returns { ok: true, checks: { key_present, routing_row, decrypt, key_shape } }
// or      { ok: false, failed: string, error: string }
//
// No credentials, no session required — safe to call from monitoring / CI.
// DOES NOT expose the key or decrypted value.

import type { Context } from '@netlify/functions';
import { hasMasterKey } from './_shared/encryption.js';
import { getRoutingBySlug, flushRoutingCache } from './_shared/tenant-routing.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async (_req: Request, _ctx: Context): Promise<Response> => {
  // Always flush cache so this is a live test, not a cached result.
  flushRoutingCache();

  const checks: Record<string, boolean> = {
    key_present: false,
    routing_row: false,
    decrypt:     false,
    key_shape:   false,
  };

  // 1. Master key present + valid
  if (!hasMasterKey()) {
    return json(503, { ok: false, failed: 'key_present', error: 'TENANT_ROUTING_MASTER_KEY not set or invalid' });
  }
  checks.key_present = true;

  // 2–4. Fetch + decrypt SKS routing row
  try {
    const routing = await getRoutingBySlug('sks', false); // requireActive=false — just test the decrypt
    checks.routing_row = true;
    checks.decrypt = true;
    // Supabase service-role JWTs always start with "eyJ" (base64 JSON header)
    checks.key_shape = routing.service_role_key.startsWith('eyJ');
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const failed = checks.routing_row ? 'decrypt' : 'routing_row';
    return json(503, { ok: false, failed, error: msg, checks });
  }

  const allPass = Object.values(checks).every(Boolean);
  return json(allPass ? 200 : 503, { ok: allPass, checks });
};
