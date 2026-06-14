// POST /.netlify/functions/intake-staging-approve
//
// Second half of the review-queue flow. Takes staged rows that a reviewer has
// accepted and replays the EXISTING per-module commit RPC
// (eq_intake_commit_batch_<module>) with just those rows — so approval reuses
// the entire proven commit path, no new write logic. Then marks the staged
// rows 'committed' and finalises the control-plane event.
//
// Body: { intake_id, staging_ids?, confirm_replace? }
//   staging_ids omitted → approve every still-pending row in the batch.
//   staging_ids present  → approve only those (the rest stay pending or get
//                          rejected separately).
//
// Auth: intake.commit (supervisor + manager) — committing is the destructive
// step; the UI hides the button for lesser roles but a direct POST is gated here.

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

interface ApproveBody {
  intake_id:        string;
  staging_ids?:     string[];
  confirm_replace?: boolean;
}

interface ApproveOk {
  ok:                true;
  committed_count:   number;
  committed_ids:     string[];
  remaining_pending: number;
}

interface ApproveErr {
  ok:      false;
  error:   string;
  detail?: string;
}

function json(status: number, body: ApproveOk | ApproveErr): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StagedRow {
  staging_id:       string;
  source_row_index: number;
  target_table:     string;
  module:           string;
  canonical:        Record<string, unknown>;
}

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
  let body: ApproveBody;
  try {
    body = (await req.json()) as ApproveBody;
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

  // ─── read the event (for source_sig + schema_version + import_mode) ──────
  const shared = getServiceClient(); // shell_control default
  const { data: evt, error: evtErr } = await shared
    .from('eq_intake_events')
    .select('source_filename, schema_version, import_mode')
    .eq('intake_id', body.intake_id)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ source_filename: string | null; schema_version: string; import_mode: string | null }>();
  if (evtErr) return json(500, { ok: false, error: 'event_read_failed', detail: evtErr.message });
  if (!evt) return json(404, { ok: false, error: 'intake_not_found' });

  // ─── open tenant DB + load the pending rows to approve ───────────────────
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  let q = tenantAny
    .from('eq_intake_staging')
    .select('staging_id, source_row_index, target_table, module, canonical')
    .eq('tenant_id', tenantId)
    .eq('intake_id', body.intake_id)
    .eq('status', 'pending');
  if (body.staging_ids) q = q.in('staging_id', body.staging_ids);
  const { data: staged, error: stagedErr } = await q.order('source_row_index', { ascending: true });
  if (stagedErr) return json(500, { ok: false, error: 'staging_read_failed', detail: stagedErr.message });

  const rows = (staged ?? []) as StagedRow[];
  if (rows.length === 0) {
    const remaining = await countPending(tenantAny, tenantId, body.intake_id);
    return json(200, { ok: true, committed_count: 0, committed_ids: [], remaining_pending: remaining });
  }

  // A batch is one entity/table, so every staged row shares table + module.
  const table = rows[0].target_table;
  const moduleName = rows[0].module;

  // ─── replay the existing per-module commit RPC for the approved rows ─────
  const rpcName = `eq_intake_commit_batch_${moduleName}`;
  const { data: rpcData, error: rpcErr } = await tenantAny
    .schema('public')
    .rpc(rpcName, {
      p_intake_id:       body.intake_id,
      p_tenant_id:       tenantId,
      p_table:           table,
      p_rows:            rows.map((r) => r.canonical),
      p_source_sig:      evt.source_filename ?? `shell-${table}`,
      p_schema_version:  evt.schema_version,
      p_import_mode:     evt.import_mode ?? 'append',
      p_confirm_replace: body.confirm_replace === true,
    });
  if (rpcErr) {
    // Staged rows stay 'pending' — nothing committed, nothing lost. The
    // reviewer can retry once the cause (e.g. a bad FK) is resolved.
    console.error('[intake-staging-approve] commit rpc failed', {
      module: moduleName, table, intake_id: body.intake_id, error: rpcErr.message,
    });
    return json(500, { ok: false, error: 'commit_failed', detail: rpcErr.message });
  }

  const rpcRow = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  const committedCount = (rpcRow?.committed_count as number) ?? rows.length;
  const committedIds   = (rpcRow?.committed_ids as string[]) ?? [];

  // ─── mark the approved staged rows committed ─────────────────────────────
  // committed_id link is left for a follow-up — the committed app_data rows
  // already carry intake_id, so the batch->rows link exists; per-row id mapping
  // is extra precision not needed for v1.
  const nowIso = new Date().toISOString();
  const { error: updErr } = await tenantAny
    .from('eq_intake_staging')
    .update({ status: 'committed', committed_at: nowIso, reviewed_by: reviewerId, reviewed_at: nowIso, updated_at: nowIso })
    .eq('tenant_id', tenantId)
    .eq('intake_id', body.intake_id)
    .in('staging_id', rows.map((r) => r.staging_id));
  if (updErr) {
    // Data IS committed; only the staging bookkeeping failed. Surface it but
    // don't 500 — the rows are in app_data.
    console.warn('[intake-staging-approve] staging status update failed (data committed)', {
      intake_id: body.intake_id, error: updErr.message,
    });
  }

  // ─── finalise the control-plane event ────────────────────────────────────
  if (committedCount > 0) {
    const { error: auditErr } = await shared.rpc('_eq_intake_record_committed', {
      p_intake_id: body.intake_id,
      p_count:     committedCount,
    });
    if (auditErr) {
      console.warn('[intake-staging-approve] audit increment failed (data committed)', {
        intake_id: body.intake_id, error: auditErr.message,
      });
    }
  }

  // If nothing's left pending, the batch is done.
  const remaining = await countPending(tenantAny, tenantId, body.intake_id);
  if (remaining === 0) {
    await shared
      .from('eq_intake_events')
      .update({ status: 'completed', completed_at: nowIso })
      .eq('intake_id', body.intake_id)
      .eq('tenant_id', tenantId);
  }

  return json(200, {
    ok: true,
    committed_count: committedCount,
    committed_ids: committedIds,
    remaining_pending: remaining,
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countPending(tenantAny: any, tenantId: string, intakeId: string): Promise<number> {
  const { count } = await tenantAny
    .from('eq_intake_staging')
    .select('staging_id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('intake_id', intakeId)
    .eq('status', 'pending');
  return count ?? 0;
}

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) return json(500, { ok: false, error: 'tenant_not_provisioned', detail: e.identifier });
  if (e instanceof TenantNotActiveError) return json(503, { ok: false, error: 'tenant_inactive', detail: e.status });
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[intake-staging-approve] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[intake-staging-approve] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
