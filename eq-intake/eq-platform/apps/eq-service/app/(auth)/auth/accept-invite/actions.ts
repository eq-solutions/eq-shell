/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential. All rights reserved.
 */
'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/actions/audit'

const AcceptInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email({ error: 'Enter a valid email address.' }),
  code: z.string().trim().min(6, { error: 'Enter the 8-digit code from your email.' }).max(10),
  full_name: z.string().trim().min(1, { error: 'Please enter your full name.' }).max(120),
  password: z.string().min(10, { error: 'Password must be at least 10 characters.' }),
  confirm: z.string(),
})

/**
 * Single-shot invite acceptance via OTP.
 *
 * Why OTP instead of a clickable link: Microsoft Defender Safe Links (and
 * other corporate email scanners) pre-fetch every URL in inbound mail to
 * scan it. When the URL contains a one-shot Supabase token, the scanner's
 * pre-fetch BURNS the token before the user can click it — the user then
 * sees "invite link expired or already used" and gets locked out.
 *
 * The fix is to take the token out of the URL entirely. The invite email
 * now carries an 8-digit code (`{{ .Token }}` in the Supabase template) that
 * the user TYPES on this page along with their name and password. Scanners
 * cannot type a code into a UI, so the token survives.
 *
 * Steps:
 *   1. Validate input (Zod).
 *   2. Verify the OTP via `verifyOtp({ type: 'invite' })` — this proves
 *      email ownership and establishes a session.
 *   3. C2 gate (carried over from the link flow): refuse if the user has
 *      no active `tenant_members` row anywhere — a removed user shouldn't
 *      regain access just because they still have the invite email.
 *   4. Admin set password (bypasses the AAL1/MFA restriction on
 *      updateUser({password}) — fine because step 2 already proved
 *      email ownership).
 *   5. Sync profile name (best-effort).
 *   6. Audit + redirect to /dashboard.
 */
export async function verifyInviteOtpAndSetupAction(formData: FormData) {
  const parsed = AcceptInviteSchema.safeParse({
    email: formData.get('email'),
    code: formData.get('code'),
    full_name: formData.get('full_name'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }
  const { email, code, full_name, password, confirm } = parsed.data

  if (password !== confirm) {
    return { error: 'Passwords do not match.' }
  }

  // --- 1. Verify the OTP — establishes a real session for `email` -----------
  const supabase = await createClient()
  const { data: verifyData, error: verifyErr } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: 'invite',
  })

  if (verifyErr || !verifyData.user) {
    return { error: friendlyOtpError(verifyErr?.message) }
  }

  const userId = verifyData.user.id
  const admin = createAdminClient()

  // --- 2. C2 gate: must have an active tenant_members row somewhere ---------
  const { data: activeMemberships, error: membershipErr } = await admin
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)

  if (membershipErr) {
    return { error: 'Could not verify your access. Please try again in a moment.' }
  }

  if (!activeMemberships || activeMemberships.length === 0) {
    await supabase.auth.signOut()
    try {
      await logAuditEvent({
        action: 'update',
        entityType: 'user',
        entityId: userId,
        summary: 'Blocked invite acceptance — user has no active tenant membership',
      })
    } catch {
      /* non-fatal */
    }
    return {
      error:
        'Your access to this organisation has been removed. Ask an administrator to re-attach your account before signing in.',
    }
  }

  // --- 3. Set the password --------------------------------------------------
  const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password })
  if (pwErr) {
    return { error: pwErr.message }
  }

  // --- 4. Sync the full name (best-effort) ---------------------------------
  const { error: profileErr } = await admin
    .from('profiles')
    .update({ full_name })
    .eq('id', userId)
  if (profileErr) {
    console.error('accept-invite: profile name update failed', profileErr.message)
  }

  await logAuditEvent({
    action: 'update',
    entityType: 'user',
    entityId: userId,
    summary: 'Accepted invitation and set initial password (OTP flow)',
  })

  redirect('/dashboard')
}

/**
 * Legacy entry point kept so any stale imports from before the OTP migration
 * still resolve. Routes through the new action under the hood.
 */
export const acceptInviteAction = verifyInviteOtpAndSetupAction

function friendlyOtpError(msg: string | undefined): string {
  if (!msg) return 'Could not verify the code. Please try again.'
  const m = msg.toLowerCase()
  if (m.includes('expired')) {
    return 'That code has expired. Ask your administrator to resend the invite.'
  }
  if (m.includes('invalid') || m.includes('not found')) {
    return 'That code is incorrect. Check your email and try again.'
  }
  return msg
}
