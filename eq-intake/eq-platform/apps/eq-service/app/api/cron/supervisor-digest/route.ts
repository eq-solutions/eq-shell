/**
 * /api/cron/supervisor-digest
 *
 * Daily-digest endpoint for supervisors. Iterates every active supervisor /
 * admin / super_admin across all tenants and sends them their per-tenant
 * PM calendar digest via Resend.
 *
 * Auth: must include `Authorization: Bearer ${CRON_SECRET}`. The secret
 * is set in Netlify env vars and matches the secret configured on the
 * Netlify Scheduled Function (or whatever scheduler is hitting it).
 *
 * Trigger options:
 *   - Netlify Scheduled Functions: schedule with `* 0 21 * * *` (07:00
 *     AEST = 21:00 UTC the prior day) calling fetch() to this route
 *   - pg_cron + http extension on Supabase
 *   - External cron (cron-job.org, EasyCron, etc.)
 *
 * Returns 200 with a JSON summary of sends. Errors per supervisor don't
 * fail the request — the response includes per-supervisor status and the
 * row in supervisor_digests captures the error.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runSupervisorDigests } from '@/lib/calendar/supervisor-digest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function resolveAppUrl(req: NextRequest): string {
  // Prefer NEXT_PUBLIC_SITE_URL (the existing Netlify env var). Falls
  // through to NEXT_PUBLIC_APP_URL / APP_URL for forward-compat, then
  // the request origin so dev works without any env var.
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    req.nextUrl.origin
  )
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured on server' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${cronSecret}`
  if (authHeader !== expected) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const horizonParam = url.searchParams.get('horizon')
  const horizonDays = horizonParam ? Math.max(1, parseInt(horizonParam, 10)) : 14

  try {
    const results = await runSupervisorDigests({
      triggerSource: 'cron',
      horizonDays,
      appUrl: resolveAppUrl(req),
    })

    const sent = results.filter((r) => r.status === 'sent').length
    const skippedEmpty = results.filter((r) => r.status === 'skipped_empty').length
    const skippedNoEmail = results.filter((r) => r.status === 'skipped_no_email').length
    const errors = results.filter((r) => r.status === 'error')

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      horizonDays,
      total: results.length,
      sent,
      skippedEmpty,
      skippedNoEmail,
      errored: errors.length,
      // Limit echo to error rows + counts so the response stays small
      // for log scrapers. Full detail is in supervisor_digests.
      errors: errors.map((e) => ({
        tenantId: e.tenantId,
        supervisorEmail: e.supervisorEmail,
        error: e.error,
      })),
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    )
  }
}

// GET returns a hint for humans hitting the URL in a browser; never sends.
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      hint: 'POST with Authorization: Bearer $CRON_SECRET to trigger the supervisor digest. GET is read-only.',
    },
    { status: 405 },
  )
}
