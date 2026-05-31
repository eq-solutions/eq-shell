// PATCH /.netlify/functions/manage-gm-report?id=<period_id>
//   Body: { archived: boolean }  → toggle archive flag
//
// DELETE /.netlify/functions/manage-gm-report?id=<period_id>
//   → permanently delete period + all jobs (cascade)
//
// Auth: manager or platform_admin only.

import type { Context } from '@netlify/functions';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry, captureServerError } from './_shared/sentry.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'DELETE' && req.method !== 'PATCH') {
    return json(405, { error: 'method_not_allowed' });
  }

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'not_signed_in' });
  if (!can(session, 'reports.upload')) {
    return json(403, { error: 'forbidden' });
  }

  const url = new URL(req.url);
  const periodId = url.searchParams.get('id');
  if (!periodId) return json(400, { error: 'missing_id' });

  let db;
  try {
    db = await getTenantDataClientById(session.tenant_id);
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof TenantNotActiveError) {
      return json(503, { error: 'tenant_unavailable' });
    }
    throw e;
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    // Jobs are deleted first (FK may not cascade depending on migration).
    const { error: jobsErr } = await db
      .from('gm_report_jobs')
      .delete()
      .eq('period_id', periodId);

    if (jobsErr) {
      captureServerError(jobsErr, { context: 'manage-gm-report:delete-jobs', tenant_id: session.tenant_id });
      return json(500, { error: 'db_error', detail: jobsErr.message });
    }

    const { error: periodErr } = await db
      .from('gm_report_periods')
      .delete()
      .eq('id', periodId);

    if (periodErr) {
      captureServerError(periodErr, { context: 'manage-gm-report:delete-period', tenant_id: session.tenant_id });
      return json(500, { error: 'db_error', detail: periodErr.message });
    }

    return json(200, { ok: true, deleted: periodId });
  }

  // ── PATCH (archive toggle) ─────────────────────────────────────────────────
  let body: { archived?: boolean };
  try {
    body = await req.json() as { archived?: boolean };
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  if (typeof body.archived !== 'boolean') {
    return json(400, { error: 'missing_archived_field' });
  }

  const { error: updateErr } = await db
    .from('gm_report_periods')
    .update({ is_archived: body.archived })
    .eq('id', periodId);

  if (updateErr) {
    captureServerError(updateErr, { context: 'manage-gm-report:archive', tenant_id: session.tenant_id });
    return json(500, { error: 'db_error', detail: updateErr.message });
  }

  return json(200, { ok: true, archived: body.archived });
});
