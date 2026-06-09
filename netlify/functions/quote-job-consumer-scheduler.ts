// netlify/functions/quote-job-consumer-scheduler.ts
//
// WS5 — Durable event bus / outbox marking (cross-app-linkage-sprint-2026-06-09)
// (supersedes WS4 comment; no logic removed — only durability added)
//
// Scheduled Function (every 5 min): polls app_data.canonical_events for
// unprocessed quote.accepted events and creates the corresponding
// app_data.jobs rows — the canonical work-order spine entry that lets
// Field and Service reference the accepted quote as a job.
//
// Durability (WS5):
//   canonical_events.processed_by_quote_job boolean (DEFAULT false) is the
//   outbox marker.  The query now filters WHERE processed_by_quote_job IS NOT
//   TRUE so events emitted while the consumer was down are never silently lost.
//   After a job is created (or confirmed to already exist), the column is
//   flipped to true.  Re-runs scan only the unprocessed tail — index
//   idx_ce_unprocessed_quote_job makes this O(unprocessed), not O(all events).
//
// Idempotency:
//   job external_id = 'eq-quotes:job:<quote_id>'
//   The anti-join against existing jobs means re-runs are zero-cost.
//   23505 on concurrent insert is treated as a skip, not an error.
//
// Customer / site resolution:
//   Reads canonical_customer_id + canonical_site_id from sks_quotes
//   (populated by the Quotes dual-write path). If the quote hasn't been
//   synced yet, those columns are NULL and the job is created with NULLs —
//   they backfill once WS1 customer convergence completes.
//
// Multi-tenant:
//   QUOTE_JOB_TENANTS env var (comma-separated slugs, default: 'sks').
//   Add 'eq' when EQ gets Quotes. Each tenant is processed independently;
//   one tenant's failure doesn't block the others.
//
// Env vars (eq-shell Netlify):
//   QUOTE_JOB_TENANTS  — comma-separated tenant slugs (default: sks)
//
// Schedule: "*/5 * * * *" = every 5 minutes

import type { Config } from '@netlify/functions';
import {
  getTenantDataClient,
  getRoutingBySlug,
  TenantNotFoundError,
  TenantNotActiveError,
} from './_shared/tenant-routing.js';
import { withSentry, captureServerError } from './_shared/sentry.js';

export const config: Config = {
  schedule: '*/5 * * * *',
};

interface QuoteAcceptedPayload {
  quote_id: string;
  estimator?: string;
  to_status?: string;
}

interface TenantResult {
  created: number;
  skipped: number;
  errors:  number;
}

// How many unprocessed events to handle per tenant per run.
// Keeps execution time well under Netlify's 10s scheduled-function limit.
const BATCH_SIZE = 50;

export default withSentry(async (): Promise<Response> => {
  const tenantSlugs = (process.env.QUOTE_JOB_TENANTS ?? 'sks')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const results: Record<string, TenantResult> = {};

  for (const tenantSlug of tenantSlugs) {
    results[tenantSlug] = await processTenant(tenantSlug);
  }

  const totalErrors  = Object.values(results).reduce((s, r) => s + r.errors,  0);
  const totalCreated = Object.values(results).reduce((s, r) => s + r.created, 0);

  console.info('[quote-job-consumer] run complete', { results, totalCreated, totalErrors });

  return new Response(
    JSON.stringify({ ok: totalErrors === 0, results }),
    { status: totalErrors > 0 ? 207 : 200, headers: { 'Content-Type': 'application/json' } },
  );
});

async function processTenant(tenantSlug: string): Promise<TenantResult> {
  let client;
  let routing;

  try {
    client  = await getTenantDataClient(tenantSlug);
    routing = await getRoutingBySlug(tenantSlug);
  } catch (e) {
    if (e instanceof TenantNotFoundError || e instanceof TenantNotActiveError) {
      console.warn('[quote-job-consumer] tenant unavailable', { tenantSlug, error: String(e) });
      return { created: 0, skipped: 0, errors: 0 }; // not a hard error — tenant may be in transition
    }
    captureServerError(e, { context: 'quote-job-consumer', tenant: tenantSlug });
    console.error('[quote-job-consumer] tenant resolution failed', { tenantSlug, error: e });
    return { created: 0, skipped: 0, errors: 1 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = client as any;
  const tenantId = routing.tenant_id;

  // Step 1: Fetch up to BATCH_SIZE unprocessed quote.accepted events.
  // WS5: processed_by_quote_job IS NOT TRUE filters already-handled rows.
  // The partial index idx_ce_unprocessed_quote_job makes this scan O(unprocessed).
  const { data: events, error: eventsErr } = await db
    .schema('app_data')
    .from('canonical_events')
    .select('id, payload, occurred_at')
    .eq('tenant_id', tenantId)
    .eq('event', 'quote.accepted')
    .not('processed_by_quote_job', 'is', true)
    .order('occurred_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (eventsErr) {
    console.error('[quote-job-consumer] events query failed', { tenantSlug, error: eventsErr.message });
    return { created: 0, skipped: 0, errors: 1 };
  }

  if (!events?.length) {
    return { created: 0, skipped: 0, errors: 0 };
  }

  // Step 2: Anti-join — find which quote_ids already have a job so we skip them.
  const quoteIds    = (events as { payload: QuoteAcceptedPayload }[])
    .map(e => e.payload?.quote_id)
    .filter(Boolean) as string[];

  const externalIds = quoteIds.map(id => `eq-quotes:job:${id}`);

  const { data: existingJobs } = await db
    .schema('app_data')
    .from('jobs')
    .select('external_id')
    .eq('tenant_id', tenantId)
    .in('external_id', externalIds);

  const processedSet = new Set<string>(
    (existingJobs ?? []).map((j: { external_id: string }) => j.external_id),
  );

  let created = 0, skipped = 0, errors = 0;

  // WS5 helper: mark an event as processed so future runs skip it cheaply.
  async function markProcessed(eventId: number): Promise<void> {
    const { error } = await db
      .schema('app_data')
      .from('canonical_events')
      .update({ processed_by_quote_job: true })
      .eq('id', eventId);
    if (error) {
      // Non-fatal — worst case the event is re-processed next run (idempotent).
      console.warn('[quote-job-consumer] markProcessed failed', { tenantSlug, eventId, error: error.message });
    }
  }

  // Step 3: Create a job for each unprocessed event.
  for (const event of events as { id: number; payload: QuoteAcceptedPayload; occurred_at: string }[]) {
    const payload = event.payload;
    const quoteId = payload?.quote_id;

    if (!quoteId) {
      console.warn('[quote-job-consumer] event missing quote_id — marking processed to avoid re-queue loop', { tenantSlug, eventId: event.id });
      // WS5: poison-pill drain — malformed events must not block the queue indefinitely.
      await markProcessed(event.id);
      errors++;
      continue;
    }

    const externalId = `eq-quotes:job:${quoteId}`;

    if (processedSet.has(externalId)) {
      // Job already exists — mark event processed so it never re-queues.
      await markProcessed(event.id);
      skipped++;
      continue;
    }

    // Step 3a: Resolve customer/site from sks_quotes.
    // canonical_customer_id + canonical_site_id are populated by the Quotes
    // dual-write path. If NULL today, they'll be populated once WS1 lands.
    const { data: quote } = await db
      .from('sks_quotes')
      .select('id, title, customer_name, canonical_customer_id, canonical_site_id, status, number')
      .eq('id', quoteId)
      .maybeSingle() as {
        data: {
          id: string;
          title: string | null;
          customer_name: string | null;
          canonical_customer_id: string | null;
          canonical_site_id: string | null;
          status: string | null;
          number: string | null;
        } | null;
      };

    // Derive a meaningful title: prefer the quote's title, fall back to
    // "Quote <number> — <customer>" so the job row is human-readable from day one.
    const title = quote?.title
      ?? (quote?.number && quote?.customer_name
          ? `Quote ${quote.number} — ${quote.customer_name}`
          : `Quote ${quoteId}`);

    // Step 3b: Insert the job.
    const jobRow = {
      tenant_id:   tenantId,
      external_id: externalId,
      quote_id:    quoteId,          // soft UUID ref back to sks_quotes
      customer_id: quote?.canonical_customer_id ?? null,
      site_id:     quote?.canonical_site_id     ?? null,
      title,
      status:      'accepted',
      started_at:  event.occurred_at,
    };

    const { error: insertErr } = await db
      .schema('app_data')
      .from('jobs')
      .insert(jobRow);

    if (!insertErr) {
      console.info('[quote-job-consumer] job created', {
        tenantSlug, quoteId, externalId,
        hasCustomer: !!jobRow.customer_id,
        hasSite:     !!jobRow.site_id,
      });
      // WS5: mark durable — event won't be re-queued on next run.
      await markProcessed(event.id);
      created++;
    } else if ((insertErr as { code?: string }).code === '23505') {
      // Concurrent insert race — the job was already created. Not an error.
      // WS5: still mark processed so the event is drained from the queue.
      await markProcessed(event.id);
      skipped++;
    } else {
      console.error('[quote-job-consumer] job insert failed', {
        tenantSlug, quoteId, error: insertErr.message,
      });
      captureServerError(new Error(insertErr.message), {
        context: 'quote-job-consumer', tenant: tenantSlug, quoteId,
      });
      errors++;
    }
  }

  return { created, skipped, errors };
}
