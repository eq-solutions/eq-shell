// GET  /.netlify/functions/comms-jobs                → all jobs with PO line summary
// GET  /.netlify/functions/comms-jobs?id=<uuid>      → single job + PO lines + last 10 events
// GET  /.netlify/functions/comms-jobs?resource=staff → active staff list for autocomplete
// POST /.netlify/functions/comms-jobs
//   body { create: { site_code, ... } }              → create new job (status defaults to 'quoted')
//   body { job_id, patch }                           → update job fields (incl. header fields)
//   body { job_id, line }                            → add PO line
//   body { job_id, line_id, line_patch }             → update PO line (invoice fields)
//
// SKS tenant only. Perm: field.view (GET) / field.dispatch (POST)

import type { Context } from '@netlify/functions';
import { getTenantDataClientById, TenantNotFoundError, TenantNotActiveError } from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

const SKS_TENANT_ID = '7dee117c-98bd-4d39-af8c-2c81d02a1e85';

const VALID_STATUSES = new Set(['quoted', 'active', 'on_hold', 'complete', 'closed']);

interface CommsJobCreate {
  site_code:         string;
  site_name:         string | null;
  client:            string;
  job_number:        string | null;
  description:       string | null;
  assigned_to:       string | null;
  start_date:        string | null;
  target_completion: string | null;
}

interface CommsJobPatch {
  site_code:         string;
  site_name:         string | null;
  client:            string;
  job_number:        string | null;
  description:       string | null;
  assigned_to:       string | null;
  status:            string;
  mop_received:      boolean;
  pre_cable_done:    boolean;
  post_dock_done:    boolean;
  invoice_raised:    boolean;
  notes:             string | null;
  start_date:        string | null;
  target_completion: string | null;
  on_hold_since:     string | null;
}

interface CommsPoLineInput {
  po_number:     string | null;
  description:   string;
  requestor:     string | null;
  fid_number:    string | null;
  quote_number:  string | null;
  date_approval: string | null;
  hours:         number | null;
  materials_cost: number | null;
  price_ex_gst:  number | null;
}

interface CommsPoLinePatch {
  invoice_number:  string | null;
  invoiced_amount: number | null;
  complete_notes:  string | null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const ALLOWED_CREATE_KEYS: (keyof CommsJobCreate)[] = [
  'site_code', 'site_name', 'client', 'job_number', 'description', 'assigned_to',
  'start_date', 'target_completion',
];

const ALLOWED_PATCH_KEYS: (keyof CommsJobPatch)[] = [
  'site_code', 'site_name', 'client', 'job_number', 'description',
  'assigned_to', 'status', 'mop_received', 'pre_cable_done',
  'post_dock_done', 'invoice_raised', 'notes',
  'start_date', 'target_completion', 'on_hold_since',
];

const ALLOWED_LINE_KEYS: (keyof CommsPoLineInput)[] = [
  'po_number', 'description', 'requestor', 'fid_number', 'quote_number',
  'date_approval', 'hours', 'materials_cost', 'price_ex_gst',
];

const ALLOWED_LINE_PATCH_KEYS: (keyof CommsPoLinePatch)[] = [
  'invoice_number', 'invoiced_amount', 'complete_notes',
];

type DbClient = Awaited<ReturnType<typeof getTenantDataClientById>>;

async function logEvent(db: DbClient, job_id: string, user_id: string, action: string, note: string) {
  await db.from('sks_comms_events').insert({ job_id, user_id, action, note });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'not_signed_in' });
  if (!can(session, 'field.view')) return json(403, { error: 'forbidden' });

  // SKS-only — fast-fail before any DB call
  if (session.tenant_id !== SKS_TENANT_ID) return json(404, { error: 'not_found' });

  let db: DbClient;
  try {
    db = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof TenantNotActiveError) {
      return json(503, { error: 'tenant_unavailable' });
    }
    throw e;
  }

  // ── POST: create / update ────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (!can(session, 'field.dispatch')) return json(403, { error: 'forbidden' });

    let body: Record<string, unknown>;
    try { body = (await req.json()) as Record<string, unknown>; } catch { return json(400, { error: 'invalid_json' }); }

    // ── Create new job ────────────────────────────────────────────────────
    if (body.create !== undefined) {
      const raw = (body.create ?? {}) as Record<string, unknown>;
      if (!raw.site_code) return json(400, { error: 'site_code_required' });
      const safe: Partial<CommsJobCreate> = {};
      for (const k of ALLOWED_CREATE_KEYS) {
        if (k in raw) (safe as Record<string, unknown>)[k] = raw[k];
      }
      const insert = { client: 'Microsoft', ...safe, status: 'quoted' };
      const { data: created, error: cErr } = await db
        .from('sks_comms_jobs')
        .insert(insert)
        .select(
          'job_id, job_number, site_code, site_name, client, status, description, ' +
          'assigned_to, start_date, target_completion, on_hold_since, ' +
          'mop_received, pre_cable_done, post_dock_done, invoice_raised, notes, created_at, updated_at',
        )
        .single();
      if (cErr || !created) return json(500, { error: 'db_error', detail: cErr?.message });
      const row = created as unknown as Record<string, unknown>;
      await logEvent(db, row.job_id as string, session.user_id, 'create_job',
        `Job created: ${String(raw.site_code)}${raw.job_number ? ` #${String(raw.job_number)}` : ''}`);
      return json(200, {
        ok: true,
        job: { ...row, total_value: 0, total_invoiced: 0, total_hours: 0, line_count: 0 },
      });
    }

    const job_id = body.job_id as string | undefined;
    if (!job_id) return json(400, { error: 'missing_job_id' });

    // ── Update PO line (invoice fields) ──────────────────────────────────
    if (body.line_id !== undefined) {
      const line_id = body.line_id as string;
      const raw = (body.line_patch ?? {}) as Record<string, unknown>;
      const safe: Partial<CommsPoLinePatch> = {};
      for (const k of ALLOWED_LINE_PATCH_KEYS) {
        if (k in raw) (safe as Record<string, unknown>)[k] = raw[k];
      }
      const { data, error } = await db
        .from('sks_comms_po_lines')
        .update(safe)
        .eq('line_id', line_id)
        .eq('job_id', job_id)
        .select('line_id, invoice_number, invoiced_amount, complete_notes')
        .single();
      if (error) return json(500, { error: 'db_error', detail: error.message });

      const parts: string[] = [];
      if (safe.invoice_number) parts.push(`invoice ${safe.invoice_number}`);
      if (safe.invoiced_amount != null) parts.push(`$${safe.invoiced_amount}`);
      await logEvent(db, job_id, session.user_id, 'update_line', `Line updated: ${parts.join(', ') || 'fields cleared'}`);

      return json(200, { ok: true, line: data });
    }

    // ── Add PO line ───────────────────────────────────────────────────────
    if (body.line !== undefined) {
      const raw = (body.line ?? {}) as Record<string, unknown>;
      if (!raw.description) return json(400, { error: 'description_required' });
      const safe: Partial<CommsPoLineInput> & { job_id: string } = { job_id };
      for (const k of ALLOWED_LINE_KEYS) {
        if (k in raw) (safe as Record<string, unknown>)[k] = raw[k];
      }
      const { data, error } = await db
        .from('sks_comms_po_lines')
        .insert(safe)
        .select(
          'line_id, po_number, description, requestor, fid_number, quote_number, ' +
          'date_approval, hours, materials_cost, price_ex_gst, complete_notes, invoice_number, invoiced_amount',
        )
        .single();
      if (error) return json(500, { error: 'db_error', detail: error.message });

      await logEvent(db, job_id, session.user_id, 'add_line', `PO line added: ${String(raw.description)}`);
      return json(200, { ok: true, line: data });
    }

    // ── Patch job ─────────────────────────────────────────────────────────
    const raw = (body.patch ?? {}) as Record<string, unknown>;
    const safe: Partial<CommsJobPatch> = {};
    for (const k of ALLOWED_PATCH_KEYS) {
      if (k in raw) (safe as Record<string, unknown>)[k] = raw[k];
    }

    if ('status' in safe && !VALID_STATUSES.has(safe.status as string)) {
      return json(400, { error: 'invalid_status' });
    }

    const { data, error } = await db
      .from('sks_comms_jobs')
      .update(safe)
      .eq('job_id', job_id)
      .select(
        'job_id, site_code, site_name, client, job_number, description, status, ' +
        'assigned_to, mop_received, pre_cable_done, post_dock_done, invoice_raised, ' +
        'notes, start_date, target_completion, on_hold_since, updated_at',
      )
      .single();

    if (error) return json(500, { error: 'db_error', detail: error.message });

    const parts: string[] = [];
    if ('status' in safe)      parts.push(`status → ${safe.status}`);
    if ('assigned_to' in safe) parts.push(`assigned → ${safe.assigned_to ?? 'none'}`);
    if ('site_code' in safe)   parts.push(`site → ${safe.site_code}`);
    if ('client' in safe)      parts.push(`client → ${safe.client}`);
    const boolFields: (keyof CommsJobPatch)[] = ['mop_received', 'pre_cable_done', 'post_dock_done', 'invoice_raised'];
    for (const f of boolFields) {
      if (f in safe) parts.push(`${f} → ${safe[f]}`);
    }
    await logEvent(db, job_id, session.user_id, 'update_job', parts.join(', ') || 'fields updated');

    return json(200, { ok: true, job: data });
  }

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const url = new URL(req.url);
  const jobId    = url.searchParams.get('id');
  const resource = url.searchParams.get('resource');

  // Staff list for assigned_to autocomplete
  if (resource === 'staff') {
    const { data, error } = await db
      .from('staff')
      .select('staff_id, first_name, last_name, preferred_name')
      .or('end_date.is.null,end_date.gt.now()')
      .order('last_name');
    if (error) return json(500, { error: 'db_error', detail: error.message });
    type StaffRow = { staff_id: string; first_name: string; last_name: string; preferred_name: string | null };
    const staff = ((data ?? []) as StaffRow[]).map((s) => ({
      id: s.staff_id,
      name: `${s.preferred_name ?? s.first_name} ${s.last_name}`,
    }));
    return json(200, { ok: true, staff });
  }

  // Single job with PO lines + last 10 events
  if (jobId) {
    const [jobRes, linesRes, eventsRes] = await Promise.all([
      db.from('sks_comms_jobs').select('*').eq('job_id', jobId).single(),
      db.from('sks_comms_po_lines')
        .select(
          'line_id, po_number, description, requestor, fid_number, quote_number, ' +
          'date_approval, hours, materials_cost, price_ex_gst, complete_notes, invoice_number, invoiced_amount',
        )
        .eq('job_id', jobId)
        .order('created_at', { ascending: true }),
      db.from('sks_comms_events')
        .select('event_id, action, note, user_id, created_at')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    if (jobRes.error || !jobRes.data) return json(404, { error: 'not_found' });
    return json(200, { ok: true, job: jobRes.data, lines: linesRes.data ?? [], events: eventsRes.data ?? [] });
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
  const result = ((jobs ?? []) as unknown as JobRow[]).map((j) => ({
    ...j,
    ...(totals[j.job_id] ?? { total_value: 0, total_invoiced: 0, total_hours: 0, line_count: 0 }),
  }));

  return json(200, { ok: true, jobs: result });
});
