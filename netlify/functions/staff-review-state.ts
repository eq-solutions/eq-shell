// GET /.netlify/functions/staff-review-state
//
// Returns per-staff licence-review state for the caller's tenant, so the staff
// list can show a reviewed / flagged / re-review / not-reviewed badge and filter
// on it. Reads shell_control.cards_field_approvals (the same rows the review
// modal writes), scoped to the caller's tenant.
//
// Shape: { review: [{ staff_id, reviewed_at, verified: [{licence_id, status}] }] }
// Only members who have actually been reviewed appear; everyone else is treated
// as "not reviewed" client-side. field.view required (same as the licence list).

import { getServiceClient } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { can } from './_shared/permissions.js';
import { withSentry } from './_shared/sentry.js';

interface VerificationRow {
  licence_id?: unknown;
  status?: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default withSentry(async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'Not signed in' });
  if (!can(session, 'field.view')) return json(403, { error: 'Access denied' });

  const sb = getServiceClient();

  const { data, error } = (await sb
    .from('cards_field_approvals')
    .select('staff_id, licences_verified_at, licence_verifications, approved_by_user_id')
    .eq('tenant_id', session.tenant_id)
    .not('licences_verified_at', 'is', null)) as {
    data: Array<{
      staff_id: string;
      licences_verified_at: string | null;
      licence_verifications: VerificationRow[] | null;
      approved_by_user_id: string | null;
    }> | null;
    error: { message: string } | null;
  };

  if (error) return json(500, { error: error.message });

  // Resolve reviewer ids → names (shell_control.users) in one round-trip.
  const reviewerIds = [...new Set((data ?? []).map((r) => r.approved_by_user_id).filter((v): v is string => !!v))];
  const nameById = new Map<string, string>();
  if (reviewerIds.length > 0) {
    const { data: users } = (await sb
      .from('users')
      .select('id, name')
      .in('id', reviewerIds)) as { data: Array<{ id: string; name: string | null }> | null };
    for (const u of users ?? []) if (u.name) nameById.set(u.id, u.name);
  }

  const review = (data ?? []).map((r) => ({
    staff_id: r.staff_id,
    reviewed_at: r.licences_verified_at,
    reviewed_by: r.approved_by_user_id ?? null,
    reviewed_by_name: r.approved_by_user_id ? (nameById.get(r.approved_by_user_id) ?? null) : null,
    verified: Array.isArray(r.licence_verifications)
      ? r.licence_verifications
          .filter((v) => typeof v.licence_id === 'string' && (v.status === 'sighted' || v.status === 'flagged'))
          .map((v) => ({ licence_id: v.licence_id as string, status: v.status as 'sighted' | 'flagged' }))
      : [],
  }));

  return json(200, { review });
});
