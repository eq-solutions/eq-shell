// GET /.netlify/functions/staff-invite-candidates
//
// Reads the caller-tenant's migrated staff (app_data.staff on the tenant data
// plane) and classifies each as an invite candidate, so an admin can turn
// migrated staff into EQ Shell sign-ins through the existing bulk-invite path.
//
// This is the READ half of the "invite migrated staff" bridge. The SEND half
// reuses invite-users-batch.ts unchanged — this function never writes.
//
// Role follows employment_type (the staff table has no job-title column):
//   employee → employee, apprentice → apprentice, labour_hire → labour_hire.
//
// Data plane (Phase 2.B): app_data.staff is per-tenant (via tenant_routing);
// shell_control.users / user_tenant_memberships / user_invites are control plane.
//
// Manager + platform_admin only (admin.invite_user) — same gate as the invite
// endpoints. Tenant-scoped to the session's tenant; never cross-tenant.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { EqRole } from './_shared/supabase.js';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { normalizeAuPhone } from './_shared/phone.js';
import { withSentry } from './_shared/sentry.js';

interface StaffRow {
  staff_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  employment_type: string | null;
  level: string | null;
  active: boolean;
}

type CandidateStatus = 'ready' | 'already-user' | 'already-invited' | 'no-email';

interface Candidate {
  staff_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  employment_type: string | null;
  role: EqRole;
  role_uncertain: boolean;
  status: CandidateStatus;
}

// employment_type → eq_role. The staff table has no title; employment_type is
// the closest signal and maps 1:1 for the three field tiers. Anything else
// defaults to 'employee' and is flagged so an admin eyeballs it before sending.
function mapStaffRole(employmentType: string | null): { role: EqRole; uncertain: boolean } {
  const key = (employmentType ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (key === 'employee' || key === 'apprentice' || key === 'labour_hire') {
    return { role: key as EqRole, uncertain: false };
  }
  return { role: 'employee', uncertain: true };
}

function fullName(s: StaffRow): string {
  const name = [s.first_name, s.last_name].map((p) => (p ?? '').trim()).filter(Boolean).join(' ');
  return name || (s.email ?? '').trim() || 'Unnamed';
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { ok: false, error: 'method-not-allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'unauthorized' });
  if (!can(session, 'admin.invite_user')) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  const tenantId = session.tenant_id;
  const sb = getServiceClient();

  // Tenant data plane — staff live here post Phase 2.B cutover.
  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  const { data: staffRows, error: staffErr } = (await tenantAny
    .schema('app_data')
    .from('staff')
    .select('staff_id, first_name, last_name, email, phone, employment_type, level, active')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('last_name', { ascending: true })) as {
    data: StaffRow[] | null;
    error: { message: string } | null;
  };

  if (staffErr) return json(500, { ok: false, error: staffErr.message });
  const staff = staffRows ?? [];

  // Control-plane dedup sets, scoped to THIS tenant.
  // already-member: an existing user with a membership in this tenant.
  const { data: memberships, error: memErr } = await sb
    .from('user_tenant_memberships')
    .select('user_id')
    .eq('tenant_id', tenantId);
  if (memErr) return json(500, { ok: false, error: memErr.message });

  const memberIds = ((memberships ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
  const memberEmails = new Set<string>();
  if (memberIds.length > 0) {
    const { data: memberUsers, error: usersErr } = await sb
      .from('users')
      .select('email')
      .in('id', memberIds);
    if (usersErr) return json(500, { ok: false, error: usersErr.message });
    for (const u of (memberUsers ?? []) as Array<{ email: string | null }>) {
      if (u.email) memberEmails.add(u.email.trim().toLowerCase());
    }
  }

  // already-invited: an open (unaccepted, unexpired) invite in this tenant.
  const { data: openInvites, error: invErr } = await sb
    .from('user_invites')
    .select('email')
    .eq('tenant_id', tenantId)
    .is('accepted_at', null)
    .gte('expires_at', new Date().toISOString());
  if (invErr) return json(500, { ok: false, error: invErr.message });

  const invitedEmails = new Set<string>(
    ((openInvites ?? []) as Array<{ email: string | null }>)
      .map((i) => (i.email ?? '').trim().toLowerCase())
      .filter(Boolean),
  );

  const candidates: Candidate[] = staff.map((s) => {
    const email = (s.email ?? '').trim().toLowerCase();
    const { role, uncertain } = mapStaffRole(s.employment_type);
    const phone = normalizeAuPhone(s.phone); // null when missing or unparseable

    let status: CandidateStatus;
    if (!email || !email.includes('@')) status = 'no-email';
    else if (memberEmails.has(email)) status = 'already-user';
    else if (invitedEmails.has(email)) status = 'already-invited';
    else status = 'ready';

    return {
      staff_id: s.staff_id,
      name: fullName(s),
      email: email || null,
      phone,
      employment_type: s.employment_type,
      role,
      role_uncertain: uncertain,
      status,
    };
  });

  const counts = {
    ready: candidates.filter((c) => c.status === 'ready').length,
    already_user: candidates.filter((c) => c.status === 'already-user').length,
    already_invited: candidates.filter((c) => c.status === 'already-invited').length,
    no_email: candidates.filter((c) => c.status === 'no-email').length,
  };

  return json(200, { ok: true, candidates, counts });
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { ok: false, error: `No data plane registered for this workspace (${e.identifier}).` });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { ok: false, error: `Workspace data plane not active (status: ${e.status}).` });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[staff-invite-candidates] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'Workspace routing unavailable — see server logs' });
  }
  console.error('[staff-invite-candidates] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'Workspace resolution failed' });
}
