'use client'

import { useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { KindPill } from '@/components/ui/KindPill'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { CreateCheckForm } from './CreateCheckForm'
import { BatchCreateForm } from './BatchCreateForm'
import { formatDate, formatSiteLabel } from '@/lib/utils/format'
import type { MaintenanceCheck, MaintenanceCheckItem, CheckStatus, JobPlan, Site, Profile } from '@/lib/types'
import { BulkActionBar } from '@/components/ui/BulkActionBar'
import { bulkDeactivateAction, bulkDeleteAction } from '@/lib/actions/bulk'
import { List, MapPin } from 'lucide-react'
import { SiteGroupedView } from './SiteGroupedView'

type CheckRow = MaintenanceCheck & {
  job_plans?: { name: string } | null
  sites?: { name: string } | null
  assignee_name?: string | null
  item_count?: number
  completed_count?: number
} & Record<string, unknown>

interface ScopeItem {
  id: string
  customer_id: string
  site_id: string | null
  scope_item: string
  is_included: boolean
  notes: string | null
  financial_year: string
}

interface MaintenanceListProps {
  checks: CheckRow[]
  itemsMap: Record<string, MaintenanceCheckItem[]>
  jobPlans: (Pick<JobPlan, 'id' | 'name' | 'code'> & {
    site_id?: string | null
    customer_id?: string | null
  })[]
  sites: (Pick<Site, 'id' | 'name' | 'customer_id'> & {
    code?: string | null
    customers?: { name?: string | null } | { name?: string | null }[] | null
  })[]
  customers: { id: string; name: string }[]
  /**
   * Flat list of {site_id, job_plan_id} pairs from every active asset
   * that has a job_plan_id set. Used by the New Check form to filter
   * the Maintenance Plans list to plans actually attached to assets at
   * the selected site (Royce 2026-05-19).
   */
  siteAssetPlans: { site_id: string; job_plan_id: string }[]
  /**
   * Tenant members eligible for the assignee dropdown. Includes role +
   * is_active so the form can label + sort + (optionally) bucket
   * inactive members. Variable name kept as `technicians` for diff size
   * but represents every role.
   */
  technicians: {
    id: string
    email: string
    full_name: string | null
    role: string | null
    is_active: boolean
  }[]
  scopeItems: ScopeItem[]
  page: number
  totalPages: number
  isAdmin: boolean
  canWrite: boolean
  /** Mine/All view (UX audit PR #149 §2.4). Drives the toggle's selected state. */
  view: 'mine' | 'all'
}

function statusToBadge(status: CheckStatus) {
  const map: Record<CheckStatus, 'not-started' | 'in-progress' | 'complete' | 'cancelled' | 'overdue'> = {
    scheduled: 'not-started',
    in_progress: 'in-progress',
    complete: 'complete',
    cancelled: 'cancelled',
    overdue: 'overdue',
  }
  return map[status]
}

export function MaintenanceList({
  checks, itemsMap, jobPlans, sites, customers, siteAssetPlans, technicians, scopeItems,
  page, totalPages, isAdmin, canWrite: canWriteRole, view: assignedView,
}: MaintenanceListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [layoutView, setLayoutView] = useState<'table' | 'sites'>('sites')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Mine/All URL writer — preserves every other filter param, just flips
  // `view`. Used by the segmented control in the toolbar.
  const setAssignedView = (next: 'mine' | 'all') => {
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('view', next)
    // Reset pagination when switching scope — the page-1 link is right.
    sp.delete('page')
    router.push(`${pathname}?${sp.toString()}`)
  }

  const columns: DataTableColumn<CheckRow>[] = [
    {
      key: 'check_name',
      header: 'Check',
      render: (row) => (row as CheckRow).custom_name ?? row.job_plans?.name ?? '—',
    },
    {
      key: 'kind',
      header: 'Type',
      render: (row) => <KindPill kind={(row as { kind?: string | null }).kind ?? 'maintenance'} />,
    },
    {
      key: 'site_name',
      header: 'Site',
      render: (row) => (row as CheckRow).sites?.name ?? '—',
    },
    {
      key: 'frequency',
      header: 'Frequency',
      render: (row) => {
        const f = (row as CheckRow).frequency
        if (!f) return '—'
        return f.replace('_', '-').replace(/\b\w/g, (c: string) => c.toUpperCase())
      },
    },
    {
      key: 'due_date',
      header: 'Due Date',
      render: (row) => formatDate(row.due_date as string),
    },
    {
      key: 'assigned',
      header: 'Assigned',
      render: (row) => (row as CheckRow).assignee_name ?? 'Unassigned',
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (row) => {
        const r = row as CheckRow
        return `${r.completed_count ?? 0}/${r.item_count ?? 0}`
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={statusToBadge(row.status as CheckStatus)} />,
    },
  ]

  const siteFilterOptions = sites.map((s) => ({ value: s.id, label: formatSiteLabel(s) }))
  const statusFilterOptions = [
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'complete', label: 'Complete' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'cancelled', label: 'Cancelled' },
  ]
  const kindFilterOptions = [
    { value: 'maintenance', label: 'PPM' },
    { value: 'acb',         label: 'ACB Test' },
    { value: 'nsx',         label: 'NSX Test' },
    { value: 'rcd',         label: 'RCD Test' },
    { value: 'general',     label: 'General Test' },
  ]

  return (
    <>
      {/*
        Filter row sticks to the top of the scroll container on mobile
        so the tech doesn't lose their place when scrolling through a
        long list. Desktop layout unchanged. The `-mx-4 px-4` pulls the
        background bleed to the page edge so the sticky strip looks
        intentional rather than a floating chip.
      */}
      <div className="sticky top-0 z-30 bg-white -mx-4 px-4 py-2 mb-4 sm:py-0 sm:mb-4 sm:mx-0 sm:px-0 sm:static sm:bg-transparent flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-eq-line sm:border-b-0">
        <SearchFilter
          placeholder="Search checks..."
          filters={[
            { key: 'site_id', label: 'All Sites', options: siteFilterOptions },
            { key: 'kind', label: 'All Types', options: kindFilterOptions },
            { key: 'status', label: 'All Statuses', options: statusFilterOptions },
          ]}
        />
        <div className="flex gap-2 sm:ml-4 shrink-0">
          {/* Mine / All toggle (UX audit PR #149 §2.4) */}
          <div className="flex gap-1 bg-gray-100 rounded-md p-1 text-xs font-medium">
            <button
              onClick={() => setAssignedView('mine')}
              className={`px-3 py-1.5 rounded transition-colors ${
                assignedView === 'mine'
                  ? 'bg-white text-eq-sky shadow-sm'
                  : 'text-eq-grey hover:text-eq-deep'
              }`}
              title="Only checks assigned to me"
            >
              Mine
            </button>
            <button
              onClick={() => setAssignedView('all')}
              className={`px-3 py-1.5 rounded transition-colors ${
                assignedView === 'all'
                  ? 'bg-white text-eq-sky shadow-sm'
                  : 'text-eq-grey hover:text-eq-deep'
              }`}
              title="Every check in the tenant"
            >
              All
            </button>
          </div>

          {/* Layout toggle — site-first vs table */}
          <div className="flex gap-1 bg-gray-100 rounded-md p-1">
            <button
              onClick={() => setLayoutView('sites')}
              className={`p-2 rounded transition-colors ${
                layoutView === 'sites'
                  ? 'bg-white text-eq-sky shadow-sm'
                  : 'text-eq-grey hover:text-eq-deep'
              }`}
              title="Site view (kanban per site)"
            >
              <MapPin className="w-4 h-4" />
            </button>
            <button
              onClick={() => setLayoutView('table')}
              className={`p-2 rounded transition-colors ${
                layoutView === 'table'
                  ? 'bg-white text-eq-sky shadow-sm'
                  : 'text-eq-grey hover:text-eq-deep'
              }`}
              title="Table view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          {canWriteRole && (
            <>
              <Link href="/maintenance/import">
                <Button size="sm" variant="secondary">Import</Button>
              </Link>
              <Button size="sm" onClick={() => setCreateOpen(true)}>Create Check</Button>
            </>
          )}
        </div>
      </div>

      {checks.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No maintenance checks yet.</p>
          {canWriteRole && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>Create your first check</Button>
          )}
        </div>
      ) : (
        <>
          {layoutView === 'table' ? (
            <>
              <DataTable
                columns={columns}
                rows={checks}
                emptyMessage="No checks match your filters."
                selectable={canWriteRole}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                onRowClick={(row) => router.push(`/maintenance/${row.id}`)}
              />
              <Pagination page={page} totalPages={totalPages} />
            </>
          ) : (
            <SiteGroupedView
              checks={checks}
              itemsMap={itemsMap}
              sites={sites}
              onCheckClick={(c) => router.push(`/maintenance/${c.id}`)}
              isAdmin={isAdmin}
            />
          )}
        </>
      )}

      <CreateCheckForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        jobPlans={jobPlans}
        sites={sites}
        customers={customers}
        siteAssetPlans={siteAssetPlans}
        technicians={technicians}
        scopeItems={scopeItems}
      />

      <BatchCreateForm
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        jobPlans={jobPlans}
        sites={sites}
        technicians={technicians}
      />

      {canWriteRole && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          entityName="Checks"
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
          onDeactivate={(ids) => bulkDeactivateAction('maintenance_checks', ids)}
          onDelete={(ids) => bulkDeleteAction('maintenance_checks', ids)}
        />
      )}
    </>
  )
}
