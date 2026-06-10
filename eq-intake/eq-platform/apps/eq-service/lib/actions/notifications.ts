'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireUser } from '@/lib/actions/auth'

interface CreateNotificationParams {
  tenantId: string
  userId: string
  type: 'check_assigned' | 'check_overdue' | 'check_completed' | 'defect_raised'
  title: string
  body?: string
  entityType?: string
  entityId?: string
}

/**
 * Create a notification. Can be called from server actions.
 * Uses admin client to bypass RLS for system-generated notifications.
 */
export async function createNotification({
  tenantId,
  userId,
  type,
  title,
  body,
  entityType,
  entityId,
}: CreateNotificationParams) {
  try {
    const admin = createAdminClient()

    const { error } = await admin
      .from('notifications')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        type,
        title,
        body,
        entity_type: entityType,
        entity_id: entityId,
      })

    if (error) {
      console.error('Failed to create notification:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (e: unknown) {
    console.error('Error creating notification:', e)
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Mark a single notification as read.
 */
export async function markAsRead(notificationId: string) {
  try {
    const { supabase } = await requireUser()

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)

    if (error) return { success: false, error: error.message }

    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Mark all notifications as read for the current user.
 */
export async function markAllRead() {
  try {
    const { supabase, user } = await requireUser()

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false)

    if (error) return { success: false, error: error.message }

    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Get unread notification count for the current user.
 */
export async function getUnreadCount(): Promise<{ count: number; error?: string }> {
  try {
    const { supabase, user } = await requireUser()

    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)

    if (error) {
      console.error('Failed to get unread count:', error)
      return { count: 0, error: error.message }
    }

    return { count: count ?? 0 }
  } catch (e: unknown) {
    console.error('Error getting unread count:', e)
    return { count: 0, error: (e as Error).message }
  }
}
