// POST /.netlify/functions/upload-gm-report
//
// Accepts a Workbench "Project Manager Live Update Report" .xlsx upload,
// parses it into gm_report_periods + gm_report_jobs, and returns the
// created period_id.
//
// Auth: manager role or platform_admin only.
//
// Expected form fields:
//   file  — the .xlsx binary

import type { Context } from '@netlify/functions';
import * as XLSX from 'xlsx';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry, captureServerError } from './_shared/sentry.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface ParsedJob {
  last_forecast_period:         string | null;
  state:                        string | null;
  profit_centre:                string | null;
  job_manager:                  string;
  job_code:                     string;
  job_description:              string;
  wip_code:                     string | null;
  mtd_claims:                   number | null;
  mtd_cost:                     number | null;
  jtd_invoicing:                number;
  jtd_cost_val:                 number;
  contract_valuation:           number;
  forecast_at_completion_costs: number | null;
  gross_profit:                 number | null;
  gp_pct:                       number | null;
  variance_ffc:                 number | null;
  outstanding_pos:              number;
}

interface ParseResult {
  period_code: string;
  jobs:        ParsedJob[];
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[,$%]/g, ''));
    return isNaN(n) ? null : n;
  }
  return null;
}

function toNumOrZero(v: unknown): number {
  return toNum(v) ?? 0;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v).trim() || null;
}

function parseWorkbenchXlsx(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // header:1 → array of arrays; defval fills blanks with null
  const rows = XLSX.utils.sheet_to_json<(unknown)[]>(ws, { header: 1, defval: null });

  // Row 0: title "Project Manager Live Update Report for 2026/011"
  const titleCell = String(rows[0]?.[0] ?? '');
  const periodMatch = titleCell.match(/for\s+(\d{4}\/\d{3,})/);
  const period_code = periodMatch?.[1] ?? 'Unknown';

  // Row 1: headers — skip
  // Row 2+: data
  const jobs: ParsedJob[] = [];

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    // Column layout (0-indexed):
    // 0  Last Forecast Period
    // 1  State
    // 2  Profit Centre
    // 3  Job Manager
    // 4  Job Code         ← blank on subtotal/total rows — skip those
    // 5  Job Description
    // 6  WIP Code
    // 7  MTD Claims (Period)
    // 8  MTD Cost
    // 9  JTD Invoicing
    // 10 JTD Cost
    // 11 Contract Valuation
    // 12 Forecast at Completion Costs
    // 13 Gross Profit
    // 14 GP %
    // 15 Variance FFC-Actual Costs
    // 16 Outstanding PO Amounts

    const jobCode = toStr(row[4]);
    if (!jobCode) continue; // subtotal / total row

    const jobManager = toStr(row[3]) ?? '';
    if (!jobManager) continue;

    jobs.push({
      last_forecast_period:         toStr(row[0]),
      state:                        toStr(row[1]),
      profit_centre:                toStr(row[2]),
      job_manager:                  jobManager,
      job_code:                     jobCode,
      job_description:              toStr(row[5]) ?? '',
      wip_code:                     toStr(row[6]),
      mtd_claims:                   toNum(row[7]),
      mtd_cost:                     toNum(row[8]),
      jtd_invoicing:                toNumOrZero(row[9]),
      jtd_cost_val:                 toNumOrZero(row[10]),
      contract_valuation:           toNumOrZero(row[11]),
      forecast_at_completion_costs: toNum(row[12]),
      gross_profit:                 toNum(row[13]),
      gp_pct:                       toNum(row[14]),
      variance_ffc:                 toNum(row[15]),
      outstanding_pos:              toNumOrZero(row[16]),
    });
  }

  return { period_code, jobs };
}

function computeKpis(jobs: ParsedJob[]) {
  let total_contract    = 0;
  let jtd_invoiced      = 0;
  let jtd_cost          = 0;
  let gp_at_completion  = 0;
  let outstanding_pos   = 0;
  let cash_neg_count    = 0;
  let forecast_loss_count = 0;

  for (const j of jobs) {
    total_contract  += j.contract_valuation;
    jtd_invoiced    += j.jtd_invoicing;
    jtd_cost        += j.jtd_cost_val;
    gp_at_completion += j.gross_profit ?? 0;
    outstanding_pos  += j.outstanding_pos;
    if (j.jtd_cost_val > j.jtd_invoicing) cash_neg_count++;
    if ((j.gross_profit ?? 0) < 0) forecast_loss_count++;
  }

  const net_cash_position = jtd_invoiced - jtd_cost;
  const overall_gp_pct = total_contract > 0 ? gp_at_completion / total_contract : 0;

  return {
    total_contract,
    jtd_invoiced,
    jtd_cost,
    net_cash_position,
    gp_at_completion,
    overall_gp_pct,
    cash_neg_count,
    forecast_loss_count,
    outstanding_pos,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'not_signed_in' });
  if (session.role !== 'manager' && !session.is_platform_admin) {
    return json(403, { error: 'forbidden' });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: 'invalid_form_data' });
  }

  const file = form.get('file') as File | null;
  if (!file) return json(400, { error: 'no_file' });

  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext !== 'xlsx' && ext !== 'xls') {
    return json(400, { error: 'invalid_file_type', detail: 'Upload a .xlsx Workbench report' });
  }

  let parsed: ParseResult;
  try {
    const buffer = await file.arrayBuffer();
    parsed = parseWorkbenchXlsx(buffer);
  } catch (e) {
    captureServerError(e, { context: 'upload-gm-report:parse', tenant_id: session.tenant_id });
    return json(422, { error: 'parse_failed', detail: 'Could not read the xlsx — check it is a Workbench Live Update Report' });
  }

  if (parsed.jobs.length === 0) {
    return json(422, { error: 'no_jobs_found', detail: 'No job rows found in the file' });
  }

  const kpis = computeKpis(parsed.jobs);
  const db = getServiceClient();

  // Upsert period (allow re-upload for same period code)
  const { data: periodRow, error: periodErr } = await db
    .schema('app_data')
    .from('gm_report_periods')
    .upsert(
      {
        tenant_id:            session.tenant_id,
        period_code:          parsed.period_code,
        uploaded_by:          session.user_id ?? null,
        ...kpis,
        briefing:             null,
        briefing_generated_at: null,
      },
      { onConflict: 'tenant_id,period_code' },
    )
    .select('id')
    .single();

  if (periodErr || !periodRow) {
    captureServerError(periodErr, { context: 'upload-gm-report:upsert-period', tenant_id: session.tenant_id });
    return json(500, { error: 'db_error', detail: periodErr?.message });
  }

  const period_id: string = periodRow.id;

  // Delete existing jobs for this period (re-upload scenario)
  await db.schema('app_data').from('gm_report_jobs').delete().eq('period_id', period_id);

  // Batch-insert jobs in chunks of 200 to stay under Postgres limits
  const CHUNK = 200;
  for (let i = 0; i < parsed.jobs.length; i += CHUNK) {
    const chunk = parsed.jobs.slice(i, i + CHUNK).map((j) => ({ ...j, period_id }));
    const { error: jobsErr } = await db.schema('app_data').from('gm_report_jobs').insert(chunk);
    if (jobsErr) {
      captureServerError(jobsErr, { context: 'upload-gm-report:insert-jobs', tenant_id: session.tenant_id });
      return json(500, { error: 'db_error_jobs', detail: jobsErr.message });
    }
  }

  return json(200, {
    ok:          true,
    period_id,
    period_code: parsed.period_code,
    job_count:   parsed.jobs.length,
    kpis,
  });
});
