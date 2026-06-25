// GET /.netlify/functions/list-members?tenant=<slug>
//
// Server-to-server endpoint returning a tenant's member roster from canonical
// (shell_control on eq-canonical / jvkn). EQ Service calls this to read identity
// live instead of trusting its drifted local service.profiles/tenant_members.
//
// Phase 1 of the "Service ← canonical identity" seam (Mechanism A, design locked
// 2026-06-25). Service stores the CANONICAL Shell user id on every reference, so
// `id` in the response is shell_control.users.id — that is the whole point.
//
// Auth: shared-secret header `x-eq-service-key` compared (timing-safe) against
//   EQ_SERVICE_API_KEY. This is a server-to-server roster, not a session — no
//   cookie, no platform-admin leakage. The SAME secret value must be set on the
//   eq-service Netlify site (Phase 2 consumer).
//   - 503 if EQ_SERVICE_API_KEY is unset (server misconfigured)
//   - 401 on missing/mismatched header
//
// Source:
//   shell_control.users u
//   JOIN shell_control.user_tenant_memberships m ON m.user_id = u.id
//   WHERE m.tenant_id = <resolved from slug> AND u.active AND m.active
// Returns: [{ id, email, name, role, active }]  (role = per-tenant membership role)

import type { Context } from '@netlify/functions';
import { timingSafeEqual } from 'node:crypto';
import { getServiceClient } from './_shared/supabase.js';
import type { EqRole } from './_shared/supabase.js';
import { withSentry } from './_shared/sentry.js';

interface MemberRow {
  id: string;
  email: string;
  name: string | null;
  role: EqRole;
  active: boolean;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Constant-time comparison of the shared secret. timingSafeEqual throws on
// length mismatch, so guard length first — a length difference is the only
// thing this leaks, matching the constant-time pattern in canonical-api.ts.
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const expectedKey = process.env.EQ_SERVICE_API_KEY;
  if (!expectedKey) {
    return jsonResponse(503, { error: 'Server misconfigured — missing EQ_SERVICE_API_KEY' });
  }

  const providedKey = req.headers.get('x-eq-service-key') ?? '';
  if (!secretMatches(providedKey, expectedKey)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const slug = new URL(req.url).searchParams.get('tenant')?.trim();
  if (!slug) {
    return jsonResponse(400, { error: 'Missing tenant slug — pass ?tenant=<slug>' });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  // Resolve slug → tenant id (active tenants only), the same lookup
  // token-exchange.ts performs against shell_control.tenants.
  const { data: tenant, error: tenantErr } = await sb
    .schema('shell_control')
    .from('tenants')
    .select('id, active')
    .eq('slug', slug)
    .maybeSingle<{ id: string; active: boolean }>();

  if (tenantErr) return jsonResponse(500, { error: 'Failed to resolve tenant' });
  if (!tenant || !tenant.active) return jsonResponse(404, { error: 'Unknown or inactive tenant' });

  // Active memberships for this tenant, embedding the active user record.
  // !inner drops memberships whose user is inactive (or absent).
  const { data, error } = await sb
    .schema('shell_control')
    .from('user_tenant_memberships')
    .select('role, users!inner(id, email, name, active)')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .eq('users.active', true);

  if (error) return jsonResponse(500, { error: 'Failed to read members' });

  type Row = {
    role: EqRole;
    // PostgREST returns the to-one embed as an object, but the generated
    // generic widens it to an array — normalise below.
    users: { id: string; email: string; name: string | null; active: boolean }
         | { id: string; email: string; name: string | null; active: boolean }[]
         | null;
  };

  const members: MemberRow[] = [];
  for (const row of (data ?? []) as unknown as Row[]) {
    const u = Array.isArray(row.users) ? row.users[0] : row.users;
    if (!u) continue;
    members.push({ id: u.id, email: u.email, name: u.name, role: row.role, active: u.active });
  }

  return jsonResponse(200, members);
});
