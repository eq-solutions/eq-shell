// POST /.netlify/functions/cards-approve-staff
//
// Body: { staff_id: string; action: 'approve' | 'reject'; rejection_reason?: string }
//
// Approve: flips app_data.staff.field_status -> 'active' in the tenant's data plane
//   (the staff row becomes a live, dispatchable Field resource — Field reads the
//   app_data.field_people view), then records the decision in
//   shell_control.cards_field_approvals.
// Reject:  flips field_status -> 'rejected' and records the rejection.
//
// Manager + platform_admin only (admin.review_cards).
//
// This is a STATE-FLIP on the row that already exists in the tenant plane — NOT a
// cross-DB INSERT into a separate Field project. See docs/cards-field-promotion-spec.md
// (decisions D-A/D-B/D-D). The old demo-project write path (FIELD_SUPABASE_* +
// tenants.field_org_id) is gone: one path for every tenant.
//
// Data plane:
//   - app_data.staff (field_status)      -> tenant DB (via tenant_routing)
//   - shell_control.cards_field_approvals -> control plane (shared, audit)
//
// NOT YET DEPLOYABLE — depends on migration 0039 (app_data.staff.field_status +
// the field_people view) being applied to the tenant planes first. Ships with 0039
// at F1. Auth-adjacent: do not deploy without explicit approval.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import {
  promoteStaffToField,
  setFieldStatus,
} from './_shared/field-promotion.js';
import {
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

  // Guard: can't review the same person twice. cards_field_approvals lives in
  // shell_control (cross-tenant audit).
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
    // Flip the staff row to 'rejected' (a missing row still records the rejection
    // so the queue clears), then write the audit row.
    let res;
    try {
      res = await setFieldStatus(staff_id, tenantId, 'rejected', session.user_id);
    } catch (e) {
      return tenantRoutingError(e);
    }
    await sb.from('cards_field_approvals').insert({
      staff_id,
      tenant_id: tenantId,
      field_people_id: null,
      field_project_ref: res.projectRef,
      status: 'rejected',
      approved_by_user_id: session.user_id,
      rejection_reason: rejection_reason ?? null,
    });
    return json(200, { ok: true, action: 'rejected' });
  }

  // Approve — state-flip the staff row to 'active' in the tenant data plane.
  let res;
  try {
    res = await promoteStaffToField(staff_id, tenantId, session.user_id);
  } catch (e) {
    return tenantRoutingError(e);
  }
  if (res.notFound) {
    return json(404, { error: 'Staff record not found or not in your tenant' });
  }

  // Record the decision in eq-canonical. field_people_id is null under the
  // state-flip model — staff_id IS the Field person reference (one person table).
  await sb.from('cards_field_approvals').insert({
    staff_id,
    tenant_id: tenantId,
    field_people_id: null,
    field_project_ref: res.projectRef,
    status: 'approved',
    approved_by_user_id: session.user_id,
  });

  return json(200, { ok: true, action: 'approved' });
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
