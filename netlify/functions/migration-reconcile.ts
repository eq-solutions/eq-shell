// GET /.netlify/functions/migration-reconcile
//
// Migration reconciliation for the admin/migration view. For the signed-in
// tenant, returns one row per canonical entity with:
//   - expected : baseline written by the migration scripts (app_data.migration_baseline)
//   - landed   : actual rows in the tenant data plane (eq_migration_counts RPC)
//   - delta    : landed − expected (null when no baseline captured)
//   - orphans  : child rows that landed but lost their parent link, summed
//     across the entity's FKs (eq_migration_orphans RPC) — the silent failure
//     a count-match can't catch
//   - flagged / rejected : rolled up from intake events, if any flowed through
//     the Intake pipe (best-effort; direct-script migrations show 0)
//   - last_activity : most recent intake event for that entity, if any
//
// Data planes (mirrors tenant-dashboard's split):
//   - tenant plane (per-tenant Supabase via tenant_routing): landed counts +
//     orphan scan (RPCs) and the expected baseline (app_data table read).
//   - control plane (shared eq-canonical, shell_control): intake events.
//
// Session-authed via the eq_shell_session cookie; tenant is taken from the
// session, never the query string. Returns:
//   { ok: true, rows: [...] }  |  { ok: false, error: '<code>' }

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import {
  getTenantRpcClientById,
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

// Canonical entity (singular) → app_data table name. Mirrors ENTITY_TABLE_MAP
// in src/modules/intake/EntityImportPanel.tsx — used only to fold singular
// intake-event entities onto the table-name keys the RPCs return. A gap here
// just means an entity's flagged/rejected enrichment is skipped.
const SINGULAR_TO_TABLE: Record<string, string> = {
  customer: 'customers', contact: 'contacts', site: 'sites',
  licence: 'licences', asset: 'assets',
  staff: 'staff', schedule: 'schedule_entries', prestart: 'prestart_checks',
  toolbox_talk: 'toolbox_talks', swms: 'swms', jsa: 'jsa_records',
  itp: 'itp_records', incident: 'incidents', timesheet: 'timesheets',
  leave_request: 'leave_requests', leave_balance: 'leave_balances',
  checkin: 'checkins', tender: 'tenders', site_diary: 'site_diaries',
  weekly_report: 'weekly_reports', apprentice_profile: 'apprentice_profiles',
};

// app_data table name → the singular entity the /data/:entity browser accepts
// (entity-rows.ts ALLOWED_ENTITIES). Drives the per-row "drill in" link; a
// missing entry just means no link for that entity.
const TABLE_TO_BROWSE: Record<string, string> = {
  customers: 'customer', contacts: 'contact', sites: 'site', staff: 'staff',
  schedule_entries: 'schedule', timesheets: 'timesheet',
  leave_requests: 'leave_request', tenders: 'tender',
  prestart_checks: 'prestart', toolbox_talks: 'toolbox_talk',
  licences: 'licence', assets: 'asset',
};

// app_data bookkeeping / cross-app tables that aren't "migrated entities".
// Hidden from the reconciliation view to avoid noise.
const HIDDEN_ENTITIES = new Set<string>(['canonical_events', 'tenant_app_configs', 'migration_baseline']);

interface OrphanDetail {
  fk: string;          // FK constraint name
  parent: string;      // parent table the link points at
  count: number;
}

interface ReconcileRow {
  entity:        string;          // app_data table name
  label:         string;          // humanized
  expected:      number | null;   // baseline; null when not captured
  landed:        number;          // actual rows in tenant DB
  delta:         number | null;   // landed − expected; null without a baseline
  orphans:       number;          // total broken-link rows across this entity's FKs
  orphan_detail: OrphanDetail[];  // per-FK breakdown (only non-zero)
  flagged:       number;
  rejected:      number;
  last_activity: string | null;   // ISO; most recent intake event for the entity
  browse_entity: string | null;   // singular key for /data/:entity, or null
}

function humanize(table: string): string {
  return table.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });

  const tenantId = session.tenant_id;

  // tenantRpc (public-default) for the count + orphan RPCs; tenantData
  // (app_data-default) for the baseline table read. Separate clients — see the
  // schema-switch caveat in tenant-dashboard.ts.
  let tenantRpc;
  let tenantData;
  try {
    [tenantRpc, tenantData] = await Promise.all([
      getTenantRpcClientById(tenantId),
      getTenantDataClientById(tenantId),
    ]);
  } catch (e) {
    return tenantRoutingError(e);
  }
  const shared = getServiceClient();

  const [landedRes, orphanRes, baselineRes, intakeRes] = await Promise.all([
    tenantRpc.rpc('eq_migration_counts', { p_tenant_id: tenantId }),
    tenantRpc.rpc('eq_migration_orphans', { p_tenant_id: tenantId }),
    tenantData.from('migration_baseline').select('entity, expected_count').eq('tenant_id', tenantId),
    shared
      .from('eq_intake_events')
      .select('entity, rows_flagged, rows_rejected, started_at')
      .eq('tenant_id', tenantId),
  ]);

  if (landedRes.error) {
    console.error('[migration-reconcile] landed counts failed', { tenantId, error: landedRes.error.message });
    return json(500, { ok: false, error: 'counts_failed' });
  }
  // Orphan scan + baseline are non-fatal — degrade rather than 500 the whole view.
  if (orphanRes.error) {
    console.warn('[migration-reconcile] orphan scan failed', { tenantId, error: orphanRes.error.message });
  }
  if (baselineRes.error) {
    console.warn('[migration-reconcile] baseline read failed', { tenantId, error: baselineRes.error.message });
  }
  if (intakeRes.error) {
    console.warn('[migration-reconcile] intake rollup failed', { tenantId, error: intakeRes.error.message });
  }

  const landed = new Map<string, number>();
  for (const row of (landedRes.data ?? []) as { entity: string; landed_count: number }[]) {
    landed.set(row.entity, Number(row.landed_count));
  }

  const expected = new Map<string, number>();
  for (const row of (!baselineRes.error ? (baselineRes.data ?? []) : []) as { entity: string; expected_count: number }[]) {
    expected.set(row.entity, Number(row.expected_count));
  }

  // Orphans roll up per child table (= entity key).
  const orphanTotal  = new Map<string, number>();
  const orphanDetail = new Map<string, OrphanDetail[]>();
  for (const o of (!orphanRes.error ? (orphanRes.data ?? []) : []) as
    { child_table: string; fk_name: string; parent_table: string; orphan_count: number }[]) {
    const c = Number(o.orphan_count);
    orphanTotal.set(o.child_table, (orphanTotal.get(o.child_table) ?? 0) + c);
    const list = orphanDetail.get(o.child_table) ?? [];
    list.push({ fk: o.fk_name, parent: o.parent_table, count: c });
    orphanDetail.set(o.child_table, list);
  }

  // Fold intake events onto table-name keys.
  const flagged  = new Map<string, number>();
  const rejected = new Map<string, number>();
  const lastSeen = new Map<string, string>();
  for (const ev of (!intakeRes.error ? (intakeRes.data ?? []) : []) as
    { entity: string; rows_flagged: number; rows_rejected: number; started_at: string }[]) {
    const table = SINGULAR_TO_TABLE[ev.entity] ?? ev.entity;
    flagged.set(table, (flagged.get(table) ?? 0) + (ev.rows_flagged ?? 0));
    rejected.set(table, (rejected.get(table) ?? 0) + (ev.rows_rejected ?? 0));
    const prev = lastSeen.get(table);
    if (ev.started_at && (!prev || ev.started_at > prev)) lastSeen.set(table, ev.started_at);
  }

  // Union of every entity we know something about.
  const keys = new Set<string>([
    ...landed.keys(), ...expected.keys(), ...orphanTotal.keys(), ...flagged.keys(),
  ]);
  HIDDEN_ENTITIES.forEach((h) => keys.delete(h));

  const rows: ReconcileRow[] = [...keys].sort().map((entity) => {
    const exp = expected.has(entity) ? expected.get(entity)! : null;
    const land = landed.get(entity) ?? 0;
    return {
      entity,
      label:         humanize(entity),
      expected:      exp,
      landed:        land,
      delta:         exp === null ? null : land - exp,
      orphans:       orphanTotal.get(entity) ?? 0,
      orphan_detail: orphanDetail.get(entity) ?? [],
      flagged:       flagged.get(entity) ?? 0,
      rejected:      rejected.get(entity) ?? 0,
      last_activity: lastSeen.get(entity) ?? null,
      browse_entity: TABLE_TO_BROWSE[entity] ?? null,
    };
  });

  return json(200, { ok: true, rows });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { ok: false, error: 'tenant_not_provisioned', detail: e.identifier });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { ok: false, error: 'tenant_inactive', detail: e.status });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[migration-reconcile] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[migration-reconcile] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
