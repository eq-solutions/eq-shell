import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { InstrumentList } from './InstrumentList'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role, Instrument } from '@/lib/types'

const PER_PAGE = 25

export default async function InstrumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; instrument_type?: string; page?: string; show_archived?: string }>
}) {
  const params = await searchParams
  const search = params.search ?? ''
  const statusFilter = params.status ?? ''
  const typeFilter = params.instrument_type ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const showArchived = params.show_archived === '1'

  const supabase = await createClient()

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

  // Members for assigned_to dropdown
  const { data: members } = await supabase.from('tenant_members').select('user_id').eq('is_active', true)
  const memberIds = (members ?? []).map((m) => m.user_id)
  let technicians: { id: string; email: string; full_name: string | null }[] = []
  if (memberIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', memberIds)
      .eq('is_active', true)
      .order('full_name')
    technicians = (profiles ?? []) as typeof technicians
  }

  let query = supabase
    .from('instruments')
    .select('*', { count: 'exact' })
    .order('name')

  if (!showArchived) {
    query = query.eq('is_active', true)
  }

  if (statusFilter) query = query.eq('status', statusFilter)
  if (typeFilter) query = query.eq('instrument_type', typeFilter)

  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1
  query = query.range(from, to)

  const { data: instrumentsRaw, count } = await query
  const total = count ?? 0
  const totalPages = Math.ceil(total / PER_PAGE)

  // Resolve assigned_to names
  const assigneeIds = [...new Set((instrumentsRaw ?? []).map((i) => i.assigned_to).filter((id): id is string => Boolean(id)))]
  const assigneeMap: Record<string, string> = {}
  if (assigneeIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name, email').in('id', assigneeIds)
    for (const p of profiles ?? []) {
      assigneeMap[p.id] = p.full_name ?? p.email
    }
  }

  const instruments = (instrumentsRaw ?? []).map((i) => ({
    ...(i as Instrument),
    assignee_name: i.assigned_to ? (assigneeMap[i.assigned_to] ?? null) : null,
  }))

  // Search filter client-side
  const filtered = search
    ? instruments.filter((i) => {
        const q = search.toLowerCase()
        return (
          i.name.toLowerCase().includes(q) ||
          (i.make ?? '').toLowerCase().includes(q) ||
          (i.model ?? '').toLowerCase().includes(q) ||
          (i.serial_number ?? '').toLowerCase().includes(q) ||
          i.instrument_type.toLowerCase().includes(q)
        )
      })
    : instruments

  // Get distinct types for filter
  const { data: typesRaw } = await supabase.from('instruments').select('instrument_type').eq('is_active', true).limit(200)
  const uniqueTypes = [...new Set((typesRaw ?? []).map((t) => t.instrument_type as string))].sort()

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Instruments' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Instrument Register</h1>
      </div>
      <InstrumentList
        instruments={filtered as never}
        instrumentTypes={uniqueTypes}
        technicians={technicians}
        page={page}
        totalPages={totalPages}
        isAdmin={isAdmin(userRole)}
        canWrite={canWrite(userRole)}
      />
    </div>
  )
}
