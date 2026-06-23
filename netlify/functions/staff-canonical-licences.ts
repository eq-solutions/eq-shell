// GET /.netlify/functions/staff-canonical-licences
//
// Returns licences from public.licences (eq-canonical) for all staff who are
// actively connected to this tenant's org via org_memberships.
//
// Response is shaped as { licences: LicenceRow[] } where each row carries
// staff_id (from workers.staff_id) so StaffPage.tsx can join without changes.
//
// Replaces entity-rows?entity=licence — that read app_data.licences (Field),
// which is now empty. Canonical is the single source of truth.
//
// field.view permission required (same as entity-rows for licences).

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

  if (!org) return json(200, { licences: [] });

  // 2. Active org_memberships → user_ids
  const { data: members } = (await sbPublic
    .from('org_memberships')
    .select('user_id')
    .eq('org_id', org.id)
    .eq('status', 'active')) as { data: Array<{ user_id: string }> | null };

  const userIds = (members ?? []).map((m) => m.user_id).filter(Boolean);
  if (userIds.length === 0) return json(200, { licences: [] });

  // 3. workers → map user_id → staff_id (Field anchor)
  const { data: workers } = (await sbPublic
    .from('workers')
    .select('user_id, staff_id')
    .in('user_id', userIds)
    .not('staff_id', 'is', null)) as {
    data: Array<{ user_id: string; staff_id: string }> | null;
  };

  const staffIdByUser = new Map<string, string>();
  for (const w of workers ?? []) {
    if (w.user_id && w.staff_id) staffIdByUser.set(w.user_id, w.staff_id);
  }

  const linkedUserIds = Array.from(staffIdByUser.keys());
  if (linkedUserIds.length === 0) return json(200, { licences: [] });

  // 4. Canonical licences for connected, linked workers
  const { data: licences, error: licErr } = (await sbPublic
    .from('licences')
    .select('id, user_id, licence_type, licence_number, expiry_date, never_expires')
    .in('user_id', linkedUserIds)
    .is('deleted_at', null)) as {
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

  // 5. Shape for StaffPage.tsx — replace user_id with staff_id, normalise no_expiry
  const rows = (licences ?? [])
    .map((l) => {
      const staffId = staffIdByUser.get(l.user_id);
      if (!staffId) return null;
      const neverExpires = l.never_expires || l.expiry_date === '9999-12-31';
      return {
        id:             l.id,
        staff_id:       staffId,
        licence_type:   l.licence_type,
        licence_number: l.licence_number ?? null,
        expiry_date:    neverExpires ? null : l.expiry_date,
        no_expiry:      neverExpires,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return json(200, { licences: rows });
});
