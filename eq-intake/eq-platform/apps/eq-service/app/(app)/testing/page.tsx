import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TestRecordList } from './TestRecordList'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role, TestRecordReading, Attachment } from '@/lib/types'

const PER_PAGE = 25

export default async function TestingPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; site_id?: string; result?: string; page?: string; show_archived?: string; stay?: string }>
}) {
  const params = await searchParams

  // Default to summary page unless explicitly staying on general testing
  if (!params.stay) {
    redirect('/testing/summary')
  }

  const search = params.search ?? ''
  const siteId = params.site_id ?? ''
  const result = params.result ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const showArchived = params.show_archived === '1'

  const supabase = await createClient()

  // Current user + role
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

  // Sites for filter + form (include code + customer so dropdowns can
  // disambiguate duplicate site codes across customers)
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, code, customers(name)')
    .eq('is_active', true)
    .order('name')

  // Assets for form dropdown
  const { data: assets } = await supabase
    .from('assets')
    .select('id, name, asset_type, site_id')
    .eq('is_active', true)
    .order('name')

  // Tenant members for tested_by dropdown
  const { data: members } = await supabase
    .from('tenant_members')
    .select('user_id')
    .eq('is_active', true)

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

  // Build test records query
  let query = supabase
    .from('test_records')
    .select('*, assets(name, asset_type), sites(name)', { count: 'exact' })
    .order('test_date', { ascending: false })

  if (!showArchived) {
    query = query.eq('is_active', true)
  }

  if (siteId) {
    query = query.eq('site_id', siteId)
  }
  if (result) {
    query = query.eq('result', result)
  }

  const from = (page - 1) * PER_PAGE
  const to = from + PER_PAGE - 1
  query = query.range(from, to)

  const { data: recordsRaw, count } = await query
  const total = count ?? 0
  const totalPages = Math.ceil(total / PER_PAGE)

  // Resolve tested_by names
  const testerIds = [...new Set((recordsRaw ?? []).map((r) => r.tested_by).filter((id): id is string => Boolean(id)))]
  let testerMap: Record<string, string> = {}
  if (testerIds.length > 0) {
    const { data: testerProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', testerIds)
    for (const p of testerProfiles ?? []) {
      testerMap[p.id] = p.full_name ?? p.email
    }
  }

  const records = (recordsRaw ?? []).map((r) => ({
    ...r,
    tester_name: r.tested_by ? (testerMap[r.tested_by] ?? null) : null,
  }))

  // Filter by search (asset name, test type)
  const filteredRecords = search
    ? records.filter((r) => {
        const assetName = (r.assets as { name: string; asset_type: string } | null)?.name ?? ''
        const siteName = (r.sites as { name: string } | null)?.name ?? ''
        const q = search.toLowerCase()
        return (
          assetName.toLowerCase().includes(q) ||
          siteName.toLowerCase().includes(q) ||
          (r.test_type as string).toLowerCase().includes(q)
        )
      })
    : records

  // Fetch attachments + readings for visible records
  const recordIds = filteredRecords.map((r) => r.id)

  let attachmentsMap: Record<string, Attachment[]> = {}
  if (recordIds.length > 0) {
    const { data: allAttachments } = await supabase
      .from('attachments')
      .select('*')
      .eq('entity_type', 'test_record')
      .in('entity_id', recordIds)
      .order('created_at')
    attachmentsMap = (allAttachments ?? []).reduce((acc, att) => {
      const key = att.entity_id as string
      if (!acc[key]) acc[key] = []
      acc[key].push(att as Attachment)
      return acc
    }, {} as Record<string, Attachment[]>)
  }

  let readingsMap: Record<string, TestRecordReading[]> = {}
  if (recordIds.length > 0) {
    const { data: allReadings } = await supabase
      .from('test_record_readings')
      .select('*')
      .in('test_record_id', recordIds)
      .order('sort_order')

    readingsMap = (allReadings ?? []).reduce((acc, rdg) => {
      const key = rdg.test_record_id as string
      if (!acc[key]) acc[key] = []
      acc[key].push(rdg as TestRecordReading)
      return acc
    }, {} as Record<string, TestRecordReading[]>)
  }

  return (
    <div className="space-y-4">
      <TestRecordList
        records={filteredRecords as never}
        readingsMap={readingsMap}
        attachmentsMap={attachmentsMap}
        assets={(assets ?? []) as never}
        sites={sites ?? []}
        technicians={technicians}
        page={page}
        totalPages={totalPages}
        isAdmin={isAdmin(userRole)}
        canWrite={canWrite(userRole)}
      />
    </div>
  )
}
