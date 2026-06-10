/**
 * supervisor-digest-scheduler.ts — Netlify Scheduled Function
 *
 * Fires daily at 21:00 UTC (07:00 AEST / 08:00 AEDT). Posts to
 * /api/cron/supervisor-digest with `Authorization: Bearer $CRON_SECRET`
 * so the route iterates every active supervisor across every tenant and
 * sends their PM digest via Resend.
 *
 * Scheduling config lives in netlify.toml under
 * `[functions."supervisor-digest-scheduler"]`.
 *
 * Env vars required:
 *   CRON_SECRET         — bearer token expected by /api/cron/supervisor-digest
 *   NEXT_PUBLIC_SITE_URL (preferred) / URL — public URL of the deployed app
 *
 * Failures are logged but don't throw. Each supervisor's delivery is
 * audited inside supervisor_digests regardless of whether this function
 * succeeds end-to-end.
 */

import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'

function resolveAppUrl(): string {
  // NEXT_PUBLIC_SITE_URL is the app's canonical URL (set in Netlify env).
  // URL is Netlify's own deploy URL, used as a fallback for preview/
  // branch deploys where NEXT_PUBLIC_SITE_URL points at prod.
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.URL ||
    'https://eq-solves-service.netlify.app'
  )
}

export const handler: Handler = async (_event: HandlerEvent, _context: HandlerContext) => {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[digest-scheduler] CRON_SECRET not configured — aborting')
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'missing_cron_secret' }) }
  }

  const url = `${resolveAppUrl().replace(/\/$/, '')}/api/cron/supervisor-digest`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
    })

    const text = await res.text()
    let parsed: unknown = null
    try { parsed = JSON.parse(text) } catch { /* non-JSON response */ }

    if (!res.ok) {
      console.error(`[digest-scheduler] digest endpoint returned ${res.status}: ${text}`)
      return {
        statusCode: 502,
        body: JSON.stringify({ ok: false, upstream_status: res.status, upstream_body: parsed ?? text }),
      }
    }

    console.log('[digest-scheduler] digest run succeeded', parsed)
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, upstream: parsed }),
    }
  } catch (err) {
    const message = (err as Error).message
    console.error('[digest-scheduler] fetch failed:', message)
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: message }),
    }
  }
}
