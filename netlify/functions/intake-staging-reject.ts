// POST /.netlify/functions/intake-staging-reject
//
// Decline staged rows. Marks them 'rejected' with a reason — they never reach
// the entity tables. Then finalises the control-plane event: if no rows remain
// pending, the batch becomes 'completed' (some were committed) or 'rejected'
// (none were).
//
// Body: { intake_id, staging_ids?, reason? }
//   staging_ids omitted → reject every still-pending row in the batch.
//
// Auth: intake.commit — rejecting is part of the same reviewer gate as approving.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { verifySupabaseJwt, readBearerJwt } from './_shared/supabase-jwt.js';
import { can, type Principal } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

interface RejectBody {
  intake_id:    string;
  staging_ids?: string[];
  reason?:      string;
}

interface RejectOk {
  ok:                true;
  rejected_count:    number;
  remaining_pending: number;
}

interface RejectErr {
  ok:      false;
  error:   string;
  detail?: string;
}

function json(status: number, body: RejectOk | RejectErr): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  // ─── auth ────────────────────────────────────────────────────────────────
  let tenantId: string;
  let principal: Principal;
  let reviewerId: string | null = null;

  const session = verifySessionToken(readSessionCookie(req));
  if (session) {
    tenantId   = session.tenant_id;
    principal  = { role: session.role, is_platform_admin: session.is_platform_admin };
    reviewerId = session.user_id;
  } else {
    const jwt = verifySupabaseJwt(readBearerJwt(req));
    if (!jwt) return json(401, { ok: false, error: 'not_signed_in' });
    tenantId  = jwt.app_metadata.tenant_id;
    principal = { role: jwt.app_metadata.eq_role, is_platform_admin: jwt.app_metadata.is_platform_admin };
  }
  if (!can(principal, 'intake.commit')) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  // ─── body ──────────────────────────────────────────────────────────────
  let body: RejectBody;
  try {
    body = (await req.json()) as RejectBody;
  } catch {
    return json(400, { ok: false, error: 'invalid_body' });
  }
  if (!body.intake_id || !UUID_RE.test(body.intake_id)) {
    return json(400, { ok: false, error: 'invalid_intake_id' });
  }
  if (body.staging_ids !== undefined) {
    if (!Array.isArray(body.staging_ids) || !body.staging_ids.every((s) => typeof s === 'string' && UUID_RE.test(s))) {
      return json(400, { ok: false, error: 'invalid_staging_ids' });
    }
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() !== '' ? body.reason.trim() : null;

  // ─── open tenant DB + reject the pending rows ────────────────────────────
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  const nowIso = new Date().toISOString();
  let upd = tenantAny
    .from('eq_intake_staging')
    .update({ status: 'rejected', reject_reason: reason, reviewed_by: reviewerId, reviewed_at: nowIso, updated_at: nowIso })
    .eq('tenant_id', tenantId)
    .eq('intake_id', body.intake_id)
    .eq('status', 'pending');
  if (body.staging_ids) upd = upd.in('staging_id', body.staging_ids);
  const { data: rejected, error: rejErr } = await upd.select('staging_id');
  if (rejErr) return json(500, { ok: false, error: 'reject_failed', detail: rejErr.message });

  const rejectedCount = (rejected ?? []).length;

  // ─── finalise the control-plane event ────────────────────────────────────
  const shared = getServiceClient(); // shell_control default

  // Bump rows_rejected (read-modify-write; single reviewer, race is benign).
  if (rejectedCount > 0) {
    const { data: evt } = await shared
      .from('eq_intake_events')
      .select('rows_rejected')
      .eq('intake_id', body.intake_id)
      .eq('tenant_id', tenantId)
      .maybeSingle<{ rows_rejected: number }>();
    const prior = evt?.rows_rejected ?? 0;
    await shared
      .from('eq_intake_events')
      .update({ rows_rejected: prior + rejectedCount })
      .eq('intake_id', body.intake_id)
      .eq('tenant_id', tenantId);
  }

  // If nothing's left pending, close the batch out. 'completed' if any row was
  // committed, else 'rejected' (a wholly-declined batch).
  const remaining = await countByStatus(tenantAny, tenantId, body.intake_id, 'pending');
  if (remaining === 0) {
    const committed = await countByStatus(tenantAny, tenantId, body.intake_id, 'committed');
    await shared
      .from('eq_intake_events')
      .update({ status: committed > 0 ? 'completed' : 'rejected', completed_at: nowIso })
      .eq('intake_id', body.intake_id)
      .eq('tenant_id', tenantId);
  }

  return json(200, { ok: true, rejected_count: rejectedCount, remaining_pending: remaining });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countByStatus(tenantAny: any, tenantId: string, intakeId: string, status: string): Promise<number> {
  const { count } = await tenantAny
    .from('eq_intake_staging')
    .select('staging_id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('intake_id', intakeId)
    .eq('status', status);
  return count ?? 0;
}

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) return json(500, { ok: false, error: 'tenant_not_provisioned', detail: e.identifier });
  if (e instanceof TenantNotActiveError) return json(503, { ok: false, error: 'tenant_inactive', detail: e.status });
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[intake-staging-reject] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[intake-staging-reject] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
