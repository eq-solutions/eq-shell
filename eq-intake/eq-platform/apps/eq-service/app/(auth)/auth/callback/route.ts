/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential. All rights reserved.
 */
import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * Auth callback.
 *
 * As of 2026-04-26 the recovery + invite flows DO NOT route through here —
 * the email templates carry a typed 8-digit code (`{{ .Token }}`) that the
 * user enters on /auth/accept-invite or /auth/reset-password, and the URL
 * in the email points directly at those pages with NO token. This change
 * was forced by Microsoft Defender Safe Links (and equivalents on Mimecast,
 * Proofpoint, Google Workspace, etc.) which pre-fetch every URL in inbound
 * mail and burn one-shot tokens before the user can click them.
 *
 * This route is kept for two reasons:
 *
 *   1. PKCE code exchange for OAuth / social login flows that still come
 *      through with `?code=`.
 *   2. Backwards compatibility with stale invite / recovery emails that
 *      were sent BEFORE the migration and might still be sitting in someone's
 *      inbox. Those emails arrive here with `?token_hash=...&type=...`.
 *      We attempt the OTP exchange, but if it fails (Safe Links has burned
 *      the token), we fall through to a graceful redirect that prompts the
 *      user to request a fresh code instead of leaving them stuck on a
 *      generic error.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const rawType = url.searchParams.get('type')
  const next = url.searchParams.get('next') || '/dashboard'

  const supabase = await createClient()

  // --- Legacy token_hash flow (stale emails from before the OTP migration) --
  if (tokenHash && rawType) {
    const type = rawType as EmailOtpType
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin))
    }
    console.warn('[auth/callback] legacy verifyOtp failed (likely Safe Links burned the token):', error.message)

    // Steer the user back into the OTP flow instead of leaving them stranded.
    if (type === 'invite') {
      return NextResponse.redirect(
        new URL('/auth/accept-invite?error=link_expired', url.origin),
      )
    }
    if (type === 'recovery' || type === 'magiclink') {
      return NextResponse.redirect(
        new URL('/auth/forgot-password?error=link_expired', url.origin),
      )
    }
    return NextResponse.redirect(
      new URL(`/auth/signin?error=${encodeURIComponent(error.message)}`, url.origin),
    )
  }

  // --- PKCE code exchange (social login etc.) ------------------------------
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin))
    }
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message)
    return NextResponse.redirect(
      new URL(`/auth/signin?error=${encodeURIComponent(error.message)}`, url.origin),
    )
  }

  // --- Nothing to do — direct hit, send to signin ---------------------------
  return NextResponse.redirect(new URL('/auth/signin', url.origin))
}
