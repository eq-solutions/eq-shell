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

import { randomUUID } from 'node:crypto';
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
  staff_id?: string;
  application_id?: string;
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

  const { staff_id, application_id, action, rejection_reason } = body;
  if (!staff_id && !application_id) {
    return json(400, { error: 'staff_id or application_id is required' });
  }
  if (!action) return json(400, { error: 'action is required' });
  if (action !== 'approve' && action !== 'reject') {
    return json(400, { error: 'action must be approve or reject' });
  }

  const sb = getServiceClient();
  const tenantId = session.tenant_id;

  // ── Application path (worker self-signup) ──────────────────────────────────
  if (application_id) {
    return handleApplication({ application_id, action, rejection_reason, sb, session, tenantId });
  }

  // ── Invite path (existing app_data.staff row) ──────────────────────────────
  const staff_id_safe = staff_id!;

  // Guard: can't review the same person twice. cards_field_approvals lives
  // in shell_control (cross-tenant audit).
  const { data: existing } = await sb
    .from('cards_field_approvals')
    .select('id, status')
    .eq('staff_id', staff_id_safe)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existing) {
    return json(409, { error: `Already ${existing.status}` });
  }

  if (action === 'reject') {
    // Rejection doesn't read app_data — no tenant DB round-trip needed.
    await sb.from('cards_field_approvals').insert({
      staff_id: staff_id_safe,
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
    .eq('staff_id', staff_id_safe)
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
    .eq('staff_id', staff_id_safe)
    .eq('tenant_id', tenantId);

  if (updErr) {
    return json(500, { error: `Could not approve staff: ${updErr.message}` });
  }

  // Record the approval in the control plane (cross-tenant audit). field_people_id
  // is retained for legacy rows but is no longer written — approval is canonical.
  await sb.from('cards_field_approvals').insert({
    staff_id: staff_id_safe,
    tenant_id: tenantId,
    field_people_id: null,
    status: 'approved',
    approved_by_user_id: session.user_id,
  });

  // Canonical heartbeat — every approval lands a row in canonical_events so the
  // sentient layer has a durable audit trail. Fire-and-forget: the approval is
  // already committed above; a logging failure must not roll it back.
  tenantAny
    .schema('app_data')
    .from('canonical_events')
    .insert({
      tenant_id: tenantId,
      app_source: 'shell',
      event: 'staff.approved',
      payload: { staff_id: staff_id_safe, approved_by: session.user_id },
      occurred_at: new Date().toISOString(),
      idempotency_key: `staff.approved:${staff_id_safe}`,
    })
    .then(() => {/* ok */})
    .catch((err: unknown) => {
      console.error('[cards-approve-staff] canonical_events emit failed', err);
    });

  return json(200, { ok: true, action: 'approved', staff_id: staff_id_safe });
});

// ── Self-signup application approval ──────────────────────────────────────────

interface AppSession {
  user_id: string;
  tenant_id: string;
}

async function handleApplication({
  application_id,
  action,
  sb,
  session,
  tenantId,
}: {
  application_id: string;
  action: 'approve' | 'reject';
  rejection_reason?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any;
  session: AppSession;
  tenantId: string;
}): Promise<Response> {
  const sbPublic = sb.schema('public');

  // Fetch and validate the application
  const { data: app, error: appErr } = await sbPublic
    .from('org_access_requests')
    .select('id, org_id, worker_user_id, worker_phone, sharing_scope, status, requested_by')
    .eq('id', application_id)
    .maybeSingle() as { data: {
      id: string; org_id: string; worker_user_id: string;
      worker_phone: string | null; sharing_scope: string;
      status: string; requested_by: string;
    } | null; error: { message: string } | null };

  if (appErr || !app) {
    return json(404, { error: 'Application not found' });
  }
  if (app.status !== 'pending') {
    return json(409, { error: `Already ${app.status}` });
  }
  if (app.requested_by !== app.worker_user_id) {
    return json(400, { error: 'Not a worker-initiated application' });
  }

  // Verify the application is for this manager's org (via tenant_id)
  const { data: org } = await sbPublic
    .from('organisations')
    .select('id, tenant_id')
    .eq('id', app.org_id)
    .maybeSingle() as { data: { id: string; tenant_id: string } | null };

  if (!org || org.tenant_id !== tenantId) {
    return json(403, { error: 'Application does not belong to your organisation' });
  }

  if (action === 'reject') {
    await sbPublic
      .from('org_access_requests')
      .update({ status: 'rejected', responded_at: new Date().toISOString() })
      .eq('id', application_id);
    return json(200, { ok: true, action: 'rejected' });
  }

  // Approve — fetch the worker profile from canonical DB
  const { data: worker } = await sbPublic
    .from('workers')
    .select(
      'id, user_id, first_name, last_name, email, phone, date_of_birth, ' +
      'address_street, address_suburb, address_state, address_postcode',
    )
    .eq('user_id', app.worker_user_id)
    .maybeSingle() as { data: {
      id: string; user_id: string;
      first_name: string | null; last_name: string | null;
      email: string | null; phone: string | null; date_of_birth: string | null;
      address_street: string | null; address_suburb: string | null;
      address_state: string | null; address_postcode: string | null;
    } | null };

  // Open tenant data plane to create the staff record
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  // Check if this worker already exists in Field (added before they downloaded Cards).
  // Phone formats are inconsistent: GoTrue normalises to +61XXXXXXXXX, employers type
  // 0XXXXXXXXX, and the org_access_requests RPC strips to bare 9 digits. Check all three.
  const workerPhone = worker?.phone ?? app.worker_phone;
  const bareDigits = (workerPhone ?? '').replace(/^\+61/, '').replace(/^0/, '').replace(/\s/g, '');
  const phoneVariants = bareDigits
    ? [...new Set([workerPhone, `0${bareDigits}`, `+61${bareDigits}`].filter(Boolean) as string[])]
    : [];

  let existingStaff: { staff_id: string } | null = null;
  if (phoneVariants.length > 0) {
    ({ data: existingStaff } = (await tenantAny
      .schema('app_data')
      .from('staff')
      .select('staff_id')
      .eq('tenant_id', tenantId)
      .in('phone', phoneVariants)
      .limit(1)
      .maybeSingle()) as { data: { staff_id: string } | null });
  }

  const staffId = existingStaff?.staff_id ?? randomUUID();

  if (!existingStaff) {
    const { error: staffInsertErr } = await tenantAny
      .schema('app_data')
      .from('staff')
      .insert({
        staff_id: staffId,
        tenant_id: tenantId,
        first_name: worker?.first_name ?? null,
        last_name: worker?.last_name ?? null,
        email: worker?.email ?? null,
        phone: workerPhone,
        date_of_birth: worker?.date_of_birth ?? null,
        address_street: worker?.address_street ?? null,
        address_suburb: worker?.address_suburb ?? null,
        address_state: worker?.address_state ?? null,
        address_postcode: worker?.address_postcode ?? null,
        active: true,
        field_approved: true,
        field_approved_at: new Date().toISOString(),
        field_approved_by: session.user_id,
        imported_from: 'eq-cards-application',
      });

    if (staffInsertErr) {
      return json(500, { error: `Could not create staff record: ${staffInsertErr.message}` });
    }
  }

  // Copy credentials from Cards into Field licences.
  // For existing staff: additive merge — only insert licences not already present
  // (match on licence_type + licence_number). Avoids duplicates; still syncs new certs.
  // For net-new staff: insert all active credentials.
  if (app.sharing_scope === 'full' && worker?.id) {
    const { data: creds } = await sbPublic
      .from('worker_credentials')
      .select(
        'id, credential_type, licence_number, issuing_body, state_territory, issue_date, expiry_date, notes',
      )
      .eq('worker_id', worker.id)
      .is('deleted_at', null)
      .eq('status', 'active') as { data: Array<{
        id: string; credential_type: string; licence_number: string | null;
        issuing_body: string | null; state_territory: string | null;
        issue_date: string | null; expiry_date: string | null; notes: string | null;
      }> | null };

    if (creds && creds.length > 0) {
      let credsToInsert = creds;

      if (existingStaff) {
        // Fetch existing licence keys so we can skip duplicates.
        const { data: existing } = (await tenantAny
          .schema('app_data')
          .from('licences')
          .select('licence_type, licence_number')
          .eq('staff_id', staffId)) as {
          data: Array<{ licence_type: string; licence_number: string | null }> | null;
        };
        const existingKeys = new Set(
          (existing ?? []).map((l) => `${l.licence_type}::${l.licence_number ?? ''}`),
        );
        credsToInsert = creds.filter(
          (c) => !existingKeys.has(`${c.credential_type}::${c.licence_number ?? ''}`),
        );
      }

      if (credsToInsert.length > 0) {
        await tenantAny
          .schema('app_data')
          .from('licences')
          .insert(
            credsToInsert.map((c) => ({
              licence_id: randomUUID(),
              staff_id: staffId,
              tenant_id: tenantId,
              licence_type: c.credential_type,
              licence_number: c.licence_number,
              issuing_authority: c.issuing_body,
              state: c.state_territory,
              issue_date: c.issue_date,
              expiry_date: c.expiry_date,
              notes: c.notes,
              active: true,
            })),
          );
      }
    }
  }

  // Mark application approved in canonical DB
  await sbPublic
    .from('org_access_requests')
    .update({ status: 'approved', responded_at: new Date().toISOString() })
    .eq('id', application_id);

  // Connect the worker to this org in Cards (org_memberships)
  await sbPublic
    .from('org_memberships')
    .insert({
      org_id: app.org_id,
      user_id: app.worker_user_id,
      role: 'worker',
      status: 'active',
      invited_by: session.user_id,
      invited_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tenant_id: tenantId,
    })
    .select()
    .maybeSingle()
    // Swallow conflict — if the membership already exists the worker is already connected.
    .catch(() => null);

  // Provision the worker's Shell access to this employer tenant
  sb.from('user_tenant_memberships')
    .insert({
      user_id: app.worker_user_id,
      tenant_id: tenantId,
      role: 'worker',
      active: false,
    })
    .then(() => {/* ok */})
    .catch((err: unknown) => {
      // Non-fatal: worker can still use Cards wallet; tenant switcher may not show employer
      // until a subsequent JWT refresh triggers the hook to mint the tenant claim.
      console.warn('[cards-approve-staff] user_tenant_memberships insert failed', err);
    });

  // Audit record in the control plane
  await sb.from('cards_field_approvals').insert({
    staff_id: staffId,
    tenant_id: tenantId,
    field_people_id: null,
    status: 'approved',
    approved_by_user_id: session.user_id,
  });

  return json(200, { ok: true, action: 'approved', staff_id: staffId, application_id });
}

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
