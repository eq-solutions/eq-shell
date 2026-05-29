// GET /.netlify/functions/gm-reports
//
// List periods or fetch a period + jobs for the current tenant.
//
//   GET /gm-reports               → list all periods (newest first)
//   GET /gm-reports?id=<period_id> → period KPIs + all jobs

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
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
  if (session.role !== 'manager' && !session.is_platform_admin) {
    return json(403, { error: 'forbidden' });
  }

  const url = new URL(req.url);
  const periodId = url.searchParams.get('id');
  const db = getServiceClient();

  if (!periodId) {
    // List all periods for this tenant
    const { data, error } = await db
      .schema('app_data')
      .from('gm_report_periods')
      .select(
        'id, period_code, uploaded_at, total_contract, net_cash_position, ' +
        'gp_at_completion, overall_gp_pct, cash_neg_count, forecast_loss_count, ' +
        'outstanding_pos, briefing_generated_at',
      )
      .eq('tenant_id', session.tenant_id)
      .order('uploaded_at', { ascending: false });

    if (error) return json(500, { error: 'db_error', detail: error.message });
    return json(200, { ok: true, periods: data ?? [] });
  }

  // Fetch a specific period + all its jobs
  const { data: period, error: pErr } = await db
    .schema('app_data')
    .from('gm_report_periods')
    .select('*')
    .eq('id', periodId)
    .eq('tenant_id', session.tenant_id)
    .single();

  if (pErr || !period) return json(404, { error: 'not_found' });

  const { data: jobs, error: jErr } = await db
    .schema('app_data')
    .from('gm_report_jobs')
    .select(
      'id, job_manager, job_code, job_description, contract_valuation, ' +
      'jtd_invoicing, jtd_cost_val, gross_profit, gp_pct, outstanding_pos, ' +
      'cash_gap, is_cash_negative, is_forecast_loss, is_overhead, ' +
      'wip_code, mtd_claims, mtd_cost',
    )
    .eq('period_id', periodId)
    .order('cash_gap', { ascending: false }); // largest cash gap first

  if (jErr) return json(500, { error: 'db_error_jobs', detail: jErr.message });

  return json(200, { ok: true, period, jobs: jobs ?? [] });
});
