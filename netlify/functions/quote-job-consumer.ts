// netlify/functions/quote-job-consumer.ts
//
// Operational consumer that turns the canonical event bus from observational
// into operational: it reacts to `quote.accepted` events (emitted by EQ Quotes)
// by creating the corresponding canonical work-order (`app_data.jobs`). This is
// what makes the quote → job → timesheet trace possible — before this, the jobs
// table had no writer at all and stayed empty.
//
// Design
//   - Reuses the canonical-api hub over HTTP (GET ?resource=events, PUT jobs)
//     with CANONICAL_API_KEY_SHELL, rather than re-implementing the idempotent
//     upsert. The hub upserts jobs by (tenant_id, external_id) — see migration
//     0040 — so creating the same job twice is a no-op.
//   - Idempotent + windowed: each run replays a bounded lookback window of
//     events and upserts a job per accepted quote, keyed on
//     external_id = 'eq-quotes:job:<quote_id>'. Because the upsert is idempotent,
//     no cursor/offset store is needed — reprocessing the window is harmless. A
//     fresh quote.accepted is always within the most-recent window shortly after
//     it occurs, so it is picked up on the next tick.
//   - v1 sets quote_id + title + external_id. customer_id / site_id are left null
//     (the quote.accepted payload doesn't carry canonical ids yet); the
//     quote→job link exists and customer/site enrichment is a follow-up once the
//     emit payload (or a lookup) provides them.
//
// Auth/scope: the 'shell' app key is cross-tenant ('*') in the hub, so the
// consumer can read events and write jobs for every active tenant.
//
// Env vars (eq-shell Netlify):
//   CANONICAL_API_KEY_SHELL — bearer key for the canonical-api hub
//   URL                     — Netlify-provided site URL (fallback core.eq.solutions)
//
// Schedule: every 15 minutes (in-file config, like quotes-expiry-scheduler).

import type { Config } from '@netlify/functions';
import { withSentry, captureServerError } from './_shared/sentry.js';
import { getServiceClient } from './_shared/supabase.js';

export const config: Config = {
  schedule: '*/15 * * * *',
};

const API_BASE = (process.env.URL ?? 'https://core.eq.solutions').replace(/\/$/, '');
const API_KEY = process.env.CANONICAL_API_KEY_SHELL;
const CANONICAL_ENDPOINT = `${API_BASE}/.netlify/functions/canonical-api`;

// Bounded replay window. Event volume is tiny and the upsert is idempotent, so a
// generous window costs nothing and survives a few missed ticks / downtime.
const LOOKBACK_HOURS = 24 * 7;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CanonicalEvent {
  id:          number | string;
  event:       string;
  payload:     Record<string, unknown> | null;
  occurred_at: string;
}

interface TenantStat {
  tenant:  string;
  events:  number;
  jobs:    number;
  error?:  string;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Active tenant slugs, read from the control plane (shell_control.tenant_routing). */
async function listActiveTenantSlugs(): Promise<string[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('tenant_routing')
    .select('status, tenants!inner ( slug )')
    .eq('status', 'active');
  if (error) throw new Error(`tenant_routing read failed: ${error.message}`);

  const slugs = new Set<string>();
  for (const row of (data ?? []) as Array<{ tenants: { slug?: string } | Array<{ slug?: string }> | null }>) {
    const t = row.tenants;
    if (Array.isArray(t)) {
      for (const x of t) if (x?.slug) slugs.add(x.slug);
    } else if (t?.slug) {
      slugs.add(t.slug);
    }
  }
  return [...slugs];
}

/** Pull the originating quote id (a UUID) out of a quote.accepted payload. */
function extractQuoteId(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const raw = payload.quote_id ?? payload.quoteId ?? payload.id;
  const val = typeof raw === 'number' ? String(raw) : (typeof raw === 'string' ? raw : null);
  return val && UUID_RE.test(val) ? val : null;
}

/** Pull a canonical UUID (customer_id / site_id) out of a quote.accepted payload. */
function extractUuid(payload: Record<string, unknown> | null, key: string): string | null {
  if (!payload) return null;
  const raw = payload[key];
  return typeof raw === 'string' && UUID_RE.test(raw) ? raw : null;
}

/** Human-readable job title from the quote.accepted payload. */
function buildTitle(payload: Record<string, unknown> | null): string {
  const ref  = payload && typeof payload.reference === 'string' ? payload.reference : null;
  const cust = payload && typeof payload.customer_name === 'string' ? payload.customer_name : null;
  let title: string;
  if (ref && cust) title = `${ref} — ${cust}`;
  else if (ref)    title = `Quote ${ref}`;
  else if (cust)   title = `Job for ${cust}`;
  else             title = 'Job from accepted quote';
  return title.slice(0, 200);
}

async function processTenant(slug: string, sinceIso: string): Promise<TenantStat> {
  // 1. Read recent events for this tenant via the hub.
  const evUrl =
    `${CANONICAL_ENDPOINT}?resource=events&tenant=${encodeURIComponent(slug)}` +
    `&since=${encodeURIComponent(sinceIso)}&limit=500`;
  const evRes = await fetch(evUrl, {
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'X-Tenant': slug },
    signal: AbortSignal.timeout(20_000),
  });
  const evBody = await evRes.json() as { ok: boolean; data?: CanonicalEvent[]; error?: string };
  if (!evRes.ok || !evBody.ok) {
    throw new Error(`events GET ${evRes.status}: ${evBody.error ?? 'unknown'}`);
  }

  const accepted = (evBody.data ?? []).filter((e) => e.event === 'quote.accepted');

  // 2. Upsert a job per accepted quote (idempotent on external_id).
  let jobs = 0;
  for (const ev of accepted) {
    const quoteId = extractQuoteId(ev.payload);
    if (!quoteId) {
      console.warn('[quote-job-consumer] quote.accepted without a usable quote_id — skipped', { slug, eventId: ev.id });
      continue;
    }
    // Canonical ids carried by the quote.accepted payload (emitted by
    // eq_update_quote_status, migration 0082) link the job to the spine. Omitted
    // keys leave the column null — the upsert tolerates partial bodies.
    const customerId = extractUuid(ev.payload, 'customer_id');
    const siteId     = extractUuid(ev.payload, 'site_id');
    const jobRes = await fetch(CANONICAL_ENDPOINT, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'X-Tenant':      slug,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        resource:    'jobs',
        external_id: `eq-quotes:job:${quoteId}`,
        quote_id:    quoteId,
        title:       buildTitle(ev.payload),
        ...(customerId ? { customer_id: customerId } : {}),
        ...(siteId ? { site_id: siteId } : {}),
        // status omitted — DB default 'active'.
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const jobBody = await jobRes.json() as { ok: boolean; error?: string; detail?: string };
    if (!jobRes.ok || !jobBody.ok) {
      console.error('[quote-job-consumer] job PUT failed', {
        slug, quoteId, status: jobRes.status, error: jobBody.error, detail: jobBody.detail,
      });
      continue;
    }
    jobs++;
  }

  return { tenant: slug, events: accepted.length, jobs };
}

export default withSentry(async (): Promise<Response> => {
  if (!API_KEY) {
    console.error('[quote-job-consumer] CANONICAL_API_KEY_SHELL not configured');
    return json(500, { ok: false, error: 'not_configured' });
  }

  let slugs: string[];
  try {
    slugs = await listActiveTenantSlugs();
  } catch (e) {
    captureServerError(e, { context: 'quote-job-consumer:list-tenants' });
    return json(500, { ok: false, error: 'tenant_list_failed', detail: String(e) });
  }

  const sinceIso = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();
  const perTenant: TenantStat[] = [];
  let eventsSeen = 0, jobsUpserted = 0, errored = 0;

  for (const slug of slugs) {
    try {
      const stat = await processTenant(slug, sinceIso);
      eventsSeen += stat.events;
      jobsUpserted += stat.jobs;
      perTenant.push(stat);
    } catch (e) {
      errored++;
      captureServerError(e, { context: 'quote-job-consumer:tenant', tenant: slug });
      perTenant.push({ tenant: slug, events: 0, jobs: 0, error: String(e) });
    }
  }

  return json(200, {
    ok: true,
    ranAt: new Date().toISOString(),
    tenants: slugs.length,
    eventsSeen,
    jobsUpserted,
    errored,
    perTenant,
  });
});
