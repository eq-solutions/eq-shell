/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { trackServer } from '@/lib/analytics-server'
import {
  PUBLIC_PATHS,
  MFA_PATHS,
  AAL_EXEMPT_PATHS,
  isPublicPath,
  isAalExempt,
} from '@/lib/auth/mfa-routing'

// Next.js 16 renamed `middleware.ts` → `proxy.ts` with a `proxy()` export.
// This file refreshes the Supabase session on every request, enforces
// authentication, MFA (AAL2), and admin-only routes.
//
// Path lists and pure routing helpers live in lib/auth/mfa-routing.ts so
// the AAL1 loop fix has a regression test (tests/lib/auth/mfa-routing.test.ts).

// Re-export so existing direct readers still resolve (keeps the call surface
// stable; new code should import from lib/auth/mfa-routing directly).
export { PUBLIC_PATHS, MFA_PATHS, AAL_EXEMPT_PATHS }

// MFA grace window — 14 days from first signin (`profiles.mfa_grace_started_at`).
// Exported so the banner component in (app)/layout.tsx can compute days-
// remaining off the same source of truth.
export const MFA_GRACE_DAYS = 14
const MFA_GRACE_MS = MFA_GRACE_DAYS * 24 * 60 * 60 * 1000

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const { response, supabase, user, aal } = await updateSession(request)

  const isPublic = isPublicPath(pathname)
  const isAalExemptPath = isAalExempt(pathname)
  // isMfaPath is exported for callers that need it, but not used in this
  // middleware body — the AAL exemption check covers the same routes.

  // Unauthenticated users -> /auth/signin (except for public routes).
  if (!user) {
    if (isPublic) return response
    const url = request.nextUrl.clone()
    url.pathname = '/auth/signin'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // Demo accounts bypass MFA entirely.
  const isDemoUser = user.email === 'demo@eqsolves.com.au'

  // Authenticated users on public auth pages -> dashboard.
  if (isPublic && (aal.currentLevel === 'aal2' || isDemoUser)) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // AAL enforcement:
  //   nextLevel === 'aal2' && currentLevel === 'aal1'  -> must challenge existing factor
  //   nextLevel === 'aal1' && currentLevel === 'aal1'  -> no factor enrolled yet
  if (aal.currentLevel === 'aal1' && aal.nextLevel === 'aal2' && !isAalExemptPath) {
    // Fire-and-forget observability: makes the MFA loop visible if it recurs.
    // Two of these within ~30s for the same user = suspected loop.
    trackServer(user.id, 'mfa_redirect', { from: pathname }).catch(() => {})
    const url = request.nextUrl.clone()
    url.pathname = '/auth/mfa'
    return NextResponse.redirect(url)
  }

  // Skip MFA enrollment for demo accounts (no factor enrolled yet).
  if (
    aal.currentLevel === 'aal1' &&
    aal.nextLevel === 'aal1' &&
    !isAalExemptPath &&
    !isDemoUser
  ) {
    // MFA grace window (PR J — UX audit §B.1 / §5.4, locked 2026-05-19).
    // Users without a factor enrolled get N=14 days from first signin
    // before the enroll-redirect kicks in. During grace, requests pass
    // through and a banner reminds the user (rendered by layout). After
    // grace, the redirect resumes its pre-PR-J behaviour.
    //
    // mfa_grace_started_at is stamped by migration 0103 — DEFAULT now()
    // on new profile inserts + backfilled on existing rows. So every
    // authenticated user has a non-null timestamp; treating null
    // defensively (no grace) maintains backward compat if the column
    // is missing.
    const { data: profile } = await supabase
      .from('profiles')
      .select('mfa_grace_started_at')
      .eq('id', user.id)
      .single()
    const graceStart = (profile as { mfa_grace_started_at?: string | null } | null)?.mfa_grace_started_at ?? null
    const inGrace =
      graceStart !== null &&
      Date.now() - new Date(graceStart).getTime() < MFA_GRACE_MS

    if (!inGrace) {
      const url = request.nextUrl.clone()
      url.pathname = '/auth/enroll-mfa'
      return NextResponse.redirect(url)
    }
    // else: within grace — let the request through. Banner renders in
    // (app)/layout.tsx.
  }

  // Admin-only routes — gated by the user's per-tenant role.
  // Pre-2026-04-30 this read `profiles.role`, which diverged from how
  // individual admin pages already gated themselves (they read
  // `tenant_members.role` via `isAdmin()`). Net effect was a privilege
  // model split (Issue #19 from the overnight battle-test): a user with
  // `profiles.role = super_admin` could reach /admin URLs but get
  // redirected at content-level by the per-page check. Aligned here so
  // both layers agree on the same canonical role source.
  // Profile-level deactivation is still checked by the block below for
  // ALL protected routes — no need to duplicate it here.
  if (pathname.startsWith('/admin')) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .in('role', ['super_admin', 'admin'])
      .limit(1)
      .maybeSingle()

    if (!membership) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
  }

  // Deactivated users are signed out on any protected route.
  if (!isPublic && !isAalExemptPath) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', user.id)
      .single()
    if (profile && profile.is_active === false) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = '/auth/signin'
      url.searchParams.set('error', 'deactivated')
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: [
    // Match all paths except Next internals and static assets.
    // PDF / DOCX are excluded so sample reports in /public/samples serve
    // straight from the CDN without a Supabase session round-trip (which
    // would otherwise bounce unauthenticated visitors back to /auth/signin).
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|pdf|docx)$).*)',
  ],
}
