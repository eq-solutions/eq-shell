// POST /.netlify/functions/staff-update
//
// Updates editable fields on an app_data.staff row via the eq_update_staff RPC.
// Session-authed; field.view permission required (same gate as entity-rows
// for staff). Tenant is resolved from the session — callers cannot target a
// different tenant's rows.

import type { Context } from '@netlify/functions';
import { getTenantDataClientById } from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry, captureServerError } from './_shared/sentry.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

interface UpdateBody {
  staff_id:         string;
  first_name?:      string;
  last_name?:       string;
  email?:           string;
  phone?:           string;
  trade?:           string;
  level?:           string;
  employment_type?: string;
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'Not signed in' });
  if (!can(session, 'field.view')) return json(403, { error: 'Access denied' });

  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  if (!body.staff_id) return json(400, { error: 'staff_id required' });

  try {
    const dataClient = await getTenantDataClientById(session.tenant_id);
    const { data, error } = await dataClient.rpc('eq_update_staff', {
      p_staff_id:        body.staff_id,
      p_first_name:      body.first_name      ?? null,
      p_last_name:       body.last_name       ?? null,
      p_email:           body.email           ?? null,
      p_phone:           body.phone           ?? null,
      p_trade:           body.trade           ?? null,
      p_level:           body.level           ?? null,
      p_employment_type: body.employment_type ?? null,
    });

    if (error) {
      captureServerError(error, { context: 'staff-update', staff_id: body.staff_id });
      return json(500, { error: error.message });
    }

    return json(200, { ok: true, updated: data as boolean });
  } catch (e) {
    captureServerError(e, { context: 'staff-update', staff_id: body.staff_id });
    return json(500, { error: String(e) });
  }
});
