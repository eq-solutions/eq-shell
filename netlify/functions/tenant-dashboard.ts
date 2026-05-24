// GET /.netlify/functions/tenant-dashboard
//
// Aggregated payload for the TenantHome dashboard. Pulls from two data
// planes in parallel:
//
//   1. Dashboard counts → tenant DB (app_data, via the per-tenant Supabase
//      project resolved through shell_control.tenant_routing).
//   2. Recent intake events → shared eq-canonical (shell_control schema —
//      intake events are cross-tenant audit, they stay on the control
//      plane).
//
// Session-authed via the eq_shell_session cookie. Returns one envelope:
//   { ok: true, counts: [...], events: [...] }
//   { ok: false, error: '<code>' }

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

interface DashboardCount {
  entity: string;
  count_total: number;
  count_recent: number;
}

interface IntakeEvent {
  intake_id:        string;
  entity:           string;
  source_app:       string | null;
  source_filename:  string | null;
  status:           string;
  rows_committed:   number;
  rows_flagged:     number;
  rows_rejected:    number;
  started_at:       string;
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
  const eventLimit = Math.min(
    Math.max(parseInt(new URL(req.url).searchParams.get('events_limit') ?? '5', 10), 1),
    20,
  );

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;
  const shared = getServiceClient();

  const [countsRes, eventsRes] = await Promise.all([
    // Counts come from the tenant data plane. Service-role calls don't
    // carry a JWT, so the RPC takes tenant_id as a parameter instead of
    // reading auth.jwt() (see supabase/tenant-migrations/0003_dashboard_rpcs.sql).
    tenantAny
      .schema('public')
      .rpc('eq_tenant_dashboard_counts', { p_tenant_id: tenantId }),
    // Intake events stay on the control plane (cross-tenant audit table).
    // Direct SELECT — no RPC needed; service-role bypasses RLS, we filter
    // explicitly.
    shared
      .from('eq_intake_events')
      .select('intake_id, entity, source_app, source_filename, status, rows_committed, rows_flagged, rows_rejected, started_at')
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false, nullsFirst: false })
      .limit(eventLimit),
  ]);

  if (countsRes.error) {
    console.error('[tenant-dashboard] counts query failed', { tenantId, error: countsRes.error.message });
    return json(500, { ok: false, error: 'counts_failed', detail: countsRes.error.message });
  }
  if (eventsRes.error) {
    console.error('[tenant-dashboard] events query failed', { tenantId, error: eventsRes.error.message });
    return json(500, { ok: false, error: 'events_failed', detail: eventsRes.error.message });
  }

  return json(200, {
    ok:     true,
    counts: (countsRes.data ?? []) as DashboardCount[],
    events: (eventsRes.data ?? []) as IntakeEvent[],
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
    console.error('[tenant-dashboard] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[tenant-dashboard] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
