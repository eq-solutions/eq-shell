import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { AuditLogList } from './AuditLogList'
import { isAdmin } from '@/lib/utils/roles'
import type { Role, AuditLog } from '@/lib/types'

const PER_PAGE = 50

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ entity_type?: string; action?: string; page?: string }>
}) {
  const params = await searchParams
  const entityTypeFilter = params.entity_type ?? ''
  const actionFilter = params.action ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))

  const supabase = await createClient()

  // Auth + role check
  const { data: { user } } = await supabase.auth.getUser()
  let userRole: Role | null = null
  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    userRole = (membership?.role as Role) ?? null
  }

  // Only admins can view audit logs
  if (!isAdmin(userRole)) {
    return (
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Audit Log' }]} />
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm">You do not have permission to view the audit log.</p>
        </div>
      </div>
    )
  }

  // Build query
  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (entityTypeFilter) query = query.eq('entity_type', entityTypeFilter)
  if (actionFilter) query = query.eq('action', actionFilter)

  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1
  query = query.range(from, to)

  const { data: logsRaw, count } = await query
  const total = count ?? 0
  const totalPages = Math.ceil(total / PER_PAGE)

  // Resolve user names
  const userIds = [...new Set((logsRaw ?? []).map((l) => l.user_id).filter((id): id is string => Boolean(id)))]
  const userMap: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      userMap[p.id] = p.full_name ?? p.email
    }
  }

  const logs = (logsRaw ?? []).map((l) => ({
    ...(l as AuditLog),
    user_name: l.user_id ? (userMap[l.user_id] ?? 'Unknown') : 'System',
  }))

  // Get distinct entity types for filter
  const { data: entityTypes } = await supabase
    .from('audit_logs')
    .select('entity_type')
    .limit(100)

  const uniqueEntityTypes = [...new Set((entityTypes ?? []).map((e) => e.entity_type as string))].sort()

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Audit Log' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Audit Log</h1>
      </div>
      <AuditLogList
        logs={logs}
        entityTypes={uniqueEntityTypes}
        page={page}
        totalPages={totalPages}
      />
    </div>
  )
}
