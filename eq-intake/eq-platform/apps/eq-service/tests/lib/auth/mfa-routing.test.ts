import { describe, it, expect } from 'vitest'
import {
  AAL_EXEMPT_PATHS,
  PUBLIC_PATHS,
  isAalExempt,
  isPublicPath,
  isMfaPath,
  shouldChallengeMfa,
  shouldEnrollMfa,
} from '@/lib/auth/mfa-routing'

describe('MFA routing — regression tests for the AAL1 loop bug', () => {
  // The MFA AAL1 loop bug was: a user with an enrolled TOTP factor whose
  // session was AAL1 but nextLevel=aal2 got bounced to /auth/mfa. If they
  // tried to navigate to /auth/signin to sign out and start fresh, the
  // middleware redirected them back to /auth/mfa, forever.
  //
  // Fix: add /auth/signin to AAL_EXEMPT_PATHS so the user can always reach
  // signin even from a half-completed AAL1 session. If anyone drops it,
  // these tests fail.

  describe('AAL_EXEMPT_PATHS — load-bearing list', () => {
    it('includes /auth/signin (regression: AAL1 loop fix 2026-04-26)', () => {
      expect(AAL_EXEMPT_PATHS).toContain('/auth/signin')
    })

    it('includes /auth/signout', () => {
      expect(AAL_EXEMPT_PATHS).toContain('/auth/signout')
    })

    it('includes /auth/mfa (the challenge page itself)', () => {
      expect(AAL_EXEMPT_PATHS).toContain('/auth/mfa')
    })

    it('includes /auth/enroll-mfa', () => {
      expect(AAL_EXEMPT_PATHS).toContain('/auth/enroll-mfa')
    })

    it('includes /auth/reset-password', () => {
      expect(AAL_EXEMPT_PATHS).toContain('/auth/reset-password')
    })
  })

  describe('PUBLIC_PATHS — customer portal entry points', () => {
    // Without these, the customer portal magic-link flow is unreachable —
    // /portal/login redirects to /auth/signin (the staff form), and
    // /api/portal/magic-link POSTs get 307'd before reaching the handler.
    // Battle-test 2026-05-13 finding (P1).

    it('includes /portal/login so customers can reach the magic-link form', () => {
      expect(PUBLIC_PATHS).toContain('/portal/login')
      expect(isPublicPath('/portal/login')).toBe(true)
    })

    it('includes /api/portal/magic-link so the magic-link POST is not gated', () => {
      expect(PUBLIC_PATHS).toContain('/api/portal/magic-link')
      expect(isPublicPath('/api/portal/magic-link')).toBe(true)
    })

    it('does NOT treat other /portal/* routes as public — they require a session', () => {
      expect(isPublicPath('/portal/sites')).toBe(false)
      expect(isPublicPath('/portal/visits')).toBe(false)
      expect(isPublicPath('/portal')).toBe(false)
    })
  })

  describe('PUBLIC_PATHS — cron / scheduled endpoints', () => {
    // pg_cron calls these server-to-server with no Supabase session.
    // If they're not public the proxy 307s to /auth/signin and pg_net
    // follows the redirect — the dispatcher then receives the signin
    // page HTML instead of running. Each handler still enforces its own
    // `Authorization: Bearer ${CRON_SECRET}` check, so proxy-public is
    // safe. 2026-05-13 bootstrap discovery.

    it('includes /api/cron/dispatch-notifications', () => {
      expect(PUBLIC_PATHS).toContain('/api/cron/dispatch-notifications')
      expect(isPublicPath('/api/cron/dispatch-notifications')).toBe(true)
    })

    it('includes /api/cron/supervisor-digest', () => {
      expect(PUBLIC_PATHS).toContain('/api/cron/supervisor-digest')
      expect(isPublicPath('/api/cron/supervisor-digest')).toBe(true)
    })

    it('does NOT treat unrelated /api/* routes as public', () => {
      expect(isPublicPath('/api/notifications')).toBe(false)
      expect(isPublicPath('/api/maintenance-checklist')).toBe(false)
    })
  })

  describe('PUBLIC_PATHS — customer unsubscribe (AU Spam Act s18)', () => {
    // Unsubscribe must be functional and not require auth. The signed
    // token in ?token=... is the auth check.

    it('includes /portal/unsubscribe', () => {
      expect(PUBLIC_PATHS).toContain('/portal/unsubscribe')
      expect(isPublicPath('/portal/unsubscribe')).toBe(true)
    })

    it('treats /portal/unsubscribe?token=foo as public (matcher is prefix-based)', () => {
      expect(isPublicPath('/portal/unsubscribe?token=anything')).toBe(true)
    })
  })

  describe('PUBLIC_PATHS — invite acceptance landing (2026-05-14)', () => {
    // The invited user is unauthenticated when they click the link in
    // their welcome email — they're about to set their password via
    // the 8-digit OTP form. Without this entry the proxy bounces them
    // to /auth/signin and they have to go through "Forgot password"
    // instead of the proper welcome rail.

    it('includes /auth/accept-invite so invitees can reach the OTP form', () => {
      expect(PUBLIC_PATHS).toContain('/auth/accept-invite')
      expect(isPublicPath('/auth/accept-invite')).toBe(true)
    })

    it('treats /auth/accept-invite?email=foo@bar.com as public (matcher is prefix-based)', () => {
      expect(isPublicPath('/auth/accept-invite?email=foo%40bar.com')).toBe(true)
    })
  })

  describe('isAalExempt', () => {
    it('treats /auth/signin as AAL-exempt (the regression case)', () => {
      expect(isAalExempt('/auth/signin')).toBe(true)
    })

    it('treats /auth/signin?next=/dashboard as AAL-exempt', () => {
      expect(isAalExempt('/auth/signin?next=/dashboard')).toBe(true)
    })

    it('treats /dashboard as NOT AAL-exempt', () => {
      expect(isAalExempt('/dashboard')).toBe(false)
    })

    it('treats /maintenance/123 as NOT AAL-exempt', () => {
      expect(isAalExempt('/maintenance/123')).toBe(false)
    })
  })

  describe('shouldChallengeMfa — the actual loop trigger', () => {
    it('does NOT redirect to /auth/mfa from /auth/signin even when AAL1+nextLevel=aal2 (regression)', () => {
      // This is the exact condition that caused the loop:
      //   User has enrolled TOTP, session is AAL1, nextLevel=aal2,
      //   user navigates to /auth/signin to sign out.
      //   Pre-fix: middleware redirected them to /auth/mfa (loop).
      //   Post-fix: signin is exempt, no redirect.
      const result = shouldChallengeMfa('/auth/signin', {
        currentLevel: 'aal1',
        nextLevel: 'aal2',
      })
      expect(result).toBe(false)
    })

    it('does NOT redirect to /auth/mfa from /auth/mfa itself (would be infinite)', () => {
      const result = shouldChallengeMfa('/auth/mfa', {
        currentLevel: 'aal1',
        nextLevel: 'aal2',
      })
      expect(result).toBe(false)
    })

    it('redirects to /auth/mfa from a protected route when AAL1+nextLevel=aal2', () => {
      const result = shouldChallengeMfa('/dashboard', {
        currentLevel: 'aal1',
        nextLevel: 'aal2',
      })
      expect(result).toBe(true)
    })

    it('does not redirect when already AAL2', () => {
      const result = shouldChallengeMfa('/dashboard', {
        currentLevel: 'aal2',
        nextLevel: 'aal2',
      })
      expect(result).toBe(false)
    })

    it('does not redirect when no factor enrolled (nextLevel=aal1)', () => {
      const result = shouldChallengeMfa('/dashboard', {
        currentLevel: 'aal1',
        nextLevel: 'aal1',
      })
      expect(result).toBe(false)
    })
  })

  describe('shouldEnrollMfa', () => {
    it('redirects to enroll for non-demo users with no factor on protected routes', () => {
      const result = shouldEnrollMfa('/dashboard', {
        currentLevel: 'aal1',
        nextLevel: 'aal1',
      }, { isDemoUser: false })
      expect(result).toBe(true)
    })

    it('does NOT redirect demo accounts to enroll-mfa', () => {
      const result = shouldEnrollMfa('/dashboard', {
        currentLevel: 'aal1',
        nextLevel: 'aal1',
      }, { isDemoUser: true })
      expect(result).toBe(false)
    })

    it('does NOT redirect from /auth/signin to enroll-mfa', () => {
      const result = shouldEnrollMfa('/auth/signin', {
        currentLevel: 'aal1',
        nextLevel: 'aal1',
      }, { isDemoUser: false })
      expect(result).toBe(false)
    })
  })

  describe('isPublicPath / isMfaPath — basic sanity', () => {
    it('isPublicPath("/auth/signin") = true', () => {
      expect(isPublicPath('/auth/signin')).toBe(true)
    })

    it('isPublicPath("/dashboard") = false', () => {
      expect(isPublicPath('/dashboard')).toBe(false)
    })

    it('isMfaPath("/auth/mfa") = true', () => {
      expect(isMfaPath('/auth/mfa')).toBe(true)
    })

    it('isMfaPath("/auth/signin") = false', () => {
      expect(isMfaPath('/auth/signin')).toBe(false)
    })
  })
})
