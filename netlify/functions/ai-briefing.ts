// GET /.netlify/functions/ai-briefing
//
// Returns a plain-English 2-3 sentence operational briefing synthesised from
// the last 48h of canonical_events on the tenant data plane.
//
// Non-fatal degradation path:
//   - No events → { ok: true, briefing: null }
//   - ANTHROPIC_API_KEY missing → { ok: true, briefing: null }
//   - Anthropic call fails → log + { ok: true, briefing: null }
//
// Response is cached privately in the browser for 5 minutes (private, max-age=300)
// — per-user only, never shared/CDN-cached (it's tenant-scoped operational data).

import type { Context } from '@netlify/functions';
import {
  getTenantDataClientById,
  TenantNotFoundError,
  TenantNotActiveError,
  TenantRoutingMisconfiguredError,
} from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry, captureServerError } from './_shared/sentry.js';

const ANTHROPIC_API_VERSION = '2023-06-01';
const BRIEFING_MODEL = 'claude-haiku-4-5';
const BRIEFING_MAX_TOKENS = 200;

const SYSTEM_PROMPT =
  'You are the operations briefing assistant for EQ Solutions. Given recent activity events from the EQ suite, write a 2-3 sentence plain-English briefing for a busy operations manager. Prioritise what needs action: unaccepted quotes, open defects, overdue checks. No jargon, no bullet points, no markdown. Maximum 3 sentences.';

interface CanonicalEvent {
  id:          string;
  app_source:  string;
  event:       string;
  payload:     Record<string, unknown>;
  occurred_at: string;
}

function json(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=300',
      ...extraHeaders,
    },
  });
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return json(401, { ok: false, error: 'not_signed_in' });

  const tenantId = session.tenant_id;

  let tenantDb;
  try {
    tenantDb = await getTenantDataClientById(tenantId);
  } catch (e) {
    return tenantRoutingError(e);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tenantAny = tenantDb as any;

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const eventsRes = await tenantAny
    .schema('app_data')
    .from('canonical_events')
    .select('id, app_source, event, payload, occurred_at')
    .gte('occurred_at', cutoff)
    .order('occurred_at', { ascending: false })
    .limit(20);

  if (eventsRes.error) {
    console.warn('[ai-briefing] canonical events query failed', { tenantId, error: eventsRes.error.message });
    return json(200, { ok: true, briefing: null, generated_at: new Date().toISOString() });
  }

  const events = (eventsRes.data ?? []) as CanonicalEvent[];

  if (events.length === 0) {
    return json(200, { ok: true, briefing: null, generated_at: new Date().toISOString() });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.info('[ai-briefing] ANTHROPIC_API_KEY not set — skipping synthesis');
    return json(200, { ok: true, briefing: null, generated_at: new Date().toISOString() });
  }

  try {
    const userMessage = `${events.length} events in the last 48 hours:\n${JSON.stringify(events)}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: BRIEFING_MODEL,
        max_tokens: BRIEFING_MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${body}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await resp.json() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textBlocks = (data.content ?? []).filter((b: any) => b.type === 'text');
    const briefing: string = textBlocks.map((b: { text: string }) => b.text).join('').trim();

    return json(200, { ok: true, briefing: briefing || null, generated_at: new Date().toISOString() });
  } catch (e) {
    // Non-fatal — briefing is best-effort. Log to Sentry but serve null so the
    // dashboard still loads.
    captureServerError(e, { context: 'ai-briefing', tenantId });
    console.warn('[ai-briefing] Anthropic call failed', e);
    return json(200, { ok: true, briefing: null, generated_at: new Date().toISOString() });
  }
});

function tenantRoutingError(e: unknown): Response {
  if (e instanceof TenantNotFoundError) {
    return json(500, { ok: false, error: 'tenant_not_provisioned', detail: e.identifier });
  }
  if (e instanceof TenantNotActiveError) {
    return json(503, { ok: false, error: 'tenant_inactive', detail: e.status });
  }
  if (e instanceof TenantRoutingMisconfiguredError) {
    console.error('[ai-briefing] tenant routing misconfigured', e);
    return json(500, { ok: false, error: 'routing_misconfigured' });
  }
  console.error('[ai-briefing] unexpected tenant resolution error', e);
  return json(500, { ok: false, error: 'internal_error' });
}
