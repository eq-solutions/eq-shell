import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { UsersTable } from './UsersTable'
import { InviteUserForm } from './InviteUserForm'
import { requireUser } from '@/lib/actions/auth'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

/**
 * Admin → Users.
 *
 * Lists users who have a `tenant_members` row for the acting admin's current
 * tenant. By default, soft-removed users are HIDDEN — toggle "Show archived"
 * to bring them back into view (where you can re-attach them or, as super_admin,
 * permanently delete them).
 *
 * Until 2026-04-21 this page listed every profile in the database, which
 * meant an SKS admin could see Demo / Equinix / Webb users they had no
 * business knowing about — a tenant-isolation breach in the UI even though
 * RLS still prevented data access. C1 fix: query tenant_members first, then
 * fetch profiles only for those user_ids.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ show_archived?: string }>
}) {
  const params = await searchParams
  const showArchived = params.show_archived === '1'

  const admin = createAdminClient()
  const supabase = await createClient()

  // Establish the acting user's tenant + role — every query below is scoped to this.
  const { tenantId, role: callerRole } = await requireUser()

  const { data: { user: currentUser } } = await supabase.auth.getUser()

  // 1. Memberships for THIS tenant only. By default, only ACTIVE members.
  //    Toggle showArchived to include soft-removed members so the admin can
  //    re-attach (any admin) or permanently delete (super_admin only) them.
  let membershipQuery = admin
    .from('tenant_members')
    .select('user_id, role, is_active')
    .eq('tenant_id', tenantId)

  if (!showArchived) {
    membershipQuery = membershipQuery.eq('is_active', true)
  }

  const { data: memberships } = await membershipQuery

  const memberIds = (memberships ?? []).map((m) => m.user_id as string)

  // 2. Profiles for just those users. If memberIds is empty (brand new
  //    tenant) we skip the round-trip entirely.
  const profilesRes = memberIds.length
    ? await admin
        .from('profiles')
        .select('id, email, full_name, role, is_active, last_login_at, created_at')
        .in('id', memberIds)
        .order('created_at', { ascending: false })
    : { data: [] as Array<{
        id: string; email: string; full_name: string | null; role: string;
        is_active: boolean; last_login_at: string | null; created_at: string;
      }> }

  // Stitch per-tenant role + per-tenant active state onto the profile row.
  const membershipByUser = new Map<string, { role: string; is_active: boolean }>()
  for (const m of memberships ?? []) {
    membershipByUser.set(m.user_id as string, {
      role: m.role as string,
      is_active: m.is_active as boolean,
    })
  }

  const rows = (profilesRes.data ?? []).map((p) => {
    const tm = membershipByUser.get(p.id)
    return {
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      // Per-tenant role wins over legacy global profiles.role for display.
      role: tm?.role ?? p.role,
      // Account-level disable (signs them out everywhere).
      is_active: p.is_active,
      // Tenant-level removal (soft-deleted membership in this tenant only).
      is_active_in_tenant: tm?.is_active ?? false,
      last_login_at: p.last_login_at,
      created_at: p.created_at,
      has_tenant_membership: !!tm?.is_active,
    }
  })

  // Count of archived members so the toggle can show "(3)" badge — admin
  // doesn't need to click to discover whether any exist.
  const { count: archivedCount } = await admin
    .from('tenant_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('is_active', false)

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-eq-ink">Users</h1>
          <p className="text-sm text-eq-grey mt-1">
            Invite, archive, and manage roles. <strong className="font-semibold">Archive</strong> removes them from this workspace only — you can add them back later. <strong className="font-semibold">Disable account</strong> stops them signing in anywhere. <strong className="font-semibold">Delete permanently</strong> (top-level admins only) wipes their login — their name still shows on past records.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={showArchived ? '/admin/users' : '/admin/users?show_archived=1'}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-medium text-eq-ink"
          >
            <span className={`w-2 h-2 rounded-full ${showArchived ? 'bg-amber-500' : 'bg-gray-300'}`} />
            {showArchived ? 'Hide archived' : 'Show archived'}
            {!!archivedCount && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-semibold">
                {archivedCount}
              </span>
            )}
          </Link>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-4">Invite new user</h2>
        <InviteUserForm />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <UsersTable
          users={rows}
          currentUserId={currentUser?.id ?? ''}
          callerRole={callerRole ?? 'admin'}
          showArchived={showArchived}
        />
      </div>
    </div>
  )
}
