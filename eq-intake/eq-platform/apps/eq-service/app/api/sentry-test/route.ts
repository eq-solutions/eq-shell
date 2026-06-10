/**
 * GET /api/sentry-test
 *
 * Deliberately throws an error so Sentry's server-side capture can be
 * verified after deploy. Hit this URL once after wiring up the
 * SENTRY_DSN in Netlify; an event should appear in the Sentry dashboard
 * within ~30 seconds.
 *
 * Auth: requires the verifying user to be signed in (anonymous calls
 * get 401). This prevents the endpoint becoming a DoS toy — Sentry
 * free tier is 5k events/month and a public test endpoint could burn
 * through that in an hour.
 *
 * Safe to leave in prod: it's gated on auth, returns a normal HTTP
 * error response, and explicitly emits a recognisable signature so
 * the error is easy to filter out of dashboards if you don't want it
 * to count toward your monthly quota.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })
  }

  // Throwing here causes Next.js to surface the error to the user via
  // the standard 500 page AND emit it to Sentry via instrumentation.ts's
  // onRequestError export. Both behaviours are intentional.
  throw new Error(
    '[sentry-test] Deliberate error from /api/sentry-test — ignore this in dashboards. ' +
      'See docs/runbooks/sentry-setup.md.',
  )
}
