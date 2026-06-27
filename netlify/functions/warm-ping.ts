// Scheduled every 4 minutes to keep the most-visited Netlify functions warm.
//
// AWS Lambda recycles idle containers after ~5 minutes. A 401 from an
// unauthenticated request is enough to prevent a cold start — the runtime
// initialises regardless of auth outcome. Each function endpoint has its
// own Lambda; warming one does not warm others.
//
// Endpoints chosen: highest-traffic read paths that cause visible page-load
// latency when cold. Auth/session functions warm themselves (every page uses
// them). AI functions are deliberately excluded — they are rare and expensive
// to keep hot.

import type { Config } from '@netlify/functions';

export const config: Config = {
  schedule: '*/4 * * * *',
};

const WARM_PATHS = [
  '/.netlify/functions/tenant-dashboard',
  '/.netlify/functions/crm-customers?action=list',
  '/.netlify/functions/entity-rows?entity=staff',
  '/.netlify/functions/verify-shell-session',
  '/.netlify/functions/equipment-list',
];

export default async function handler(): Promise<void> {
  const base = (process.env.URL ?? 'https://core.eq.solutions').replace(/\/$/, '');
  const results = await Promise.allSettled(
    WARM_PATHS.map((path) =>
      fetch(`${base}${path}`, {
        method: 'GET',
        headers: { 'X-Warm-Ping': '1' },
        signal: AbortSignal.timeout(8_000),
      }),
    ),
  );
  const summary = results.map((r, i) =>
    r.status === 'fulfilled' ? `${WARM_PATHS[i]} → ${r.value.status}` : `${WARM_PATHS[i]} → ERR`,
  );
  console.log('[warm-ping]', summary.join(', '));
}
