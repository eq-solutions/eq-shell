// netlify/functions/canonical-outbox-quotes-scheduler.ts
//
// Scheduled Function — fires every 5 minutes and POSTs to the eq-quotes Flask
// app's /api/cron/drain-canonical-outbox endpoint, which replays any canonical
// writes (customer upserts + quote.* events) that failed their inline attempt.
// Durability for the EQ Quotes → canonical reference-layer path.
//
// Mirrors quotes-expiry-scheduler.ts (same QUOTES_APP_URL / QUOTES_CRON_SECRET).
//
// Env vars (eq-shell Netlify):
//   QUOTES_APP_URL     — base URL for the quotes app (https://quotes.eq.solutions)
//   QUOTES_CRON_SECRET — Bearer token matching $CRON_SECRET on the Fly.io app
//
// Schedule: "*/5 * * * *" = every 5 minutes

import type { Config } from '@netlify/functions';
import { withSentry, captureServerError } from './_shared/sentry.js';

export const config: Config = {
  schedule: '*/5 * * * *',
};

export default withSentry(async (): Promise<Response> => {
  const appUrl = process.env.QUOTES_APP_URL?.replace(/\/$/, '');
  const secret = process.env.QUOTES_CRON_SECRET;

  if (!appUrl || !secret) {
    console.error('[canonical-outbox-quotes-scheduler] QUOTES_APP_URL or QUOTES_CRON_SECRET not configured');
    return new Response(JSON.stringify({ ok: false, error: 'not_configured' }), { status: 500 });
  }

  const url = `${appUrl}/api/cron/drain-canonical-outbox`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
    });

    const body = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      throw new Error(`quotes app returned ${res.status}: ${JSON.stringify(body)}`);
    }

    return new Response(JSON.stringify({ ok: true, ...(body as object) }), { status: 200 });
  } catch (e) {
    captureServerError(e, { context: 'canonical-outbox-quotes-scheduler' });
    console.error('[canonical-outbox-quotes-scheduler] failed:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
