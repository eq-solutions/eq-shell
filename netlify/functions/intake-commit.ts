// POST /.netlify/functions/intake-commit
//
// Orchestrator for the staged intake-writer migration (Phase 2.B.6 in
// docs/ARCHITECTURE-V2.md). Sits between the browser (or Cards mobile, or
// any future intake UI) and the per-tenant data plane.
//
// Replaces the direct `supabase.rpc('eq_intake_commit_batch', ...)` call
// that used to write to shared eq-canonical app_data. New flow:
//
//   1. Validate session (eq_shell_session cookie).
//   2. Validate body: { intake_id, table, rows, source_sig,
//      schema_version, import_mode, confirm_replace }.
//   3. Look up the module from shell_control.eq_schema_registry by
//      mapping table → entity → module. Reject if not implemented.
//   4. Open the caller's tenant data plane (getTenantDataClientById).
//   5. Call eq_intake_commit_batch_<module>(intake_id, tenant_id, table,
//      rows, source_sig, schema_version, import_mode, confirm_replace)
//      on the tenant DB.
//   6. On success, increment shell_control.eq_intake_events.rows_committed
//      on the control plane.
//   7. Return { committed_count, committed_ids } in the same shape the
//      old RPC returned, so callers don't have to change their post-commit
//      handling.
//
// Audit-on-shared / data-on-tenant is the central architectural trade.
// The two writes aren't in a Postgres transaction together — if step 5
// succeeds and step 6 fails, data is committed but the audit counter is
// stale. Caller can re-derive the count from app_data.<table> filtered
// by intake_id (the rows carry it) if precise reconciliation is needed.
//
// Currently implemented modules: cards (licences).
// Other modules return 501 not_implemented — they ship in subsequent PRs
// per the staged plan in ARCHITECTURE-V2.md.

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
import { withSentry } from './_shared/sentry.js';

// Table → module mapping. Mirrors the dispatcher in shared
// eq_intake_commit_batch (and eq_schema_registry.module). Kept here so we
// don't need a control-plane round-trip just to learn which tenant DB RPC
// to call.
const TABLE_MODULE: Record<string, IntakeModule> = {
  // cards
  licences: 'cards',
  // service
  assets: 'service',
  // quotes
  quote: 'quotes',
  quote_line_item: 'quotes',
  quote_status_history: 'quotes',
  quote_attachment: 'quotes',
  quote_email_outbox: 'quotes',
  scope_template: 'quotes',
  rate_library: 'quotes',
  // core (SimPRO flow)
  customers: 'core',
  contacts: 'core',
  sites: 'core',
  // field (representative subset — full list lands with the field module PR)
  staff: 'field',
  schedule_entries: 'field',
  timesheets: 'field',
  leave_requests: 'field',
  prestart_checks: 'field',
  toolbox_talks: 'field',
  swms: 'field',
  jsa_records: 'field',
  itp_records: 'field',
  incidents: 'field',
  tenders: 'field',
};

type IntakeModule = 'cards' | 'service' | 'quotes' | 'core' | 'field';
type ImportMode  = 'append' | 'upsert' | 'replace';

// Modules implemented on tenant data plane so far. Add to this set as
// each per-module PR lands.
const IMPLEMENTED_MODULES: ReadonlySet<IntakeModule> = new Set<IntakeModule>(['cards']);

interface CommitBody {
  intake_id:        string;
  table:            string;
  rows:             unknown[];
  source_sig:       string;
  schema_version:   string;
  import_mode?:     ImportMode;
  confirm_replace?: boolean;
}

interface CommitOk {
  ok:               true;
  module:           IntakeModule;
  committed_count:  number;
  committed_ids:    string[];
}

interface CommitErr {
  ok:     false;
  error:  string;
  detail?: string;
}

function json(status: number, body: CommitOk | CommitErr): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  // Two accepted auth paths:
  //   1. Browser: eq_shell_session cookie (HMAC) → verifySessionToken
  //   2. Non-browser (Cards mobile, future eq-quotes Flask, future external
  //      bulk-import jobs): Authorization: Bearer <supabase_jwt> → minted by
  //      /.netlify/functions/mint-supabase-jwt, verified here against
  //      SUPABASE_JWT_SECRET. Tenant_id is read from app_metadata.tenant_id.
  // Either method gives us a tenant_id we trust to scope the commit.
  let tenantId: string;
  let callerKind: 'session' | 'jwt';

  const session = verifySessionToken(readSessionCookie(req));
  if (session) {
    tenantId   = session.tenant_id;
    callerKind = 'session';
  } else {
    const jwt = verifySupabaseJwt(readBearerJwt(req));
    if (!jwt) return json(401, { ok: false, error: 'not_signed_in' });
    tenantId   = jwt.app_metadata.tenant_id;
    callerKind = 'jwt';
  }

  // ─── body validation ────────────────────────────────────────────────
  let body: CommitBody;
  try {
    body = (await req.json()) as CommitBody;
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
  if (body.rows.length === 0) {
    // Empty batch is fine — return 0 committed without touching the DB.
    return json(200, { ok: true, module: 'cards', committed_count: 0, committed_ids: [] });
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
  const confirmReplace = body.confirm_replace === true;

  // ─── route by module ────────────────────────────────────────────────
  const moduleName = TABLE_MODULE[body.table];
  if (!moduleName) {
    return json(400, { ok: false, error: 'unknown_table', detail: body.table });
  }
  if (!IMPLEMENTED_MODULES.has(moduleName)) {
    return json(501, {
      ok: false,
      error: 'module_not_implemented',
      detail: `module ${moduleName} hasn't been migrated to tenant data plane yet — caller should keep using sb.rpc('eq_intake_commit_batch') for now`,
    });
  }

  // ─── open tenant DB ─────────────────────────────────────────────────
  // tenantId resolved above from either session cookie or JWT.
  void callerKind; // surfaced for logging in a future revision
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  // ─── commit batch on tenant DB ──────────────────────────────────────
  const rpcName = `eq_intake_commit_batch_${moduleName}`;
  const { data, error } = await tenantAny
    .schema('public')
    .rpc(rpcName, {
      p_intake_id:       body.intake_id,
      p_tenant_id:       tenantId,
      p_table:           body.table,
      p_rows:            body.rows,
      p_source_sig:      body.source_sig,
      p_schema_version:  body.schema_version,
      p_import_mode:     importMode,
      p_confirm_replace: confirmReplace,
    });

  if (error) {
    console.error('[intake-commit] tenant rpc failed', {
      module: moduleName,
      table: body.table,
      intake_id: body.intake_id,
      error: error.message,
    });
    return json(500, { ok: false, error: 'tenant_rpc_failed', detail: error.message });
  }

  // RPC returns TABLE(committed_count integer, committed_ids uuid[]) — one row.
  // supabase-js shapes that as Array<{ committed_count, committed_ids }>.
  const row = Array.isArray(data) ? data[0] : data;
  const committedCount = (row?.committed_count as number) ?? 0;
  const committedIds   = (row?.committed_ids as string[]) ?? [];

  // ─── audit increment on control plane ───────────────────────────────
  // Best-effort. Data is already committed by this point — if the audit
  // update fails, the user's import succeeded but the counter shows stale.
  // Recoverable: re-derive count by `SELECT count(*) WHERE intake_id = ?`
  // against the tenant DB.
  if (committedCount > 0) {
    const shared = getServiceClient();
    const { error: auditErr } = await shared.rpc('_eq_intake_record_committed', {
      p_intake_id: body.intake_id,
      p_count:     committedCount,
    });
    if (auditErr) {
      console.warn('[intake-commit] audit increment failed (data already committed)', {
        intake_id: body.intake_id,
        committed: committedCount,
        error:     auditErr.message,
      });
    }
  }

  return json(200, {
    ok:               true,
    module:           moduleName,
    committed_count:  committedCount,
    committed_ids:    committedIds,
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
    console.error('[intake-commit] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[intake-commit] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
