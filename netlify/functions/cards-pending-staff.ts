// GET /.netlify/functions/cards-pending-staff
//
// Returns Cards staff profiles that have not yet been reviewed by an admin
// (i.e. no row in cards_field_approvals for the current tenant).
//
// Manager + platform_admin only — enforced by checking the session role.
//
// Data plane (Phase 2.B post-cutover):
//   - app_data.staff + app_data.licences  → tenant DB (via tenant_routing)
//   - shell_control.cards_field_approvals → control plane (shared)
//   - shell_control.tenants               → control plane (shared)

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

interface StaffRow {
  staff_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  address_street: string | null;
  address_suburb: string | null;
  address_state: string | null;
  address_postcode: string | null;
  imported_from: string | null;
  created_at: string;
}

interface LicenceRow {
  licence_id: string;
  staff_id: string;
  licence_type: string;
  licence_number: string | null;
  issuing_authority: string | null;
  state: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'Not signed in' });

  if (!can(session, 'admin.review_cards')) {
    return json(403, { error: 'Manager access required' });
  }

  const sb = getServiceClient();
  const tenantId = session.tenant_id;

  // Open a client against this tenant's dedicated data plane (Phase 2.B).
  // Throws TenantNotActiveError if routing is not in 'active' status.
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  // Fetch approved/rejected staff_ids so we can exclude them.
  // cards_field_approvals lives in shell_control (cross-tenant audit table).
  const { data: reviewed, error: revErr } = await sb
    .from('cards_field_approvals')
    .select('staff_id')
    .eq('tenant_id', tenantId);

  if (revErr) return json(500, { error: revErr.message });

  const reviewedIds = new Set<string>(
    ((reviewed ?? []) as Array<{ staff_id: string }>).map((r) => r.staff_id),
  );

  // Fetch all active staff from the tenant data plane. The tenant_id filter
  // is redundant (tenant DB is single-tenant) but kept as defence-in-depth
  // — if a misrouted request reaches the wrong DB, RLS catches it but the
  // service-role bypasses RLS, so this explicit filter is the last line.
  const { data: allStaff, error: staffErr } = (await tenantAny
    .schema('app_data')
    .from('staff')
    .select(
      'staff_id, first_name, last_name, email, phone, date_of_birth, ' +
      'address_street, address_suburb, address_state, address_postcode, imported_from, created_at',
    )
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('created_at', { ascending: false })) as {
    data: StaffRow[] | null;
    error: { message: string } | null;
  };

  if (staffErr) return json(500, { error: staffErr.message });

  // Filter out already-reviewed staff and Field-imported staff (they're already in Field
  // and don't need the Cards → Field approval flow — approving them would create duplicates).
  const staff = (allStaff ?? []).filter(
    (s) => !reviewedIds.has(s.staff_id) && s.imported_from !== 'eq-solves-field',
  );

  if (staff.length === 0) {
    return json(200, { pending: [] });
  }

  // Fetch licences for all pending staff in one query.
  const staffIds = staff.map((s) => s.staff_id);
  const { data: allLicences, error: licErr } = (await tenantAny
    .schema('app_data')
    .from('licences')
    .select(
      'licence_id, staff_id, licence_type, licence_number, ' +
      'issuing_authority, state, issue_date, expiry_date, notes',
    )
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('staff_id', staffIds)) as {
    data: LicenceRow[] | null;
    error: { message: string } | null;
  };

  if (licErr) return json(500, { error: licErr.message });

  // Group licences by staff_id.
  const licencesByStaff = new Map<string, LicenceRow[]>();
  for (const lic of allLicences ?? []) {
    const existing = licencesByStaff.get(lic.staff_id) ?? [];
    existing.push(lic);
    licencesByStaff.set(lic.staff_id, existing);
  }

  const pending = staff.map((s) => ({
    ...s,
    licences: licencesByStaff.get(s.staff_id) ?? [],
  }));

  return json(200, { pending });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { error: `No tenant data plane registered for this session (${e.identifier}). Run scripts/provision-tenant.mjs.` });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { error: `Tenant data plane not active (status: ${e.status}). Cutover incomplete.` });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[cards-pending-staff] tenant routing misconfigured', e);
    return json(500, { error: 'Tenant routing unavailable — see server logs' });
  }
  console.error('[cards-pending-staff] unexpected tenant resolution error', e);
  return json(500, { error: 'Tenant resolution failed' });
}
