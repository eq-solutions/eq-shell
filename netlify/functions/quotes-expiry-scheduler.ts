// netlify/functions/quotes-expiry-scheduler.ts
//
// Scheduled Function — fires daily at 21:00 UTC (07:00 AEST).
// Calls eq_mark_expired_quotes on each configured tenant's Supabase DB,
// replacing the deprecated Flask /api/cron/check-expired-quotes endpoint.
//
// Env vars required (eq-shell Netlify):
//   SCHEDULER_TENANT_SLUGS — comma-separated list of active tenant slugs
//                            (defaults to "sks" if not set)
//
// Schedule: "0 21 * * *" = 21:00 UTC daily

import type { Config } from '@netlify/functions';
import {
  getTenantRpcClient,
  TenantNotFoundError,
  TenantNotActiveError,
} from './_shared/tenant-routing.js';
import { withSentry, captureServerError } from './_shared/sentry.js';

export const config: Config = {
  schedule: '0 21 * * *',
};

interface ExpiryResult {
  slug: string;
  expired: number | null;
  error?: string;
}

export default withSentry(async (): Promise<Response> => {
  const slugsRaw = process.env.SCHEDULER_TENANT_SLUGS ?? 'sks';
  const slugs = slugsRaw.split(',').map((s) => s.trim()).filter(Boolean);

  const results: ExpiryResult[] = await Promise.all(
    slugs.map(async (slug): Promise<ExpiryResult> => {
      try {
        const supabase = await getTenantRpcClient(slug);
        const { data, error } = await supabase.rpc('eq_mark_expired_quotes');
        if (error) {
          console.error(`[quotes-expiry-scheduler] ${slug} rpc error:`, error.message);
          return { slug, expired: null, error: error.message };
        }
        const row = Array.isArray(data) ? (data as { expired_count: number }[])[0] : null;
        const expired = row?.expired_count ?? 0;
        console.log(`[quotes-expiry-scheduler] ${slug}: ${expired} quote(s) expired`);
        return { slug, expired };
      } catch (e) {
        if (e instanceof TenantNotFoundError || e instanceof TenantNotActiveError) {
          console.warn(`[quotes-expiry-scheduler] ${slug} not found or inactive — skipping`);
          return { slug, expired: null, error: 'tenant_not_active' };
        }
        captureServerError(e, { context: 'quotes-expiry-scheduler', slug });
        console.error(`[quotes-expiry-scheduler] ${slug} unexpected error:`, e);
        return { slug, expired: null, error: String(e) };
      }
    })
  );

  const totalExpired = results.reduce((n, r) => n + (r.expired ?? 0), 0);
  const anyError = results.some((r) => r.error && r.error !== 'tenant_not_active');

  console.log(`[quotes-expiry-scheduler] done — ${totalExpired} total expired across ${slugs.length} tenant(s)`);

  return new Response(
    JSON.stringify({ ok: !anyError, results, total_expired: totalExpired }),
    { status: anyError ? 207 : 200, headers: { 'Content-Type': 'application/json' } }
  );
});
