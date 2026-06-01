// netlify/functions/quotes-expiry-scheduler.ts
//
// Scheduled Function — fires daily at 21:00 UTC (07:00 AEST).
// Calls the eq-quotes Flask app's expired-quote detection endpoint,
// which scans all sent quotes past their validity window and emits
// quote.expired canonical events.
//
// Env vars required (eq-shell Netlify):
//   QUOTES_APP_URL    — base URL for the quotes app (https://quotes.eq.solutions)
//   QUOTES_CRON_SECRET — Bearer token matching $CRON_SECRET on the Fly.io app
//
// Schedule: "0 21 * * *" = 21:00 UTC daily

import type { Config } from '@netlify/functions';
import { withSentry, captureServerError } from './_shared/sentry.js';

export const config: Config = {
  schedule: '0 21 * * *',
};

export default withSentry(async (): Promise<Response> => {
  const appUrl = process.env.QUOTES_APP_URL?.replace(/\/$/, '');
  const secret = process.env.QUOTES_CRON_SECRET;

  if (!appUrl || !secret) {
    console.error('[quotes-expiry-scheduler] QUOTES_APP_URL or QUOTES_CRON_SECRET not configured');
    return new Response(JSON.stringify({ ok: false, error: 'not_configured' }), { status: 500 });
  }

  const url = `${appUrl}/api/cron/check-expired-quotes`;
  console.log(`[quotes-expiry-scheduler] POST ${url}`);

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
    console.log(`[quotes-expiry-scheduler] status=${res.status}`, body);

    if (!res.ok) {
      throw new Error(`quotes app returned ${res.status}: ${JSON.stringify(body)}`);
    }

    return new Response(JSON.stringify({ ok: true, ...body }), { status: 200 });
  } catch (e) {
    captureServerError(e, { context: 'quotes-expiry-scheduler' });
    console.error('[quotes-expiry-scheduler] failed:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
