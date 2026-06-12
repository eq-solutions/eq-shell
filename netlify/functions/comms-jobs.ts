// GET  /.netlify/functions/comms-jobs          → all jobs with PO line summary
// GET  /.netlify/functions/comms-jobs?id=<uuid> → single job + PO lines
// POST /.netlify/functions/comms-jobs           → update job fields
//   body: { job_id: string; patch: Partial<CommsJobPatch> }
//
// Target: ehow tenant plane (SKS) only.
// Perm: comms.view (GET) / comms.update (POST)

import type { Context } from '@netlify/functions';
import { getTenantDataClientById, TenantNotFoundError, TenantNotActiveError } from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

interface CommsJobPatch {
  assigned_to:     string | null;
  status:          string;
  mop_received:    boolean;
  pre_cable_done:  boolean;
  post_dock_done:  boolean;
  invoice_raised:  boolean;
  notes:           string | null;
  start_date:      string | null;
  target_completion: string | null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const ALLOWED_PATCH_KEYS: (keyof CommsJobPatch)[] = [
  'assigned_to', 'status', 'mop_received', 'pre_cable_done',
  'post_dock_done', 'invoice_raised', 'notes', 'start_date', 'target_completion',
];

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'not_signed_in' });
  if (!can(session, 'field.view')) return json(403, { error: 'forbidden' });

  let db;
  try {
    db = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof TenantNotActiveError) {
      return json(503, { error: 'tenant_unavailable' });
    }
    throw e;
  }

  // ── POST: update a job ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (!can(session, 'field.dispatch')) return json(403, { error: 'forbidden' });

    let body: { job_id?: string; patch?: Partial<CommsJobPatch> };
    try { body = (await req.json()) as { job_id?: string; patch?: Partial<CommsJobPatch> }; } catch { return json(400, { error: 'invalid_json' }); }

    const { job_id, patch } = body;
    if (!job_id || !patch || typeof patch !== 'object') {
      return json(400, { error: 'missing_job_id_or_patch' });
    }

    // Whitelist only allowed keys
    const safe: Partial<CommsJobPatch> = {};
    for (const k of ALLOWED_PATCH_KEYS) {
      if (k in patch) (safe as Record<string, unknown>)[k] = patch[k];
    }

    const { data, error } = await db
      .from('sks_comms_jobs')
      .update(safe)
      .eq('job_id', job_id)
      .select('job_id, status, assigned_to, mop_received, pre_cable_done, post_dock_done, invoice_raised, notes, updated_at')
      .single();

    if (error) return json(500, { error: 'db_error', detail: error.message });
    return json(200, { ok: true, job: data });
  }

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const url = new URL(req.url);
  const jobId = url.searchParams.get('id');

  if (jobId) {
    // Single job with PO lines
    const [jobRes, linesRes] = await Promise.all([
      db.from('sks_comms_jobs').select('*').eq('job_id', jobId).single(),
      db.from('sks_comms_po_lines')
        .select('line_id, po_number, description, requestor, fid_number, quote_number, date_approval, hours, materials_cost, price_ex_gst, complete_notes, invoice_number, invoiced_amount')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true }),
    ]);
    if (jobRes.error || !jobRes.data) return json(404, { error: 'not_found' });
    return json(200, { ok: true, job: jobRes.data, lines: linesRes.data ?? [] });
  }

  // All jobs with aggregated PO line totals
  const { data: jobs, error: jErr } = await db
    .from('sks_comms_jobs')
    .select(
      'job_id, job_number, site_code, site_name, client, status, description, ' +
      'assigned_to, start_date, target_completion, on_hold_since, ' +
      'mop_received, pre_cable_done, post_dock_done, invoice_raised, ' +
      'notes, created_at, updated_at',
    )
    .order('status')
    .order('site_code');

  if (jErr) return json(500, { error: 'db_error', detail: jErr.message });

  // Aggregate PO line totals per job
  const { data: agg, error: aErr } = await db
    .from('sks_comms_po_lines')
    .select('job_id, price_ex_gst, invoiced_amount, hours');

  if (aErr) return json(500, { error: 'db_error_agg', detail: aErr.message });

  type LineRow = { job_id: string; price_ex_gst: number | null; invoiced_amount: number | null; hours: number | null };
  const totals: Record<string, { total_value: number; total_invoiced: number; total_hours: number; line_count: number }> = {};
  for (const row of (agg ?? []) as LineRow[]) {
    if (!totals[row.job_id]) totals[row.job_id] = { total_value: 0, total_invoiced: 0, total_hours: 0, line_count: 0 };
    totals[row.job_id].total_value    += row.price_ex_gst    ?? 0;
    totals[row.job_id].total_invoiced += row.invoiced_amount ?? 0;
    totals[row.job_id].total_hours    += row.hours           ?? 0;
    totals[row.job_id].line_count     += 1;
  }

  type JobRow = { job_id: string; [k: string]: unknown };
  const jobRows = (jobs ?? []) as unknown as JobRow[];
  const result = jobRows.map((j) => ({ ...j, ...(totals[j.job_id] ?? { total_value: 0, total_invoiced: 0, total_hours: 0, line_count: 0 }) }));

  return json(200, { ok: true, jobs: result });
});
