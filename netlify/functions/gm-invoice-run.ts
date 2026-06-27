// GET  /.netlify/functions/gm-invoice-run?period_id=<id>
//        → all invoice run rows for a period (keyed by job_code)
//
// PATCH /.netlify/functions/gm-invoice-run
//        body: { period_id, job_code, status, reason_code?, reason_note? }
//        → upsert one job's invoicing status; returns updated row
//
// Keyed by (period_id, job_code) — NOT job_id — so re-uploading a period's
// xlsx does not wipe invoice statuses (upload deletes/re-inserts job rows).

import type { Context } from '@netlify/functions';
import { getTenantDataClientById, TenantNotFoundError, TenantNotActiveError } from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

const VALID_STATUS  = ['invoiced_complete', 'invoiced_progress', 'story'] as const;
const VALID_REASONS = ['waiting_po', 'variation', 'on_hold', 'dispute', 'not_progressed', 'other'] as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return json(405, { error: 'method_not_allowed' });
  }

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'not_signed_in' });
  if (!can(session, 'reports.view')) return json(403, { error: 'forbidden' });

  let db;
  try {
    db = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof TenantNotActiveError) {
      return json(503, { error: 'tenant_unavailable' });
    }
    throw e;
  }

  // ── GET — load all runs for a period ─────────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const periodId = url.searchParams.get('period_id');
    if (!periodId) return json(400, { error: 'period_id_required' });

    const { data, error } = await db
      .from('gm_invoice_run')
      .select('id, period_id, job_code, status, reason_code, reason_note, updated_at')
      .eq('period_id', periodId);

    if (error) return json(500, { error: 'db_error', detail: error.message });
    return json(200, { ok: true, runs: data ?? [] });
  }

  // ── PATCH — upsert one job's status ──────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const { period_id, job_code, status, reason_code, reason_note } = body as {
    period_id?:   string;
    job_code?:    string;
    status?:      string;
    reason_code?: string;
    reason_note?: string;
  };

  if (!period_id || typeof period_id !== 'string') return json(400, { error: 'period_id_required' });
  if (!job_code  || typeof job_code  !== 'string') return json(400, { error: 'job_code_required' });
  if (!status || !(VALID_STATUS as readonly string[]).includes(status)) {
    return json(400, { error: 'invalid_status', valid: VALID_STATUS });
  }
  const isStory = status === 'story';
  if (isStory && (!reason_code || !(VALID_REASONS as readonly string[]).includes(reason_code))) {
    return json(400, { error: 'reason_code_required_for_story', valid: VALID_REASONS });
  }
  if (reason_note && reason_note.length > 200) {
    return json(400, { error: 'reason_note_too_long', max: 200 });
  }

  const row = {
    tenant_id:   session.tenant_id,
    period_id,
    job_code,
    status,
    reason_code: isStory ? (reason_code ?? null) : null,
    reason_note: reason_note?.trim() || null,
    updated_at:  new Date().toISOString(),
    updated_by:  session.user_id ?? null,
  };

  const { data, error } = await db
    .from('gm_invoice_run')
    .upsert(row, { onConflict: 'period_id,job_code' })
    .select('id, period_id, job_code, status, reason_code, reason_note, updated_at')
    .single();

  if (error) return json(500, { error: 'db_error', detail: error.message });
  return json(200, { ok: true, run: data });
});
