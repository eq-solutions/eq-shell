// GET /.netlify/functions/ai-briefing
//
// Thin HTTP wrapper around the shared briefing engine (see _shared/briefing-engine.ts).
// Responsibilities here: session auth, per-user 10-minute cache, error mapping.
//
// All data-fetching, Claude synthesis, and signal logic live in briefing-engine.ts
// so the same logic runs for both the on-demand HTTP endpoint and the daily
// scheduled email (scheduled-briefing.ts).

import type { Context } from '@netlify/functions';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry, captureServerError } from './_shared/sentry.js';
import { generateBrief, type FullBriefingResponse } from './_shared/briefing-engine.js';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readCache(tenantDb: any, userId: string): Promise<FullBriefingResponse | null> {
  try {
    const res = await tenantDb
      .schema('app_data')
      .from('briefing_cache')
      .select('payload, generated_at')
      .eq('user_id', userId)
      .single();
    if (res.error || !res.data) return null;
    const age = Date.now() - new Date(res.data.generated_at as string).getTime();
    return age < CACHE_TTL_MS ? (res.data.payload as FullBriefingResponse) : null;
  } catch {
    return null;
  }
}

async function writeCache(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tenantDb: any,
  tenantId: string,
  userId: string,
  payload: FullBriefingResponse,
): Promise<void> {
  try {
    await tenantDb
      .schema('app_data')
      .from('briefing_cache')
      .upsert(
        { tenant_id: tenantId, user_id: userId, payload, generated_at: payload.generated_at },
        { onConflict: 'user_id' },
      );
  } catch (e) {
    console.warn('[ai-briefing] cache write failed:', (e as Error).message);
  }
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });

  const { tenant_id: tenantId, user_id: userId } = session;
  const skipCache = new URL(req.url).searchParams.has('refresh');

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    if (e instanceof TenantNotFoundError)             return json(500, { ok: false, error: 'tenant_not_provisioned' });
    if (e instanceof TenantNotActiveError)            return json(503, { ok: false, error: 'tenant_inactive' });
    if (e instanceof TenantRoutingMisconfiguredError) return json(500, { ok: false, error: 'routing_misconfigured' });
    return json(500, { ok: false, error: 'internal_error' });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  if (!skipCache) {
    const cached = await readCache(tenantAny, userId);
    if (cached) return json(200, cached);
  }

  try {
    const briefing = await generateBrief(tenantId);
    await writeCache(tenantAny, tenantId, userId, briefing);
    return json(200, briefing);
  } catch (e) {
    captureServerError(e, { context: 'ai-briefing', tenantId });
    console.error('[ai-briefing] generateBrief failed:', (e as Error).message);
    return json(500, { ok: false, error: 'synthesis_failed', detail: (e as Error).message });
  }
});
