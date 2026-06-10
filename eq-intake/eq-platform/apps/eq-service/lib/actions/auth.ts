/**
 * Resolves the current user, their tenant ID, and role for server actions.
 * Throws if not authenticated or not a member of any tenant.
 *
 * NOT marked 'use server'. This is a server-side helper imported by server
 * actions (which themselves are 'use server'). Removing the directive
 * closes a footgun where every export in this file would otherwise be
 * registered as a public RPC endpoint via Next.js 16's server-action graph
 * — the supabase client return value made the response un-serialisable
 * which prevented exploitation, but that protection was an accident of
 * the return shape and one refactor away from being a working "tell me my
 * own auth state" public endpoint.
 *
 * Membership query is ordered by created_at ASC + tenant_id ASC so users
 * who belong to multiple tenants land in the same tenant on every login.
 * Without ordering, Postgres's `.limit(1)` returned a non-deterministic
 * row, which meant a multi-tenant user got a "lucky-dip" tenant per
 * session — silent correctness bug where data writes could land in the
 * wrong tenant under RLS-permitted but user-unintended access. The first
 * tenant they joined is a reasonable default; full tenant-switcher UI is
 * tracked in docs/30-day-plan.md (B1a follow-up).
 */

import { createClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/types'

export async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .order('tenant_id', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!membership) throw new Error('No tenant membership.')

  return {
    supabase,
    user,
    tenantId: membership.tenant_id as string,
    role: membership.role as Role,
  }
}
