import { createClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/types'

/**
 * Resolves the current user, their tenant membership, and role.
 * Returns null values if not authenticated or not a member of any tenant.
 */
export async function getApiUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, tenantId: null, role: null }

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  return {
    supabase,
    user,
    tenantId: (membership?.tenant_id as string) ?? null,
    role: (membership?.role as Role) ?? null,
  }
}

const ADMIN_ROLES: Role[] = ['super_admin', 'admin']
const WRITE_ROLES: Role[] = ['super_admin', 'admin', 'supervisor']

export function isAdmin(role: Role | null): boolean {
  return role !== null && ADMIN_ROLES.includes(role)
}

export function canWrite(role: Role | null): boolean {
  return role !== null && WRITE_ROLES.includes(role)
}

export function isSuperAdmin(role: Role | null): boolean {
  return role === 'super_admin'
}
