'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { logAuditEvent } from '@/lib/actions/audit'
import { requireUser } from '@/lib/actions/auth'
import { isAdmin } from '@/lib/utils/roles'
import { getSiteUrl } from '@/lib/utils/site-url'
import { zodToErrorMap } from '@/lib/utils/zodErrors'

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const VALID_ROLES = ['super_admin', 'admin', 'supervisor', 'technician', 'read_only'] as const
type AppRole = typeof VALID_ROLES[number]

const InviteSchema = z.object({
  email: z.string().email({ error: 'Invalid email address.' }).transform((s) => s.trim().toLowerCase()),
  role: z.enum(VALID_ROLES, { error: 'Invalid role.' }),
  full_name: z.string().trim().max(120).optional().nullable(),
})

/**
 * Requires the caller to be a super_admin or admin OF THE CURRENT TENANT.
 * Returns their supabase client, user, tenantId, role.
 *
 * Uses requireUser() so the tenant_id we operate on is always the tenant the
 * caller is a member of — never trusts client-provided tenant_id.
 */
async function requireTenantAdmin() {
  const ctx = await requireUser()
  if (!isAdmin(ctx.role)) {
    throw new Error('Not authorised.')
  }
  return ctx
}

/**
 * Translate raw Supabase auth admin errors into operator-friendly strings.
 * Keeps the UI informative without leaking internals.
 */
function friendlyAuthError(message: string | undefined): string {
  const m = (message || '').toLowerCase()
  if (!m) return 'Unknown error — please try again.'
  if (m.includes('user already registered') || m.includes('already been registered'))
    return 'That email is already registered. Use Resend to re-send the invite.'
  if (m.includes('email rate limit') || m.includes('rate limit'))
    return 'Supabase invite rate limit hit — wait a minute and try again.'
  if (m.includes('invalid email')) return 'That email address is invalid.'
  if (m.includes('database error saving new user'))
    return 'Signup trigger failed. Contact an administrator — the handle_new_user trigger may be broken.'
  return message || 'Unknown error — please try again.'
}

/**
 * Look up an auth user by email (admin client, bypasses RLS). Returns undefined
 * if not found. Uses listUsers filter — for our scale this is cheap.
 */
async function findAuthUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) return undefined
  return data.users.find((u) => u.email?.toLowerCase() === email)
}

/**
 * Ensure the profile row exists and reflects the chosen role + name.
 * Idempotent — safe to call even if the trigger already created the row.
 */
async function upsertProfile(
  admin: ReturnType<typeof createAdminClient>,
  args: { id: string; email: string; full_name: string | null; role: AppRole }
) {
  const { error } = await admin
    .from('profiles')
    .upsert(
      {
        id: args.id,
        email: args.email,
        full_name: args.full_name,
        role: args.role,
        is_active: true,
      },
      { onConflict: 'id' }
    )
  if (error) throw new Error(`profile upsert failed: ${error.message}`)
}

/**
 * Ensure an active tenant_members row exists for (tenantId, userId) with the
 * chosen role. Idempotent. Reactivates if previously soft-deleted.
 */
async function upsertTenantMembership(
  admin: ReturnType<typeof createAdminClient>,
  args: { tenant_id: string; user_id: string; role: AppRole }
) {
  const { error } = await admin
    .from('tenant_members')
    .upsert(
      { tenant_id: args.tenant_id, user_id: args.user_id, role: args.role, is_active: true },
      { onConflict: 'tenant_id,user_id' }
    )
  if (error) throw new Error(`tenant_members upsert failed: ${error.message}`)
}

/**
 * Best-effort audit entry for orphan recovery / first-time tenant assignment.
 * Fails silently — not load-bearing.
 */
async function recordOrphanAssignment(
  admin: ReturnType<typeof createAdminClient>,
  args: { user_id: string; tenant_id: string; role: AppRole; assigned_by: string; reason: string }
) {
  try {
    await admin.from('orphaned_user_assignments').insert({
      user_id: args.user_id,
      assigned_tenant_id: args.tenant_id,
      assigned_role: args.role,
      assigned_by: args.assigned_by,
      reason: args.reason,
    })
  } catch {
    /* non-fatal */
  }
}

// -----------------------------------------------------------------------------
// Public actions
// -----------------------------------------------------------------------------

/**
 * Invite a new user, or re-attach an existing one to this tenant.
 *
 * Contract:
 *   1. Validate input with Zod.
 *   2. Caller must be admin / super_admin of the current tenant.
 *   3. If email already exists in auth.users: skip the invite call, but
 *      STILL attach them to this tenant with the chosen role, and resend
 *      the invite link. (Admin keeps control, no orphan users.)
 *   4. If email is new: call inviteUserByEmail, then attach membership.
 *   5. Profile + tenant_members are upserted idempotently, so this is safe
 *      to re-run if a previous attempt partially succeeded.
 *   6. Friendly error messages on failure.
 */
export async function inviteUserAction(formData: FormData): Promise<{ ok: true; email: string } | { error: string; errors?: Record<string, string> }> {
  const parsed = InviteSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
    full_name: formData.get('full_name') || null,
  })
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      errors: zodToErrorMap(parsed.error.issues),
    }
  }
  const { email, role, full_name } = parsed.data

  let ctx
  try {
    ctx = await requireTenantAdmin()
  } catch (e) {
    return { error: (e as Error).message }
  }
  const { user: actor, tenantId } = ctx

  const admin = createAdminClient()
  const h = await headers()
  const requestOrigin = h.get('origin') ?? h.get('host') ?? null
  // Prefer NEXT_PUBLIC_SITE_URL / Netlify URL over the request header so
  // invites sent from a local dev build don't leak http://localhost:3000
  // into production emails. Request origin is the fallback, not the default.
  const origin = getSiteUrl(requestOrigin)
  // 2026-04-26 OTP migration: the invite email now carries a typed 8-digit
  // code, NOT a clickable token URL. The link in the email points at this
  // safe, tokenless URL so Defender Safe Links can pre-fetch it harmlessly.
  // The user types the code from the email body to verify ownership.
  const redirectTo = `${origin}/auth/accept-invite?email=${encodeURIComponent(email)}`

  try {
    // --- 1. Resolve the auth user (invite if new, look up if existing) --------
    let authUserId: string | undefined
    let wasCreated = false

    const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: full_name ?? '' },
    })

    if (inviteErr) {
      // Common case: user already exists. Fall back to lookup + resend.
      const existing = await findAuthUserByEmail(admin, email)
      if (!existing) {
        return { error: friendlyAuthError(inviteErr.message) }
      }
      authUserId = existing.id
    } else if (inviteData?.user) {
      authUserId = inviteData.user.id
      wasCreated = true
    } else {
      return { error: 'Supabase did not return a user record.' }
    }

    if (!authUserId) {
      return { error: 'Could not resolve user id after invite.' }
    }

    // --- 2. Profile (idempotent). Trigger normally creates it; this heals
    // any case where it didn't or the role/name need updating.
    await upsertProfile(admin, {
      id: authUserId,
      email,
      full_name: full_name || null,
      role,
    })

    // --- 3. Tenant membership (idempotent, reactivates if soft-deleted). ------
    await upsertTenantMembership(admin, {
      tenant_id: tenantId,
      user_id: authUserId,
      role,
    })

    await recordOrphanAssignment(admin, {
      user_id: authUserId,
      tenant_id: tenantId,
      role,
      assigned_by: actor.id,
      reason: wasCreated ? 'New invite' : 'Attached existing user to tenant via invite',
    })

    await logAuditEvent({
      action: 'create',
      entityType: 'user',
      entityId: authUserId,
      summary: `${wasCreated ? 'Invited' : 'Re-invited'} ${email} as ${role}`,
    })

    revalidatePath('/admin/users')
    return { ok: true, email }
  } catch (e) {
    return { error: friendlyAuthError((e as Error).message) }
  }
}

/**
 * Resend an invite link to an existing user. Safe to run repeatedly; does not
 * change role or tenant assignment. Useful when a user never clicked the first
 * email or the link expired.
 */
export async function resendInviteAction(formData: FormData) {
  const userId = String(formData.get('user_id') || '')
  if (!userId) return { error: 'Missing user.' }

  try {
    await requireTenantAdmin()
  } catch (e) {
    return { error: (e as Error).message }
  }

  const admin = createAdminClient()
  const h = await headers()
  const requestOrigin = h.get('origin') ?? h.get('host') ?? null
  const origin = getSiteUrl(requestOrigin)

  const { data: profile } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .maybeSingle()

  if (!profile?.email) return { error: 'User has no email on file.' }

  // Decide the destination based on the user's current state:
  //   - Confirmed (they've already set a password) → /auth/reset-password.
  //   - Not confirmed (pending invite, never clicked the first link) →
  //     /auth/accept-invite (welcome rail + password setup).
  //
  // We deliver via the PUBLIC /auth/v1/recover endpoint (resetPasswordForEmail)
  // — NOT admin.generateLink. Why:
  //   - admin.inviteUserByEmail 422s on email_exists for every resend.
  //   - admin.generateLink returns the action_link but does NOT trigger SMTP
  //     delivery; it's meant for custom email flows. Our test on 2026-04-20
  //     confirmed this: the admin call returned 200 and updated recovery_sent_at,
  //     but no email reached Resend.
  //   - /auth/v1/recover (public) hits the mailer and delivers via the project's
  //     configured SMTP (Resend, in our case). It's rate-limited to one request
  //     per email per 60s, which is fine for admin Resend clicks.
  // Trade-off: the email subject will be "Reset your password" for both
  // confirmed and not-yet-confirmed users. Acceptable for now; can iterate
  // with a custom Resend API call + our own template later if needed.
  const authUser = await findAuthUserByEmail(admin, profile.email)
  const isConfirmed = !!authUser?.email_confirmed_at
  // 2026-04-26 OTP migration: tokenless landing URL with email pre-filled.
  // The token itself is the 8-digit code in the email body, not in the URL.
  const nextPath = isConfirmed ? '/auth/reset-password' : '/auth/accept-invite'
  const redirectTo = `${origin}${nextPath}?email=${encodeURIComponent(profile.email)}`

  const publicClient = await createClient()
  const { error } = await publicClient.auth.resetPasswordForEmail(profile.email, {
    redirectTo,
  })
  if (error) return { error: friendlyAuthError(error.message) }

  await logAuditEvent({
    action: 'update',
    entityType: 'user',
    entityId: userId,
    summary: `Resent ${isConfirmed ? 'password reset' : 'invite'} to ${profile.email}`,
  })
  revalidatePath('/admin/users')
  return { ok: true }
}

/**
 * Attach a user (who may be orphaned or whose membership was soft-deleted) to
 * the current tenant with the given role. This is the manual "fix" path for
 * any user who shows up in profiles but is not a member of the current tenant.
 */
export async function repairUserTenantAction(formData: FormData) {
  const userId = String(formData.get('user_id') || '')
  const role = (String(formData.get('role') || 'technician') as AppRole)
  if (!userId) return { error: 'Missing user.' }
  if (!VALID_ROLES.includes(role)) return { error: 'Invalid role.' }

  let ctx
  try {
    ctx = await requireTenantAdmin()
  } catch (e) {
    return { error: (e as Error).message }
  }
  const { user: actor, tenantId } = ctx

  const admin = createAdminClient()

  try {
    await upsertTenantMembership(admin, { tenant_id: tenantId, user_id: userId, role })
    await recordOrphanAssignment(admin, {
      user_id: userId,
      tenant_id: tenantId,
      role,
      assigned_by: actor.id,
      reason: 'Repair: attached orphan to current tenant',
    })
    await logAuditEvent({
      action: 'update',
      entityType: 'user',
      entityId: userId,
      summary: `Repaired tenant membership as ${role}`,
    })
    revalidatePath('/admin/users')
    return { ok: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/**
 * Soft-deactivate or reactivate a user globally (profiles.is_active).
 * Keeps their tenant memberships intact — for tenant-scoped removal use
 * removeUserFromTenantAction.
 */
export async function setActiveAction(formData: FormData) {
  const userId = String(formData.get('user_id') || '')
  const isActive = String(formData.get('is_active') || 'true') === 'true'
  if (!userId) return { error: 'Missing user.' }

  let actorId: string
  try {
    const { user } = await requireTenantAdmin()
    actorId = user.id
  } catch (e) {
    return { error: (e as Error).message }
  }
  if (userId === actorId && !isActive) {
    return { error: 'You cannot deactivate yourself.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ is_active: isActive }).eq('id', userId)
  if (error) return { error: error.message }

  await logAuditEvent({
    action: isActive ? 'update' : 'delete',
    entityType: 'user',
    entityId: userId,
    summary: isActive ? 'Reactivated user' : 'Deactivated user',
  })
  revalidatePath('/admin/users')
  return { ok: true }
}

/**
 * Soft-remove a user from the CURRENT tenant (tenant_members.is_active = false).
 * Their auth account and other tenant memberships are unaffected — this is
 * reversible via inviteUserAction or repairUserTenantAction.
 */
export async function removeUserFromTenantAction(formData: FormData) {
  const userId = String(formData.get('user_id') || '')
  if (!userId) return { error: 'Missing user.' }

  let ctx
  try {
    ctx = await requireTenantAdmin()
  } catch (e) {
    return { error: (e as Error).message }
  }
  const { supabase, user: actor, tenantId } = ctx
  if (userId === actor.id) return { error: 'You cannot remove yourself.' }

  const admin = createAdminClient()

  const { data: target, error: fetchErr } = await admin
    .from('tenant_members')
    .select('id, is_active')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle()

  if (fetchErr) return { error: fetchErr.message }
  if (!target) return { error: 'User is not a member of this tenant.' }
  if (!target.is_active) return { error: 'User has already been removed from this tenant.' }

  const { error } = await admin
    .from('tenant_members')
    .update({ is_active: false })
    .eq('id', target.id)
  if (error) return { error: error.message }

  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle()

  await logAuditEvent({
    action: 'delete',
    entityType: 'user',
    entityId: userId,
    summary: `Removed user ${profile?.email ?? userId} from tenant`,
  })
  revalidatePath('/admin/users')
  return { ok: true }
}

/**
 * Change a user's role in BOTH profiles AND tenant_members for the current
 * tenant. Keeping them in sync avoids a class of bugs where the legacy global
 * profiles.role says one thing and the per-tenant role says another.
 */
export async function setRoleAction(formData: FormData) {
  const userId = String(formData.get('user_id') || '')
  const role = String(formData.get('role') || '') as AppRole
  if (!userId || !VALID_ROLES.includes(role)) {
    return { error: 'Invalid request.' }
  }

  let ctx
  try {
    ctx = await requireTenantAdmin()
  } catch (e) {
    return { error: (e as Error).message }
  }
  const { user: actor, tenantId } = ctx

  if (userId === actor.id && !isAdmin(role)) {
    return { error: 'You cannot demote yourself out of admin.' }
  }

  const admin = createAdminClient()
  const { error: pErr } = await admin.from('profiles').update({ role }).eq('id', userId)
  if (pErr) return { error: pErr.message }

  const { error: tErr } = await admin
    .from('tenant_members')
    .update({ role })
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    // Defensive: never mutate a soft-removed row. The UI already disables
    // the role dropdown for NO TENANT users, but the filter belongs server-side.
    .eq('is_active', true)
  if (tErr) return { error: tErr.message }

  await logAuditEvent({
    action: 'update',
    entityType: 'user',
    entityId: userId,
    summary: `Changed role to ${role}`,
  })
  revalidatePath('/admin/users')
  return { ok: true }
}

/**
 * PERMANENTLY delete a user.
 *
 * Reserved for super_admin only. This:
 *   1. Deletes the user from auth.users (Supabase Admin API).
 *   2. profiles + tenant_members + audit_log rows are preserved with the user
 *      reference intact — historical data isn't rewritten. Foreign keys to
 *      auth.users use ON DELETE SET NULL so display layers will show
 *      "Removed user" where appropriate.
 *
 * Use cases: test accounts, mistaken invitations, GDPR-style erasure requests.
 * For "this person left the team" use removeUserFromTenantAction (soft archive).
 *
 * Irreversible. UI must double-confirm before calling.
 */
export async function hardDeleteUserAction(formData: FormData) {
  const userId = String(formData.get('user_id') || '')
  if (!userId) return { error: 'Missing user.' }

  let ctx
  try {
    ctx = await requireTenantAdmin()
  } catch (e) {
    return { error: (e as Error).message }
  }
  const { user: actor, role: actorRole } = ctx

  // Super-admin gate. Even regular admins cannot trigger a hard delete —
  // archive is the right tool for the job 95% of the time.
  if (actorRole !== 'super_admin') {
    return { error: 'Only super_admin users can permanently delete accounts. Archive instead.' }
  }
  if (userId === actor.id) {
    return { error: 'You cannot permanently delete yourself.' }
  }

  const admin = createAdminClient()

  // Capture email/name for the audit summary BEFORE we delete the auth row.
  const { data: profile } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .maybeSingle()

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) return { error: error.message }

  await logAuditEvent({
    action: 'delete',
    entityType: 'user',
    entityId: userId,
    summary: `PERMANENTLY DELETED user ${profile?.email ?? userId} (${profile?.full_name ?? 'unknown name'})`,
  })

  revalidatePath('/admin/users')
  return { ok: true }
}
