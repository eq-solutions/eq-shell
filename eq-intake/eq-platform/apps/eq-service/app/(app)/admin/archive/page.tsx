import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { isAdmin } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'
import {
  ARCHIVE_ENTITY_TYPES,
  ARCHIVE_LABELS,
  TABLE_BY_ENTITY,
  countDependencies,
  daysUntilPurge,
  type ArchiveEntityType,
} from './helpers'
import { ArchiveTable, type ArchiveRow } from './ArchiveTable'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

// ------------------------------------------------------------
// Columns we need from every archivable table for display +
// dependency checks + countdown.
// ------------------------------------------------------------
const SELECT_COLS = 'id, name, is_active, deleted_at, created_at, updated_at'

export default async function AdminArchivePage({ searchParams }: PageProps) {
  const params = await searchParams
  const activeTab = (
    ARCHIVE_ENTITY_TYPES.includes(params.tab as ArchiveEntityType)
      ? (params.tab as ArchiveEntityType)
      : 'all'
  ) as ArchiveEntityType | 'all'

  const supabase = await createClient()

  // ----- auth / role -----
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('role, tenant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const userRole = (membership?.role as Role | undefined) ?? null
  if (!isAdmin(userRole)) redirect('/dashboard')

  // ----- grace period for this tenant -----
  const { data: settings } = await supabase
    .from('tenant_settings')
    .select('archive_grace_period_days')
    .eq('tenant_id', membership!.tenant_id)
    .maybeSingle()
  const graceDays = settings?.archive_grace_period_days ?? 30

  // ----- fetch inactive rows from all six tables in parallel -----
  // Dynamic-table dispatch via TABLE_BY_ENTITY — the typed client can't pick
  // a single row shape from the 53-table union (intersection = never), so
  // the chain is cast through `any`. See admin/archive/actions.ts for the
  // same pattern and the rationale.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dyn = supabase as any
  const queries = ARCHIVE_ENTITY_TYPES.map(async (entityType) => {
    const { data } = await dyn
      .from(TABLE_BY_ENTITY[entityType])
      .select(SELECT_COLS)
      .eq('is_active', false)
      .order('deleted_at', { ascending: false, nullsFirst: false })
      .range(0, 999)
    return { entityType, rows: data ?? [] }
  })

  const results = await Promise.all(queries)

  // ----- compute dependency counts for every row (parallel) -----
  // Batched in one big Promise.all to keep the page fast. If this
  // grows too big we'll move to a single grouped SQL view later.
  const allRows: ArchiveRow[] = []
  const depPromises: Promise<void>[] = []

  for (const { entityType, rows } of results) {
    for (const row of rows) {
      const r = row as {
        id: string
        name: string | null
        is_active: boolean
        deleted_at: string | null
        created_at: string
        updated_at: string
      }
      const archiveRow: ArchiveRow = {
        id: r.id,
        name: r.name ?? '(unnamed)',
        entity_type: entityType,
        entity_label: ARCHIVE_LABELS[entityType].singular,
        deleted_at: r.deleted_at,
        days_remaining: daysUntilPurge(r.deleted_at, graceDays),
        dependency_count: 0, // filled below
      }
      allRows.push(archiveRow)
      depPromises.push(
        countDependencies(supabase, entityType, r.id).then((n) => {
          archiveRow.dependency_count = n
        }),
      )
    }
  }

  await Promise.all(depPromises)

  // ----- filter to active tab -----
  const visibleRows = activeTab === 'all'
    ? allRows
    : allRows.filter((r) => r.entity_type === activeTab)

  // ----- counts for tab badges -----
  const tabCounts: Record<ArchiveEntityType | 'all', number> = {
    all: allRows.length,
    customer: 0,
    site: 0,
    asset: 0,
    job_plan: 0,
    maintenance_check: 0,
    testing_check: 0,
  }
  for (const r of allRows) tabCounts[r.entity_type]++

  // ----- how many are within 7 days of auto-purge -----
  const imminent = allRows.filter((r) => r.days_remaining !== null && r.days_remaining <= 7).length

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Admin', href: '/admin' },
          { label: 'Archive' },
        ]} />
        <div className="flex items-start justify-between mt-2 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-eq-ink">Archive</h1>
            <p className="text-sm text-eq-grey mt-1">
              Soft-deleted customers, sites, assets, maintenance plans, and checks.
              Restore anything inside the grace window, or delete permanently when you're confident.
            </p>
          </div>
          <Link
            href="/admin/archive/settings"
            className="text-xs font-semibold text-eq-deep hover:text-eq-sky transition-colors whitespace-nowrap pt-1"
          >
            Grace period: {graceDays} days · Change →
          </Link>
        </div>
      </div>

      {imminent > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">
            <span className="font-bold">{imminent}</span> {imminent === 1 ? 'item is' : 'items are'} within 7 days of auto-deletion.
            Restore now if you want to keep {imminent === 1 ? 'it' : 'them'}.
          </p>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
        <TabLink label="All" tab="all" count={tabCounts.all} active={activeTab === 'all'} />
        {ARCHIVE_ENTITY_TYPES.map((t) => (
          <TabLink
            key={t}
            label={ARCHIVE_LABELS[t].plural}
            tab={t}
            count={tabCounts[t]}
            active={activeTab === t}
          />
        ))}
      </div>

      {/* Table */}
      <ArchiveTable rows={visibleRows} graceDays={graceDays} />

      {visibleRows.length === 0 && (
        <Card className="text-center py-12">
          <p className="text-sm text-eq-grey">Nothing archived here yet.</p>
          <p className="text-xs text-eq-grey mt-1">When you deactivate a customer, site, asset, or check, it'll show up in this list.</p>
        </Card>
      )}
    </div>
  )
}

function TabLink({
  label,
  tab,
  count,
  active,
}: {
  label: string
  tab: ArchiveEntityType | 'all'
  count: number
  active: boolean
}) {
  return (
    <Link
      href={`/admin/archive?tab=${tab}`}
      className={
        'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ' +
        (active
          ? 'bg-eq-sky text-white'
          : 'bg-white text-eq-grey border border-gray-200 hover:bg-gray-50')
      }
    >
      {label}
      <span className={
        'ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ' +
        (active ? 'bg-white/20 text-white' : 'bg-gray-100 text-eq-grey')
      }>
        {count}
      </span>
    </Link>
  )
}
