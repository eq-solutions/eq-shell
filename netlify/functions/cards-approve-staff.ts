// POST /.netlify/functions/cards-approve-staff
//
// Body: { staff_id: string; action: 'approve' | 'reject'; rejection_reason?: string }
//
// Approve: reads the Cards profile from the tenant's data plane → flips
//   field_approved on the canonical app_data.staff row → records the approval
//   in shell_control.cards_field_approvals.
// Reject:  records the rejection only (no data-plane writes).
//
// Manager + platform_admin only.
//
// WHY no more legacy-Field write (2026-06-08): the approved staff member ALREADY
// lives in app_data.staff — the tenant data plane that live Field reads via
// tenant_routing (zaap for EQ, nspb for SKS). The old bridge copied the profile
// into a second store, the standalone ktmj Field DB, which is now the dead
// cold-backup that nothing reads. Approval is therefore a FLAG on the canonical
// row (field_approved, migration 0046), not a second copy of the person.
//
// Data plane:
//   - app_data.staff (field_approved flag)  → tenant DB (via tenant_routing)
//   - shell_control.cards_field_approvals    → control plane (shared, audit)

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

interface ApproveBody {
  staff_id: string;
  action: 'approve' | 'reject';
  rejection_reason?: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'Not signed in' });

  if (!can(session, 'admin.review_cards')) {
    return json(403, { error: 'Manager access required' });
  }

  let body: ApproveBody;
  try {
    body = (await req.json()) as ApproveBody;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { staff_id, action, rejection_reason } = body;
  if (!staff_id || !action) return json(400, { error: 'staff_id and action are required' });
  if (action !== 'approve' && action !== 'reject') {
    return json(400, { error: 'action must be approve or reject' });
  }

  const sb = getServiceClient();
  const tenantId = session.tenant_id;

  // Guard: can't review the same person twice. cards_field_approvals lives
  // in shell_control (cross-tenant audit).
  const { data: existing } = await sb
    .from('cards_field_approvals')
    .select('id, status')
    .eq('staff_id', staff_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existing) {
    return json(409, { error: `Already ${existing.status}` });
  }

  if (action === 'reject') {
    // Rejection doesn't read app_data — no tenant DB round-trip needed.
    await sb.from('cards_field_approvals').insert({
      staff_id,
      tenant_id: tenantId,
      field_people_id: null,
      status: 'rejected',
      approved_by_user_id: session.user_id,
      rejection_reason: rejection_reason ?? null,
    });
    return json(200, { ok: true, action: 'rejected' });
  }

  // Approve — open the tenant's data plane to read the full profile.
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  const { data: staffRow, error: staffErr } = (await tenantAny
    .schema('app_data')
    .from('staff')
    .select('staff_id, field_approved, tenant_id')
    .eq('staff_id', staff_id)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .maybeSingle()) as {
    data: { staff_id: string; field_approved: boolean | null; tenant_id: string } | null;
    error: { message: string } | null;
  };

  if (staffErr || !staffRow) {
    return json(404, { error: 'Staff record not found or not in your tenant' });
  }

  // Approval = flip the canonical field_approved flag. The staff member already
  // lives in app_data.staff (the plane live Field reads); approval clears them
  // onto the roster. No second copy into the dead legacy Field DB.
  const { error: updErr } = await tenantAny
    .schema('app_data')
    .from('staff')
    .update({
      field_approved: true,
      field_approved_at: new Date().toISOString(),
      field_approved_by: session.user_id,
    })
    .eq('staff_id', staff_id)
    .eq('tenant_id', tenantId);

  if (updErr) {
    return json(500, { error: `Could not approve staff: ${updErr.message}` });
  }

  // Record the approval in the control plane (cross-tenant audit). field_people_id
  // is retained for legacy rows but is no longer written — approval is canonical.
  await sb.from('cards_field_approvals').insert({
    staff_id,
    tenant_id: tenantId,
    field_people_id: null,
    status: 'approved',
    approved_by_user_id: session.user_id,
  });

  return json(200, { ok: true, action: 'approved', staff_id });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { error: `No tenant data plane registered for this session (${e.identifier}). Run scripts/provision-tenant.mjs.` });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { error: `Tenant data plane not active (status: ${e.status}). Cutover incomplete.` });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[cards-approve-staff] tenant routing misconfigured', e);
    return json(500, { error: 'Tenant routing unavailable — see server logs' });
  }
  console.error('[cards-approve-staff] unexpected tenant resolution error', e);
  return json(500, { error: 'Tenant resolution failed' });
}
