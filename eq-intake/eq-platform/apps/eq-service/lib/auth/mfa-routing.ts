/**
 * MFA routing helpers — pure functions extracted from proxy.ts so they
 * can be unit-tested without spinning up the full Next.js middleware.
 *
 * The behaviour these helpers encode is the load-bearing answer to the
 * MFA AAL1 loop bug:
 *   - A user with an enrolled TOTP factor signs in
 *   - Supabase issues an AAL1 session and signals nextLevel=aal2
 *   - Middleware redirects them to /auth/mfa to challenge the factor
 *   - If /auth/signin is NOT exempt from the redirect, the user trying
 *     to back out and start fresh gets bounced into /auth/mfa again,
 *     forever. That was the loop.
 *
 * Fix landed 2026-04-26: /auth/signin added to AAL_EXEMPT_PATHS so a
 * stuck user can always reach the signin page (and from there, sign out
 * to clear the half-completed session).
 *
 * These helpers + their vitest spec are the regression test for that fix.
 * If the AAL exemption set ever drops /auth/signin, the test fails before
 * the bug ships.
 */

export const PUBLIC_PATHS = [
  '/auth/signin',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/callback',
  // Invite acceptance landing page. The invited user is unauthenticated
  // when they click the link in their welcome email — they're about to
  // SET their password via the 8-digit OTP form here. Without this
  // exemption the proxy bounces them to /auth/signin and the only way
  // forward is "Forgot password" (which works because that path IS
  // public, but it routes them through the reset-password screen
  // instead of the welcome rail). Bug surfaced 2026-05-14 onboarding.
  '/auth/accept-invite',
  // Customer portal magic-link entry point. The portal is reached by
  // customers who never sign up for a staff account; their only auth
  // surface is /portal/login (form) → /api/portal/magic-link (POST) →
  // /auth/callback (after they click the email). The first two MUST be
  // public, otherwise the proxy redirects to /auth/signin and the
  // customer hits the staff form instead.
  '/portal/login',
  '/api/portal/magic-link',
  // Cron / scheduled endpoints. Called server-to-server by pg_cron (via
  // pg_net) or Netlify Scheduled Functions — no user session. Each
  // handler enforces `Authorization: Bearer ${CRON_SECRET}` internally;
  // the proxy must NOT redirect or pg_net follows the 307 to /auth/signin
  // and returns the rendered signin HTML to the dispatcher.
  '/api/cron/dispatch-notifications',
  '/api/cron/supervisor-digest',
  // Customer-facing unsubscribe (AU Spam Act 2003 s18 compliance).
  // The signed token in ?token=... IS the auth check — no Supabase
  // session required. Visiting flips the receive_* prefs synchronously.
  '/portal/unsubscribe',
] as const

export const MFA_PATHS = [
  '/auth/mfa',
  '/auth/enroll-mfa',
] as const

/**
 * Paths an authenticated user can reach without completing MFA.
 * Critical: /auth/signin MUST be in this list — otherwise users stuck
 * in AAL1 with an enrolled TOTP factor can't back out to sign out.
 */
export const AAL_EXEMPT_PATHS = [
  '/auth/mfa',
  '/auth/enroll-mfa',
  '/auth/reset-password',
  '/auth/signout',
  '/auth/signin',
] as const

export interface AalState {
  /** Current session AAL level. 'aal1' = password-only, 'aal2' = MFA-completed. */
  currentLevel: 'aal1' | 'aal2'
  /** Required AAL level for this user. 'aal2' if a factor is enrolled. */
  nextLevel: 'aal1' | 'aal2'
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p))
}

export function isMfaPath(pathname: string): boolean {
  return MFA_PATHS.some((p) => pathname.startsWith(p))
}

export function isAalExempt(pathname: string): boolean {
  return AAL_EXEMPT_PATHS.some((p) => pathname.startsWith(p))
}

/**
 * Decide whether an authenticated request should be redirected to /auth/mfa
 * for factor challenge. Returns null if no redirect is needed.
 *
 * The combination that triggers redirect is the user has an enrolled factor
 * (`nextLevel === 'aal2'`) but hasn't completed it yet (`currentLevel === 'aal1'`),
 * AND the current path isn't AAL-exempt.
 */
export function shouldChallengeMfa(pathname: string, aal: AalState): boolean {
  if (aal.currentLevel === 'aal1' && aal.nextLevel === 'aal2' && !isAalExempt(pathname)) {
    return true
  }
  return false
}

/**
 * Decide whether an authenticated request should be redirected to /auth/enroll-mfa
 * to set up a factor. Returns true when the user has no factor enrolled yet
 * AND isn't a demo account AND the current path isn't AAL-exempt.
 */
export function shouldEnrollMfa(
  pathname: string,
  aal: AalState,
  opts: { isDemoUser: boolean },
): boolean {
  if (
    aal.currentLevel === 'aal1' &&
    aal.nextLevel === 'aal1' &&
    !isAalExempt(pathname) &&
    !opts.isDemoUser
  ) {
    return true
  }
  return false
}
