// POST /.netlify/functions/cards-approve-staff
//
// Body: { staff_id: string; action: 'approve' | 'reject'; rejection_reason?: string }
//
// Approve: reads the Cards profile from the tenant's data plane → writes a
//   people row + qualifications rows to Field's Supabase → records the
//   approval in shell_control.cards_field_approvals.
// Reject:  records the rejection only (no Field writes).
//
// Manager + platform_admin only.
//
// Data plane (Phase 2.B post-cutover):
//   - app_data.staff + app_data.licences  → tenant DB (via tenant_routing)
//   - shell_control.cards_field_approvals → control plane (shared)
//   - shell_control.tenants               → control plane (shared)
//   - Field people + qualifications       → Field's Supabase (unchanged)

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { getFieldServiceClient } from './_shared/field-supabase.js';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
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

  if (session.role !== 'manager' && !session.is_platform_admin) {
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
    .select('staff_id, first_name, last_name, email, phone, date_of_birth, tenant_id')
    .eq('staff_id', staff_id)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .maybeSingle()) as {
    data: { staff_id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; date_of_birth: string | null; tenant_id: string } | null;
    error: { message: string } | null;
  };

  if (staffErr || !staffRow) {
    return json(404, { error: 'Staff record not found or not in your tenant' });
  }

  const { data: licences, error: licErr } = (await tenantAny
    .schema('app_data')
    .from('licences')
    .select('licence_id, licence_type, licence_number, issuing_authority, state, issue_date, expiry_date, notes')
    .eq('staff_id', staff_id)
    .eq('tenant_id', tenantId)
    .eq('active', true)) as {
    data: Array<{ licence_id: string; licence_type: string; licence_number: string | null; issuing_authority: string | null; state: string | null; issue_date: string | null; expiry_date: string | null; notes: string | null }> | null;
    error: { message: string } | null;
  };

  if (licErr) return json(500, { error: licErr.message });

  // Look up the Field org_id for this tenant.
  const { data: tenant, error: tenantErr } = await sb
    .from('tenants')
    .select('field_org_id')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantErr || !tenant?.field_org_id) {
    return json(500, {
      error: 'No Field organisation linked to this tenant. Set field_org_id on shell_control.tenants.',
    });
  }

  const fieldOrgId = tenant.field_org_id as string;

  // Build the name.
  const fullName = (
    [staffRow.first_name, staffRow.last_name].filter(Boolean).join(' ').trim() ||
    staffRow.email
  ) ?? 'Unknown';

  // Parse dob into day/month if present.
  let dobDay: number | null = null;
  let dobMonth: number | null = null;
  if (staffRow.date_of_birth) {
    const d = new Date(staffRow.date_of_birth as string);
    if (!Number.isNaN(d.getTime())) {
      dobDay = d.getUTCDate();
      dobMonth = d.getUTCMonth() + 1;
    }
  }

  // Write to Field.
  const field = getFieldServiceClient();

  const { data: newPerson, error: personErr } = await field
    .from('people')
    .insert({
      org_id: fieldOrgId,
      name: fullName,
      email: staffRow.email ?? null,
      phone: staffRow.phone ?? null,
      dob_day: dobDay,
      dob_month: dobMonth,
      role: 'employee',
      cards_staff_id: staff_id,
    })
    .select('id')
    .single();

  if (personErr || !newPerson) {
    return json(500, { error: `Field people insert failed: ${personErr?.message ?? 'unknown'}` });
  }

  const fieldPeopleId = newPerson.id as string;

  // Write qualifications (one per Cards licence).
  if (licences && licences.length > 0) {
    const qualRows = licences.map((l) => ({
      person_id: fieldPeopleId,
      licence_type: l.licence_type,
      licence_number: l.licence_number ?? null,
      issuing_authority: l.issuing_authority ?? null,
      state: l.state ?? null,
      issue_date: l.issue_date ?? null,
      expiry_date: l.expiry_date ?? null,
      notes: l.notes ?? null,
      cards_licence_id: l.licence_id,
      source: 'cards',
    }));

    const { error: qualErr } = await field.from('qualifications').insert(qualRows);
    if (qualErr) {
      // Person was created — record partial state so admin can retry.
      console.warn('[cards-approve-staff] qualifications insert failed:', qualErr.message);
    }
  }

  // Record the approval in eq-canonical.
  await sb.from('cards_field_approvals').insert({
    staff_id,
    tenant_id: tenantId,
    field_people_id: fieldPeopleId,
    status: 'approved',
    approved_by_user_id: session.user_id,
  });

  return json(200, { ok: true, action: 'approved', field_people_id: fieldPeopleId });
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
