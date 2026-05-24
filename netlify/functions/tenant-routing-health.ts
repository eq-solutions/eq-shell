// GET /.netlify/functions/tenant-routing-health
//
// Admin-only probe that opens a connection to every tenant data plane
// listed in shell_control.tenant_routing and reports back what it sees.
// Use this after provisioning a new tenant, or when debugging a route
// that "should be working".
//
// Returns 200 with a per-tenant report. Even when individual tenants are
// unreachable, the response is 200 — the body shows which one failed.
// Platform admins only.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import {
  getTenantDataClient,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
  type TenantRoutingStatus,
} from './_shared/tenant-routing.js';
import { withSentry } from './_shared/sentry.js';

interface TenantReport {
  slug:           string;
  status:         TenantRoutingStatus | 'unknown';
  region:         string;
  project_ref:    string;
  reachable:      boolean;
  table_counts?:  Record<string, number>;
  error?:         string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

interface RoutingRow {
  region:               string;
  status:               TenantRoutingStatus;
  supabase_project_ref: string;
  tenants:              { slug: string } | null;
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { error: 'GET only' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'Not signed in' });
  if (!session.is_platform_admin) return json(403, { error: 'Platform admin only' });

  const sb = getServiceClient();
  const { data: routings, error } = await sb
    .from('tenant_routing')
    .select('region, status, supabase_project_ref, tenants!inner ( slug )')
    .order('supabase_project_ref');
  if (error) return json(500, { error: error.message });

  const rows = (routings ?? []) as unknown as RoutingRow[];
  const reports: TenantReport[] = [];

  for (const r of rows) {
    const slug = r.tenants?.slug ?? '(no-slug)';
    const report: TenantReport = {
      slug,
      status:      r.status ?? 'unknown',
      region:      r.region,
      project_ref: r.supabase_project_ref,
      reachable:   false,
    };

    try {
      // Note: requireActive=false so we can health-check provisioning rows too
      const client = await getTenantDataClient(slug, false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cAny = client as any;

      const counts: Record<string, number> = {};
      for (const t of ['customers', 'sites', 'staff', 'licences', 'jobs', 'contacts']) {
        const { count, error: cErr } = await cAny
          .schema('app_data')
          .from(t)
          .select('*', { count: 'exact', head: true });
        if (cErr) {
          report.error = `count(${t}): ${cErr.message}`;
          break;
        }
        counts[t] = typeof count === 'number' ? count : -1;
      }
      if (!report.error) {
        report.reachable = true;
        report.table_counts = counts;
      }
    } catch (e) {
      if (e instanceof TenantNotFoundError) report.error = 'not_found';
      else if (e instanceof TenantNotActiveError) report.error = `inactive: ${e.status}`;
      else if (e instanceof TenantRoutingMisconfiguredError) report.error = `misconfigured: ${e.message}`;
      else report.error = e instanceof Error ? e.message : String(e);
    }

    reports.push(report);
  }

  return json(200, {
    ok: reports.every(r => r.reachable),
    tenants: reports,
  });
});
