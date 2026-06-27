// POST /.netlify/functions/staff-record-licence-review
//
// Records an admin's licence review for an EXISTING roster staff member onto
// shell_control.cards_field_approvals (licence_verifications + licences_verified_at).
//
// Unlike cards-approve-staff, this does NOT touch the roster or role — the member
// is already approved. It's a re-sighting: the admin steps through the member's
// canonical licences in the review modal and records sighted/flagged + notes.
//
// Body: { staff_id: string; licence_verifications: Array<{licence_id, status, comment}> }
// admin.review_cards required.

import { getServiceClient } from './_shared/supabase.js';
import { getTenantDataClientById } from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

interface LicenceVerification {
  licence_id: string;
  status: 'sighted' | 'flagged';
  comment: string;
}

interface ReviewBody {
  staff_id?: string;
  licence_verifications?: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function sanitize(input: unknown): LicenceVerification[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .filter((v) => typeof v.licence_id === 'string' && (v.status === 'sighted' || v.status === 'flagged'))
    .map((v) => ({
      licence_id: v.licence_id as string,
      status: v.status as 'sighted' | 'flagged',
      comment: typeof v.comment === 'string' ? (v.comment as string).slice(0, 1000) : '',
    }));
}

export default withSentry(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'Not signed in' });
  if (!can(session, 'admin.review_cards')) return json(403, { error: 'Manager access required' });

  let body: ReviewBody;
  try {
    body = (await req.json()) as ReviewBody;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { staff_id } = body;
  if (!staff_id) return json(400, { error: 'staff_id is required' });

  const verifications = sanitize(body.licence_verifications);

  const sb = getServiceClient();
  const tenantId = session.tenant_id;

  // Tenant scope: confirm this staff member belongs to the caller's tenant before
  // writing. Authoritative check against the tenant data plane (app_data.staff) —
  // the same plane cards-approve-staff trusts. Stops a manager recording a review
  // against a staff_id outside their tenant.
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch {
    return json(502, { error: 'Tenant data plane unavailable' });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  const { data: staffRow } = (await tenantAny
    .schema('app_data')
    .from('staff')
    .select('staff_id')
    .eq('staff_id', staff_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()) as { data: { staff_id: string } | null };

  if (!staffRow) return json(404, { error: 'Staff record not found in your tenant' });

  // Record onto cards_field_approvals (control plane). An already-approved member
  // has a row → update it; a directly-imported member may not → insert with
  // status 'approved' (they're already on the roster, this just stamps the review).
  const reviewFields = {
    licence_verifications: verifications,
    licences_verified_at: new Date().toISOString(),
    approved_by_user_id: session.user_id,
  };

  const { data: existing } = await sb
    .from('cards_field_approvals')
    .select('id')
    .eq('staff_id', staff_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existing) {
    const { error } = await sb.from('cards_field_approvals').update(reviewFields).eq('id', existing.id);
    if (error) return json(500, { error: error.message });
  } else {
    const { error } = await sb.from('cards_field_approvals').insert({
      staff_id,
      tenant_id: tenantId,
      field_people_id: null,
      status: 'approved',
      ...reviewFields,
    });
    if (error) return json(500, { error: error.message });
  }

  return json(200, { ok: true, reviewed: verifications.length });
});
