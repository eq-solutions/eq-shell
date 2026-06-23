// GET /.netlify/functions/cards-staff-matches?worker_user_id=<uuid>
//
// Returns ranked app_data.staff candidates that may be the same person as the
// given Cards worker. Called by AdminCardsFeed before an admin approves a
// self-signup application so they can confirm whether the worker already exists
// in their Field roster.
//
// Confidence tiers (returned in priority order):
//   phone_exact   — 9-digit mobile suffix matches after stripping +61/0 prefix
//   email_exact   — email (case-insensitive) matches exactly
//   name_close    — bigram similarity ≥ 0.5
//   name_possible — bigram similarity 0.3–0.5
//
// Already-linked staff (cards_worker_id IS NOT NULL) are excluded — they are
// already resolved and don't need to appear in the match list.
//
// Manager + platform_admin only.

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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Normalise to the 9-digit mobile suffix (bare, no leading 0 or +61).
// "+61412345678", "0412345678", "0412 345 678" all → "412345678".
function bareNine(phone: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('61') && digits.length === 11) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) return digits.slice(1);
  return digits;
}

function bigrams(s: string): Set<string> {
  const n = s.toLowerCase().replace(/[^a-z]/g, '');
  const set = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) set.add(n.slice(i, i + 2));
  return set;
}

function nameSimilarity(a: string, b: string): number {
  const ab = bigrams(a), bb = bigrams(b);
  if (!ab.size || !bb.size) return 0;
  let intersection = 0;
  for (const g of ab) if (bb.has(g)) intersection++;
  return (2 * intersection) / (ab.size + bb.size);
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { error: 'Not signed in' });
  if (!can(session, 'admin.review_cards')) return json(403, { error: 'Manager access required' });

  const url = new URL(req.url);
  const workerUserId = url.searchParams.get('worker_user_id');
  if (!workerUserId) return json(400, { error: 'worker_user_id is required' });

  const sb = getServiceClient();
  const tenantId = session.tenant_id;

  // Fetch the Cards worker from eq-canonical public schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbPublic = (sb as any).schema('public');
  const { data: worker, error: workerErr } = (await sbPublic
    .from('workers')
    .select('id, first_name, last_name, phone, email')
    .eq('user_id', workerUserId)
    .maybeSingle()) as {
    data: {
      id: string;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      email: string | null;
    } | null;
    error: { message: string } | null;
  };

  if (workerErr || !worker) return json(404, { error: 'Worker not found' });

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    if (e instanceof TenantNotFoundError) return json(500, { error: 'No tenant data plane' });
    if (e instanceof TenantNotActiveError) return json(503, { error: 'Tenant data plane not active' });
    if (e instanceof TenantRoutingMisconfiguredError) return json(500, { error: 'Tenant routing unavailable' });
    return json(500, { error: 'Tenant resolution failed' });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  // Fetch unlinked staff for this tenant. Skip cards_worker_id IS NOT NULL rows —
  // those are already resolved and shouldn't appear in the match list.
  const { data: staffList } = (await tenantAny
    .schema('app_data')
    .from('staff')
    .select('staff_id, first_name, last_name, phone, email')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .is('cards_worker_id', null)
    .limit(100)) as {
    data: Array<{
      staff_id: string;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      email: string | null;
    }> | null;
  };

  if (!staffList || staffList.length === 0) return json(200, { matches: [] });

  const workerBare = bareNine(worker.phone);
  const workerEmail = (worker.email ?? '').toLowerCase();
  const workerName = [worker.first_name, worker.last_name].filter(Boolean).join(' ');

  type Confidence = 'phone_exact' | 'email_exact' | 'name_close' | 'name_possible';
  const CONFIDENCE_ORDER: Record<Confidence, number> = {
    phone_exact: 0, email_exact: 1, name_close: 2, name_possible: 3,
  };

  const candidates: Array<{
    staff_id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    confidence: Confidence;
    match_reason: string;
  }> = [];

  for (const staff of staffList) {
    const staffBare = bareNine(staff.phone);
    if (workerBare && staffBare && workerBare === staffBare) {
      candidates.push({ ...staff, confidence: 'phone_exact', match_reason: 'same phone number' });
      continue;
    }

    const staffEmail = (staff.email ?? '').toLowerCase();
    if (workerEmail && staffEmail && workerEmail === staffEmail) {
      candidates.push({ ...staff, confidence: 'email_exact', match_reason: 'same email address' });
      continue;
    }

    if (workerName) {
      const staffName = [staff.first_name, staff.last_name].filter(Boolean).join(' ');
      const sim = staffName ? nameSimilarity(workerName, staffName) : 0;
      if (sim >= 0.5) {
        candidates.push({ ...staff, confidence: 'name_close', match_reason: 'similar name' });
      } else if (sim >= 0.3) {
        candidates.push({ ...staff, confidence: 'name_possible', match_reason: 'possible match' });
      }
    }
  }

  candidates.sort((a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence]);
  return json(200, { matches: candidates.slice(0, 5) });
});
