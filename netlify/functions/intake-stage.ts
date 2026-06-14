// POST /.netlify/functions/intake-stage
//
// The review-queue front door, with row-level triage ("clean lands, flagged
// waits" — INTAKE-REDESIGN-SPEC.md). For each parsed batch it:
//
//   1. computes a health score + conflict report per row;
//   2. commits the CLEAN rows immediately, replaying the existing per-module
//      commit RPC (eq_intake_commit_batch_<module>) — no extra hop for the
//      common case;
//   3. parks only the BLOCKED rows (a conflict, or an error/warning flag) in
//      app_data.eq_intake_staging for a reviewer. Info-only flags (e.g. a
//      missing recommended field) are advisory and don't hold a row back.
//   4. finalises the control-plane event: 'completed' if nothing was held,
//      'pending_review' if some rows are waiting.
//
// So a pristine import behaves exactly like the old straight-to-DB path; only
// rows that actually warrant a human eye take the detour. Approval of the
// parked rows happens in intake-staging-approve, replaying the same RPC.
//
// Shape mirrors intake-commit (same auth, same table->module routing, same
// tenant-data-plane resolution). Auth: intake.commit (supervisor + manager).

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
import {
  TABLE_MODULE,
  IMPLEMENTED_MODULES,
  type IntakeModule,
  type ImportMode,
} from './_shared/intake-modules.js';
import { computeBatchHealth, type QueryExisting, type RowHealth } from './_shared/intake-health.js';

interface StageBody {
  intake_id:       string;
  entity?:         string;
  table:           string;
  rows:            unknown[];
  source_sig:      string;
  schema_version:  string;
  import_mode?:    ImportMode;
}

interface StageOk {
  ok:              true;
  module:          IntakeModule;
  intake_id:       string;
  committed_count: number; // rows that landed immediately (clean)
  committed_ids:   string[];
  staged_count:    number; // rows parked for review (blocked)
  health_score:    number; // 0..100, whole batch
  flagged_count:   number;
  conflict_count:  number;
}

interface StageErr {
  ok:      false;
  error:   string;
  detail?: string;
}

function json(status: number, body: StageOk | StageErr): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A row is held for review if it has any conflict or an error/warning flag. */
function needsReview(rh: RowHealth): boolean {
  if (rh.conflicts.length > 0) return true;
  return rh.health_flags.some((f) => f.severity === 'error' || f.severity === 'warning');
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  // ─── auth (same two paths as intake-commit) ─────────────────────────────
  let tenantId: string;
  let principal: Principal;

  const session = verifySessionToken(readSessionCookie(req));
  if (session) {
    tenantId  = session.tenant_id;
    principal = { role: session.role, is_platform_admin: session.is_platform_admin };
  } else {
    const jwt = verifySupabaseJwt(readBearerJwt(req));
    if (!jwt) return json(401, { ok: false, error: 'not_signed_in' });
    tenantId  = jwt.app_metadata.tenant_id;
    principal = { role: jwt.app_metadata.eq_role, is_platform_admin: jwt.app_metadata.is_platform_admin };
  }
  if (!can(principal, 'intake.commit')) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  // ─── body validation ────────────────────────────────────────────────────
  let body: StageBody;
  try {
    body = (await req.json()) as StageBody;
  } catch {
    return json(400, { ok: false, error: 'invalid_body', detail: 'body must be valid JSON' });
  }
  if (!body.intake_id || !UUID_RE.test(body.intake_id)) {
    return json(400, { ok: false, error: 'invalid_intake_id' });
  }
  if (!body.table || typeof body.table !== 'string') {
    return json(400, { ok: false, error: 'missing_table' });
  }
  if (!Array.isArray(body.rows)) {
    return json(400, { ok: false, error: 'rows_must_be_array' });
  }
  if (body.rows.length > 10_000) {
    return json(400, { ok: false, error: 'batch_too_large', detail: 'max 10,000 rows per call' });
  }
  if (!body.source_sig || typeof body.source_sig !== 'string') {
    return json(400, { ok: false, error: 'missing_source_sig' });
  }
  if (!body.schema_version || typeof body.schema_version !== 'string') {
    return json(400, { ok: false, error: 'missing_schema_version' });
  }
  const importMode: ImportMode = body.import_mode ?? 'append';
  if (!['append', 'upsert', 'replace'].includes(importMode)) {
    return json(400, { ok: false, error: 'invalid_import_mode' });
  }

  // ─── route by module ────────────────────────────────────────────────────
  const moduleName = TABLE_MODULE[body.table];
  if (!moduleName) {
    return json(400, { ok: false, error: 'unknown_table', detail: body.table });
  }
  if (!IMPLEMENTED_MODULES.has(moduleName)) {
    return json(501, { ok: false, error: 'module_not_implemented', detail: moduleName });
  }

  const entity = body.entity ?? body.table;
  const shared = getServiceClient(); // shell_control default
  const nowIso = new Date().toISOString();

  // Empty batch — finalise the event as completed, nothing to do.
  if (body.rows.length === 0) {
    await shared.from('eq_intake_events')
      .update({ status: 'completed', completed_at: nowIso, rows_committed: 0 })
      .eq('intake_id', body.intake_id).eq('tenant_id', tenantId);
    return json(200, {
      ok: true, module: moduleName, intake_id: body.intake_id,
      committed_count: 0, committed_ids: [], staged_count: 0,
      health_score: 100, flagged_count: 0, conflict_count: 0,
    });
  }

  // ─── open tenant DB ─────────────────────────────────────────────────────
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  const rows = body.rows as Array<Record<string, unknown>>;

  // ─── compute health + conflicts (service-role lookup must scope tenant) ──
  const queryExisting: QueryExisting = async (tbl, column, values) => {
    const { data, error } = await tenantAny
      .from(tbl).select('*').eq('tenant_id', tenantId).in(column, values);
    if (error) {
      console.warn('[intake-stage] conflict lookup failed', { table: tbl, column, error: error.message });
      return []; // degrade to "no conflict" — recoverable at review time
    }
    return (data ?? []) as Array<Record<string, unknown>>;
  };

  const health = await computeBatchHealth(body.table, rows, importMode, queryExisting);

  // ─── triage: clean vs blocked ────────────────────────────────────────────
  const blocked = health.rows.filter(needsReview);
  const blockedIdx = new Set(blocked.map((rh) => rh.source_row_index));
  const cleanRows = rows.filter((_, i) => !blockedIdx.has(i));

  // ─── 1. commit clean rows immediately ─────────────────────────────────────
  let committedCount = 0;
  let committedIds: string[] = [];
  if (cleanRows.length > 0) {
    const { data, error } = await tenantAny.schema('public').rpc(`eq_intake_commit_batch_${moduleName}`, {
      p_intake_id:       body.intake_id,
      p_tenant_id:       tenantId,
      p_table:           body.table,
      p_rows:            cleanRows,
      p_source_sig:      body.source_sig,
      p_schema_version:  body.schema_version,
      p_import_mode:     importMode,
      p_confirm_replace: false,
    });
    if (error) {
      console.error('[intake-stage] clean commit failed', { table: body.table, error: error.message });
      return json(500, { ok: false, error: 'commit_failed', detail: error.message });
    }
    const row = Array.isArray(data) ? data[0] : data;
    committedCount = (row?.committed_count as number) ?? cleanRows.length;
    committedIds   = (row?.committed_ids as string[]) ?? [];
  }

  // ─── 2. park blocked rows for review ─────────────────────────────────────
  if (blocked.length > 0) {
    const stagingRows = blocked.map((rh) => ({
      intake_id:        body.intake_id,
      tenant_id:        tenantId,
      entity,
      target_table:     body.table,
      module:           moduleName,
      source_row_index: rh.source_row_index,
      canonical:        rows[rh.source_row_index],
      row_health:       rh.row_health,
      health_flags:     rh.health_flags,
      conflicts:        rh.conflicts,
      status:           'pending',
    }));
    const { error: insErr } = await tenantAny.from('eq_intake_staging').insert(stagingRows);
    if (insErr) {
      // Clean rows are already committed — report the partial failure rather
      // than pretending the whole batch failed.
      console.error('[intake-stage] staging insert failed (clean rows committed)', {
        intake_id: body.intake_id, committed: committedCount, error: insErr.message,
      });
      return json(500, { ok: false, error: 'staging_insert_failed', detail: insErr.message });
    }
  }

  // ─── 3. finalise the control-plane event ─────────────────────────────────
  const stagedCount = blocked.length;
  const { error: evtErr } = await shared
    .from('eq_intake_events')
    .update({
      status:         stagedCount > 0 ? 'pending_review' : 'completed',
      completed_at:   stagedCount > 0 ? null : nowIso,
      rows_committed: committedCount,
      rows_flagged:   stagedCount,
      validation_summary: {
        health_score:   health.score,
        conflict_count: health.conflict_count,
        flagged_count:  health.flagged_count,
        committed_count: committedCount,
        staged_count:   stagedCount,
      },
    })
    .eq('intake_id', body.intake_id)
    .eq('tenant_id', tenantId);
  if (evtErr) {
    console.warn('[intake-stage] event finalise failed (rows already written)', {
      intake_id: body.intake_id, error: evtErr.message,
    });
  }

  return json(200, {
    ok:              true,
    module:          moduleName,
    intake_id:       body.intake_id,
    committed_count: committedCount,
    committed_ids:   committedIds,
    staged_count:    stagedCount,
    health_score:    health.score,
    flagged_count:   health.flagged_count,
    conflict_count:  health.conflict_count,
  });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { ok: false, error: 'tenant_not_provisioned', detail: e.identifier });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { ok: false, error: 'tenant_inactive', detail: e.status });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[intake-stage] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[intake-stage] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
