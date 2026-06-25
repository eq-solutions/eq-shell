// GET /.netlify/functions/staff-org-roster
//
// Returns the full staff roster for the tenant org — canonical identity plus
// non-private licences per staff member.
//
// Response: { staff: StaffMember[] }
//   StaffMember: { user_id, staff_id, name, email, active, licences: LicenceRow[] }
//   LicenceRow:  { id, user_id, licence_type, licence_number, expiry_date, never_expires }
//
// field.view permission required (same gate as staff-canonical-licences).

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

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
  if (!can(session, 'field.view')) return json(403, { error: 'Access denied' });

  const sb = getServiceClient();
  const tenantId = session.tenant_id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbPublic = (sb as any).schema('public');

  // 1. Resolve org for this tenant
  const { data: org } = (await sbPublic
    .from('organisations')
    .select('id')
    .eq('tenant_id', tenantId)
    .maybeSingle()) as { data: { id: string } | null };

  if (!org) return json(200, { staff: [] });

  // 2. Active org_memberships → user_ids
  const { data: members } = (await sbPublic
    .from('org_memberships')
    .select('user_id')
    .eq('org_id', org.id)
    .eq('status', 'active')) as { data: Array<{ user_id: string }> | null };

  const userIds = (members ?? []).map((m) => m.user_id).filter(Boolean);
  if (userIds.length === 0) return json(200, { staff: [] });

  // 3. Fetch canonical users: id, email, name, active (shell_control schema — default)
  const { data: users } = (await sb
    .from('users')
    .select('id, email, name, active')
    .in('id', userIds)) as {
    data: Array<{ id: string; email: string; name: string | null; active: boolean }> | null;
  };

  // 4. Fetch workers: user_id, staff_id (staff_id may be null)
  const { data: workers } = (await sbPublic
    .from('workers')
    .select('user_id, staff_id')
    .in('user_id', userIds)) as {
    data: Array<{ user_id: string; staff_id: string | null }> | null;
  };

  const staffIdByUser = new Map<string, string | null>();
  for (const w of workers ?? []) {
    if (w.user_id) staffIdByUser.set(w.user_id, w.staff_id ?? null);
  }

  // 5. Canonical licences (public schema) for all org members, non-private only
  const { data: licences, error: licErr } = (await sbPublic
    .from('licences')
    .select('id, user_id, licence_type, licence_number, expiry_date, never_expires')
    .in('user_id', userIds)
    .is('deleted_at', null)
    .eq('is_private', false)) as {
    data: Array<{
      id: string;
      user_id: string;
      licence_type: string | null;
      licence_number: string | null;
      expiry_date: string | null;
      never_expires: boolean;
    }> | null;
    error: { message: string } | null;
  };

  if (licErr) return json(500, { error: licErr.message });

  // Group licences by user_id
  const licencesByUser = new Map<string, typeof licences>();
  for (const lic of licences ?? []) {
    const existing = licencesByUser.get(lic.user_id);
    if (existing) {
      existing.push(lic);
    } else {
      licencesByUser.set(lic.user_id, [lic]);
    }
  }

  // Build roster — one entry per org member (include all, workers table optional)
  const userMap = new Map(
    (users ?? []).map((u) => [u.id, u]),
  );

  const staff = userIds
    .map((userId) => {
      const user = userMap.get(userId);
      if (!user) return null;
      const staffId = staffIdByUser.get(userId) ?? null;
      const userLicences = (licencesByUser.get(userId) ?? []).map((l) => ({
        id: l.id,
        user_id: l.user_id,
        licence_type: l.licence_type,
        licence_number: l.licence_number ?? null,
        expiry_date: l.expiry_date,
        never_expires: l.never_expires,
      }));
      return {
        user_id: userId,
        staff_id: staffId,
        name: user.name,
        email: user.email,
        active: user.active,
        licences: userLicences,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return json(200, { staff });
});
