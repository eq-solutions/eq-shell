/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential. All rights reserved.
 */
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * STEP 1 — request a recovery code by email.
 *
 * Defender Safe Links / Mimecast / Proofpoint pre-fetch every URL in inbound
 * mail, which used to burn our one-shot recovery token before the user could
 * click it. To survive that, we no longer rely on a clickable token URL —
 * the recovery email now carries a 8-digit OTP code (`{{ .Token }}` template)
 * that the user TYPES on the next screen. Scanners can't type a code into
 * a UI, so the token survives.
 *
 * `resetPasswordForEmail` still triggers the "Reset Password" template; the
 * template itself is what determines whether the email contains a link or
 * a typed code. We deliberately drop `redirectTo` here because there's no
 * link to redirect anywhere — the code-entry page is reached via the safe,
 * tokenless URL the user navigates to manually.
 */
export async function forgotPasswordAction(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  if (!email) return { error: 'Email is required.' }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email)

  if (error) return { error: error.message }
  return { ok: true, email }
}

/**
 * STEP 2 — verify the OTP code and set a new password in one shot.
 *
 * `verifyOtp({ type: 'recovery' })` exchanges the 8-digit code for a real
 * recovery session. We then immediately update the password via the
 * service-role admin API (same reason as the legacy reset-password action:
 * AAL1 sessions can't `updateUser({password})` when MFA is enrolled).
 *
 * On success we sign the user out so the next sign-in enforces a fresh MFA
 * challenge, and surface a flag the UI uses to redirect to /auth/signin.
 */
export async function verifyRecoveryOtpAction(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const code = String(formData.get('code') || '').trim()
  const password = String(formData.get('password') || '')
  const confirm = String(formData.get('confirm') || '')

  if (!email) return { error: 'Email is required.' }
  if (!code || code.length < 6) return { error: 'Enter the 8-digit code from your email.' }
  if (password.length < 10) return { error: 'Password must be at least 10 characters.' }
  if (password !== confirm) return { error: 'Passwords do not match.' }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: 'recovery',
  })

  if (error || !data.user) {
    return { error: friendlyOtpError(error?.message) }
  }

  const admin = createAdminClient()
  const { error: pwErr } = await admin.auth.admin.updateUserById(data.user.id, { password })
  if (pwErr) return { error: pwErr.message }

  // Tear down the recovery session so the next sign-in challenges MFA cleanly.
  await supabase.auth.signOut()

  return { ok: true as const }
}

function friendlyOtpError(msg: string | undefined): string {
  if (!msg) return 'Could not verify the code. Please try again.'
  const m = msg.toLowerCase()
  if (m.includes('expired')) {
    return 'That code has expired. Request a new one from the previous step.'
  }
  if (m.includes('invalid') || m.includes('not found')) {
    return 'That code is incorrect. Check your email and try again.'
  }
  return msg
}
