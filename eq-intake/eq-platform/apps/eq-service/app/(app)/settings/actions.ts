'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/actions/auth'
import { logAuditEvent } from '@/lib/actions/audit'

export async function updateProfileAction(formData: FormData) {
  try {
    const { supabase, user } = await requireUser()

    const fullName = (formData.get('full_name') as string)?.trim() || null

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', user.id)

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'profile', entityId: user.id, summary: 'Updated profile name' })
    revalidatePath('/settings')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

export async function changePasswordAction(formData: FormData) {
  try {
    const { supabase } = await requireUser()

    const newPassword = formData.get('new_password') as string
    const confirmPassword = formData.get('confirm_password') as string

    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters.' }
    }
    if (newPassword !== confirmPassword) {
      return { success: false, error: 'Passwords do not match.' }
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({ action: 'update', entityType: 'profile', summary: 'Changed password' })
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Upsert the current user's notification preferences. Creates the row
 * if missing, updates it if present. The cascade in
 * get_effective_notification_prefs() means a missing row falls back to
 * the tenant default and then app default — so this action only writes
 * when the user has actually customised something.
 */
export async function updateNotificationPreferencesAction(formData: FormData) {
  try {
    const { supabase, tenantId, user } = await requireUser()

    const digestTime = (formData.get('digest_time') as string)?.trim() || '07:00'
    const digestDaysRaw = (formData.get('digest_days') as string)?.trim() || 'mon,tue,wed,thu,fri'
    const digestDays = digestDaysRaw.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
    const reminderRaw = (formData.get('pre_due_reminder_days') as string)?.trim() || '14,7,1'
    const preDueReminderDays = reminderRaw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n) && n >= 0 && n <= 365)
    const optOutsRaw = (formData.get('event_type_opt_outs') as string) ?? ''
    const eventTypeOptOuts = optOutsRaw.split(',').map(s => s.trim()).filter(Boolean)
    const bellEnabled = formData.get('bell_enabled') === 'true'
    const emailEnabled = formData.get('email_enabled') === 'true'
    const digestEnabled = formData.get('digest_enabled') === 'true'
    const timezone = (formData.get('timezone') as string)?.trim() || 'Australia/Sydney'

    // Validate the time and day list cheaply — Postgres would reject bad
    // values anyway, but we want a friendlier error.
    if (!/^\d{2}:\d{2}$/.test(digestTime)) {
      return { success: false, error: 'Digest time must be in HH:MM format.' }
    }
    const validDays = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
    for (const d of digestDays) {
      if (!validDays.has(d)) return { success: false, error: `Invalid day "${d}".` }
    }

    const { error } = await supabase
      .from('notification_preferences')
      .upsert({
        tenant_id: tenantId,
        user_id: user.id,
        digest_time: digestTime,
        digest_days: digestDays,
        pre_due_reminder_days: preDueReminderDays,
        event_type_opt_outs: eventTypeOptOuts,
        bell_enabled: bellEnabled,
        email_enabled: emailEnabled,
        digest_enabled: digestEnabled,
        timezone,
      }, { onConflict: 'tenant_id,user_id' })

    if (error) return { success: false, error: error.message }

    await logAuditEvent({
      action: 'update',
      entityType: 'notification_preferences',
      summary: 'Updated notification preferences',
      metadata: { digest_time: digestTime, digest_days: digestDays, pre_due_reminder_days: preDueReminderDays },
    })
    revalidatePath('/settings')
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
