'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { JobPlanForm } from './JobPlanForm'
import { ImportCSVModal } from '@/components/ui/ImportCSVModal'
import type { ImportCSVConfig } from '@/components/ui/ImportCSVModal'
import { importJobPlansAction } from './actions'
import type { JobPlan, JobPlanItem, Site, Customer } from '@/lib/types'
import { BulkActionBar } from '@/components/ui/BulkActionBar'
import { bulkDeactivateAction, bulkDeleteAction } from '@/lib/actions/bulk'
import { Upload, ListChecks } from 'lucide-react'
import Link from 'next/link'
import { ExportButton } from '@/components/ui/ExportButton'
import { exportToCsv } from '@/lib/utils/csv-export'
import { formatSiteLabel } from '@/lib/utils/format'
import { StarterTemplatesCta } from './StarterTemplatesCta'

interface JobPlanWithSite extends JobPlan {
  sites: { name: string } | null
  customers: { name: string } | null
  item_count?: number
}

type SiteOption = Pick<Site, 'id' | 'name'> & {
  code?: string | null
  customer_id?: string | null
  customers?: { name?: string | null } | { name?: string | null }[] | null
}

type CustomerOption = Pick<Customer, 'id' | 'name'>

interface JobPlanListProps {
  jobPlans: JobPlanWithSite[]
  sites: SiteOption[]
  customers: CustomerOption[]
  itemsMap: Record<string, JobPlanItem[]>
  page: number
  totalPages: number
  isAdmin: boolean
  canWrite: boolean
}

export function JobPlanList({ jobPlans, sites, customers, itemsMap, page, totalPages, isAdmin, canWrite: canWriteRole }: JobPlanListProps) {
  const searchParams = useSearchParams()
  const [panelOpen, setPanelOpen] = useState(false)
  const [selected, setSelected] = useState<JobPlanWithSite | null>(null)
  // Auto-open the import modal when the URL carries ?import=1 (UX audit
  // PR #149 §A.6 — SetupChecklist's "Import xlsx" secondary CTA links here).
  const [importOpen, setImportOpen] = useState(() => searchParams.get('import') === '1')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Smart-defaults follow-on: pre-fill Site on the Add Plan form when the
  // URL filters to a single site (PR D pattern, deferred from #162).
  const prefillSiteId = !selected ? (searchParams.get('site_id') || null) : null

  // Build site name→id lookup for CSV import
  const siteLookup: Record<string, string> = {}
  for (const s of sites) siteLookup[s.name.toLowerCase()] = s.id

  const jobPlanImportConfig: ImportCSVConfig<{
    name: string
    code: string | null
    type: string | null
    site_id: string
    description: string | null
  }> = {
    entityName: 'Maintenance Plans',
    requiredColumns: ['name'],
    optionalColumns: ['jp code', 'type', 'site', 'description'],
    mapRow: (row, columnMap) => {
      const name = row[columnMap['name']]?.trim()
      if (!name) return null
      const siteVal = row[columnMap['site']]?.toLowerCase() ?? ''
      return {
        name,
        code: row[columnMap['jp code']]?.trim() || null,
        type: row[columnMap['type']]?.trim() || null,
        site_id: siteLookup[siteVal] ?? '',
        description: row[columnMap['description']]?.trim() || null,
      }
    },
    importAction: importJobPlansAction,
  }

  function openCreate() {
    setSelected(null)
    setPanelOpen(true)
  }

  function openEdit(jp: JobPlanWithSite) {
    setSelected(jp)
    setPanelOpen(true)
  }

  type JPRow = JobPlanWithSite & Record<string, unknown>

  const columns: DataTableColumn<JPRow>[] = [
    {
      key: 'code',
      header: 'Job Code',
      render: (row) => (row as JobPlanWithSite).code ?? '—',
    },
    { key: 'name', header: 'Maintenance Plan' },
    {
      key: 'type',
      header: 'Name',
      render: (row) => (row as JobPlanWithSite).type ?? '—',
    },
    {
      key: 'scope',
      header: 'Scope',
      render: (row) => {
        const r = row as JobPlanWithSite
        if (r.sites?.name) return r.sites.name
        if (r.customers?.name) return `All ${r.customers.name} sites`
        return 'Global'
      },
    },
    {
      key: 'item_count',
      header: 'Tasks',
      render: (row) => String((row as JobPlanWithSite).item_count ?? 0),
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => <StatusBadge status={(row as JobPlanWithSite).is_active ? 'active' : 'inactive'} />,
    },
  ]

  const siteFilterOptions = sites.map((s) => ({ value: s.id, label: formatSiteLabel(s) }))
  const customerFilterOptions = customers.map((c) => ({ value: c.id, label: c.name }))

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter
          placeholder="Search maintenance plans..."
          filters={[
            { key: 'customer_id', label: 'All Customers', options: customerFilterOptions },
            { key: 'site_id', label: 'All Sites', options: siteFilterOptions },
          ]}
        />
        <div className="flex items-center gap-2 ml-4 shrink-0">
          <Link href="/job-plans/items">
            <Button variant="secondary" size="sm">
              <ListChecks className="w-4 h-4 mr-1" /> Items Register
            </Button>
          </Link>
          {canWriteRole && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
          )}
          <ExportButton onClick={() => exportToCsv(
            jobPlans.map(jp => ({
              ...jp,
              scope_label: jp.sites?.name
                ?? (jp.customers?.name ? `All ${jp.customers.name} sites` : 'Global'),
            })),
            [
              { key: 'code', header: 'Job Code' },
              { key: 'name', header: 'Maintenance Plan' },
              { key: 'type', header: 'Name' },
              { key: 'scope_label', header: 'Scope' },
              { key: 'item_count', header: 'Tasks' },
              { key: 'is_active', header: 'Active', format: (r) => r.is_active ? 'Yes' : 'No' },
            ],
            `job-plans-export-${new Date().toISOString().slice(0, 10)}`
          )} />
          {canWriteRole && (
            <Button size="sm" onClick={openCreate}>Add Maintenance Plan</Button>
          )}
        </div>
      </div>

      {jobPlans.length === 0 ? (
        <div className="space-y-4">
          {/* Hero starter-templates CTA — one-click seed of 5 starter plans
              (UX audit §A.4 / §3.3). Only renders for write-roles. */}
          {canWriteRole && <StarterTemplatesCta variant="hero" />}
          <div className="text-center py-10 border border-gray-200 rounded-lg bg-white">
            <p className="text-eq-grey text-sm mb-3">Or build a plan from scratch.</p>
            {canWriteRole && (
              <Button size="sm" onClick={openCreate}>Create a maintenance plan</Button>
            )}
          </div>
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={jobPlans.map((jp) => ({ ...jp, site_name: '' } as JPRow))}
            emptyMessage="No maintenance plans match your filters."
            selectable={canWriteRole}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onRowClick={(row) => openEdit(row as JobPlanWithSite)}
          />
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}

      <JobPlanForm
        prefillSiteId={prefillSiteId}
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setSelected(null) }}
        jobPlan={selected}
        items={selected ? (itemsMap[selected.id] ?? []) : []}
        sites={sites}
        isAdmin={isAdmin}
        canWrite={canWriteRole}
      />

      <ImportCSVModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        config={jobPlanImportConfig}
      />

      {canWriteRole && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          entityName="Maintenance Plans"
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
          onDeactivate={(ids) => bulkDeactivateAction('job_plans', ids)}
          onDelete={(ids) => bulkDeleteAction('job_plans', ids)}
        />
      )}
    </>
  )
}
