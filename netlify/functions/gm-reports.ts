// GET /.netlify/functions/gm-reports
//
//   GET /gm-reports               → list all periods (newest first)
//   GET /gm-reports?id=<period_id> → period KPIs + all jobs

import type { Context } from '@netlify/functions';
import { getTenantDataClientById, TenantNotFoundError, TenantNotActiveError } from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'not_signed_in' });
  if (!can(session, 'reports.view')) {
    return json(403, { error: 'forbidden' });
  }

  let db;
  try {
    db = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof TenantNotActiveError) {
      return json(503, { error: 'tenant_unavailable' });
    }
    throw e;
  }

  const url = new URL(req.url);
  const periodId = url.searchParams.get('id');

  if (!periodId) {
    // ?archived=true shows archived periods; default is active only
    const showArchived = url.searchParams.get('archived') === 'true';

    const { data, error } = await db
      .from('gm_report_periods')
      .select(
        'id, period_code, uploaded_at, is_archived, total_contract, net_cash_position, ' +
        'gp_at_completion, overall_gp_pct, cash_neg_count, forecast_loss_count, ' +
        'outstanding_pos, briefing_generated_at',
      )
      .eq('is_archived', showArchived)
      .order('uploaded_at', { ascending: false });

    if (error) return json(500, { error: 'db_error', detail: error.message });
    return json(200, { ok: true, periods: data ?? [], show_archived: showArchived });
  }

  const { data: period, error: pErr } = await db
    .from('gm_report_periods')
    .select('*')
    .eq('id', periodId)
    .single();

  if (pErr || !period) return json(404, { error: 'not_found' });

  const { data: jobs, error: jErr } = await db
    .from('gm_report_jobs')
    .select(
      'id, job_manager, job_code, job_description, wip_code, last_forecast_period, ' +
      'contract_valuation, jtd_invoicing, jtd_cost_val, gross_profit, gp_pct, ' +
      'outstanding_pos, cash_gap, is_cash_negative, is_forecast_loss, is_overhead',
    )
    .eq('period_id', periodId)
    .order('cash_gap', { ascending: false });

  if (jErr) return json(500, { error: 'db_error_jobs', detail: jErr.message });

  // Job codes already marked invoiced in EQ Ops — used to pre-populate the
  // invoice run column without requiring a manual tick in GM Reports.
  const { data: opsInvoiced } = await db
    .from('quote')
    .select('workbench_job_no')
    .eq('status', 'invoiced')
    .not('workbench_job_no', 'is', null);

  const ops_invoiced_job_codes = (opsInvoiced ?? [])
    .map((r: { workbench_job_no: string }) => r.workbench_job_no)
    .filter(Boolean);

  return json(200, { ok: true, period, jobs: jobs ?? [], ops_invoiced_job_codes });
});
