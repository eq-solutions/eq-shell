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

interface ApplicationRow {
  id: string;
  worker_user_id: string;
  worker_phone: string | null;
  sharing_scope: string;
  requested_at: string;
  requested_by: string;
}

interface WorkerRow {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  address_street: string | null;
  address_suburb: string | null;
  address_state: string | null;
  address_postcode: string | null;
}

interface CredRow {
  id: string;
  worker_id: string;
  credential_type: string;
  licence_number: string | null;
  issuing_body: string | null;
  state_territory: string | null;
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

  // Fetch licences for all pending invite staff in one query.
  const staffIds = staff.map((s) => s.staff_id);
  let allLicences: LicenceRow[] | null = [];
  let licErr: { message: string } | null = null;
  if (staffIds.length > 0) {
    ({ data: allLicences, error: licErr } = (await tenantAny
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
    });
  }

  if (licErr) return json(500, { error: licErr.message });

  // Group licences by staff_id.
  const licencesByStaff = new Map<string, LicenceRow[]>();
  for (const lic of allLicences ?? []) {
    const existing = licencesByStaff.get(lic.staff_id) ?? [];
    existing.push(lic);
    licencesByStaff.set(lic.staff_id, existing);
  }

  const invitePending = staff.map((s) => ({
    ...s,
    source: 'invite' as const,
    licences: licencesByStaff.get(s.staff_id) ?? [],
  }));

  // ── Self-signup applications (worker → employer, via org_access_requests) ──
  // Look up this tenant's org in the canonical DB so we can query applications.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbPublic = sb.schema('public') as any;

  const { data: orgRow } = (await sbPublic
    .from('organisations')
    .select('id')
    .eq('tenant_id', tenantId)
    .maybeSingle()) as { data: { id: string } | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let applicationPending: any[] = [];

  if (orgRow?.id) {
    const { data: appRows } = (await sbPublic
      .from('org_access_requests')
      .select('id, worker_user_id, worker_phone, sharing_scope, requested_at, requested_by')
      .eq('org_id', orgRow.id)
      .eq('status', 'pending')
      .not('worker_user_id', 'is', null)) as {
      data: ApplicationRow[] | null;
    };

    // Worker-initiated = requested_by equals the worker's own user_id.
    const workerInitiated = (appRows ?? []).filter(
      (a) => a.requested_by === a.worker_user_id,
    );

    if (workerInitiated.length > 0) {
      const userIds = workerInitiated.map((a) => a.worker_user_id);

      const { data: workers } = (await sbPublic
        .from('workers')
        .select(
          'id, user_id, first_name, last_name, email, phone, date_of_birth, ' +
          'address_street, address_suburb, address_state, address_postcode',
        )
        .in('user_id', userIds)) as { data: WorkerRow[] | null };

      const workerMap = new Map<string, WorkerRow>();
      for (const w of (workers ?? [])) workerMap.set(w.user_id, w);

      // Fetch credentials only for full-scope applications.
      const credsByWorkerId = new Map<string, CredRow[]>();
      const fullScopeIds = workerInitiated
        .filter((a) => a.sharing_scope === 'full')
        .map((a) => workerMap.get(a.worker_user_id)?.id)
        .filter((id): id is string => !!id);

      if (fullScopeIds.length > 0) {
        const { data: creds } = (await sbPublic
          .from('worker_credentials')
          .select(
            'id, worker_id, credential_type, licence_number, issuing_body, ' +
            'state_territory, issue_date, expiry_date, notes',
          )
          .in('worker_id', fullScopeIds)
          .is('deleted_at', null)
          .eq('status', 'active')) as { data: CredRow[] | null };

        for (const c of (creds ?? [])) {
          const list = credsByWorkerId.get(c.worker_id) ?? [];
          list.push(c);
          credsByWorkerId.set(c.worker_id, list);
        }
      }

      applicationPending = workerInitiated.map((a) => {
        const w = workerMap.get(a.worker_user_id);
        const wCreds = w ? (credsByWorkerId.get(w.id) ?? []) : [];
        return {
          application_id: a.id,
          source: 'application' as const,
          sharing_scope: a.sharing_scope,
          first_name: w?.first_name ?? null,
          last_name: w?.last_name ?? null,
          email: w?.email ?? null,
          phone: w?.phone ?? a.worker_phone,
          date_of_birth: w?.date_of_birth ?? null,
          created_at: a.requested_at,
          licences: wCreds.map((c) => ({
            licence_id: c.id,
            staff_id: '',
            licence_type: c.credential_type,
            licence_number: c.licence_number,
            issuing_authority: c.issuing_body,
            state: c.state_territory,
            issue_date: c.issue_date,
            expiry_date: c.expiry_date,
            notes: c.notes,
          })),
        };
      });
    }
  }

  const pending = [...invitePending, ...applicationPending];

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
