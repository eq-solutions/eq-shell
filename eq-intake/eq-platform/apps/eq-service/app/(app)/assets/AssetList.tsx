'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { AssetForm } from './AssetForm'
import { ImportAssetsModal } from './ImportAssetsModal'
import type { Asset, Site, JobPlan, Customer } from '@/lib/types'
import { BulkActionBar } from '@/components/ui/BulkActionBar'
import { bulkDeactivateAction, bulkDeleteAction } from '@/lib/actions/bulk'
import { cn } from '@/lib/utils/cn'
import { Upload, TableProperties, LayoutList } from 'lucide-react'
import { AssetGroupedView } from './AssetGroupedView'
import { ExportButton } from '@/components/ui/ExportButton'
import { exportToCsv } from '@/lib/utils/csv-export'
import { formatSiteLabel } from '@/lib/utils/format'

interface AssetWithSite extends Asset {
  sites: { name: string } | null
  job_plans: { name: string; code: string | null } | null
}

type SiteOption = Pick<Site, 'id' | 'name'> & {
  code?: string | null
  customer_id?: string | null
  customers?: { name?: string | null } | { name?: string | null }[] | null
}

type CustomerOption = Pick<Customer, 'id' | 'name'>

interface AssetListProps {
  assets: AssetWithSite[]
  allAssets: AssetWithSite[]
  sites: SiteOption[]
  customers: CustomerOption[]
  assetTypes: string[]
  allJobPlans: Pick<JobPlan, 'id' | 'name' | 'code' | 'type'>[]
  page: number
  totalPages: number
  total: number
  perPage: number
  isAdmin: boolean
  canWrite: boolean
}

export function AssetList({ assets, allAssets, sites, customers, assetTypes, allJobPlans, page, totalPages, total, perPage, isAdmin, canWrite: canWriteRole }: AssetListProps) {
  const searchParams = useSearchParams()
  // Auto-open the create panel on ?new=1 (UX audit PR #149 §A.4 / §2.9).
  // The site detail page's "Add Asset" CTA passes ?site_id=X&new=1 — site_id
  // flows through to the form's prefill (smart-defaults framework, see below).
  const [panelOpen, setPanelOpen] = useState(() => searchParams.get('new') === '1')
  const [selected, setSelected] = useState<AssetWithSite | null>(null)
  // Auto-open the import modal when the URL carries ?import=1 — used by
  // the SetupChecklist secondary CTAs (UX audit PR #149 §A.6). Previously
  // the param was dead — the user landed on the list with a query string
  // and had to hunt for the Import button.
  const [importOpen, setImportOpen] = useState(() => searchParams.get('import') === '1')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'table' | 'grouped'>('grouped')
  // Smart-defaults: pre-fill Site on the Add Asset form when the URL
  // filters to a single site (UX audit PR #149 §A.5 / §2.8).
  const prefillSiteId = !selected ? (searchParams.get('site_id') || null) : null

  function openCreate() {
    setSelected(null)
    setPanelOpen(true)
  }

  function openDetail(asset: AssetWithSite) {
    setSelected(asset)
    setPanelOpen(true)
  }

  type AssetRow = AssetWithSite & Record<string, unknown>

  // Build filter options from the FULL lists, not just current-page rows.
  // The DataTable's auto-derive only sees `rows` (paginated to ~25), so
  // without explicit filterOptions the column dropdowns hide most values.
  const siteNameFilterOptions = sites.map((s) => ({ value: s.name, label: s.name }))
  const jobPlanNameFilterOptions = allJobPlans.map((jp) => ({ value: jp.name, label: jp.name }))
  const assetTypeFilterOptions = assetTypes.map((t) => ({ value: t, label: t }))

  const columns: DataTableColumn<AssetRow>[] = [
    { key: 'maximo_id', header: 'Maximo ID', filterable: 'text' },
    { key: 'name', header: 'Name', filterable: 'text' },
    {
      key: 'site_name',
      header: 'Site',
      filterable: 'select',
      filterOptions: siteNameFilterOptions,
    },
    { key: 'location', header: 'Location', filterable: 'text' },
    {
      key: 'asset_type',
      header: 'Type',
      filterable: 'select',
      filterOptions: assetTypeFilterOptions,
    },
    {
      key: 'job_plan_name',
      header: 'Maintenance Plan',
      filterable: 'select',
      filterOptions: jobPlanNameFilterOptions,
    },
    {
      key: 'status_label',
      header: 'Status',
      filterable: 'select',
      filterOptions: [
        { value: 'Active', label: 'Active' },
        { value: 'Inactive', label: 'Inactive' },
      ],
      render: (row) => <StatusBadge status={(row as AssetWithSite).is_active ? 'active' : 'inactive'} />,
    },
  ]

  const siteFilterOptions = sites.map((s) => ({ value: s.id, label: formatSiteLabel(s) }))
  const jobPlanFilterOptions = allJobPlans.map((jp) => ({ value: jp.id, label: `${jp.name}${jp.type ? ` - ${jp.type}` : ''}` }))

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter
          placeholder="Search assets..."
          filters={[
            { key: 'customer_id', label: 'All Customers', options: customers.map((c) => ({ value: c.id, label: c.name })) },
            { key: 'site_id', label: 'All Sites', options: siteFilterOptions },
            { key: 'job_plan_id', label: 'All Maintenance Plans', options: jobPlanFilterOptions },
          ]}
        />
        <div className="flex items-center gap-2 ml-4 shrink-0">
          <div className="flex items-center border border-gray-200 rounded-md overflow-hidden mr-1">
            <button
              onClick={() => setViewMode('table')}
              className={cn(
                'p-1.5 transition-colors',
                viewMode === 'table' ? 'bg-eq-sky text-white' : 'bg-white text-eq-grey hover:bg-gray-50'
              )}
              title="Table view"
            >
              <TableProperties className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              className={cn(
                'p-1.5 transition-colors',
                viewMode === 'grouped' ? 'bg-eq-sky text-white' : 'bg-white text-eq-grey hover:bg-gray-50'
              )}
              title="Grouped view"
            >
              <LayoutList className="w-4 h-4" />
            </button>
          </div>
          {canWriteRole && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
          )}
          <ExportButton onClick={() => exportToCsv(
            allAssets.map(a => ({ ...a, site_name: a.sites?.name ?? '', job_plan_name: a.job_plans?.name ?? '' })),
            [
              { key: 'maximo_id', header: 'Maximo ID' },
              { key: 'name', header: 'Name' },
              { key: 'site_name', header: 'Site' },
              { key: 'location', header: 'Location' },
              { key: 'asset_type', header: 'Type' },
              { key: 'job_plan_name', header: 'Maintenance Plan' },
              { key: 'manufacturer', header: 'Manufacturer' },
              { key: 'model', header: 'Model' },
              { key: 'serial_number', header: 'Serial Number' },
              { key: 'is_active', header: 'Active', format: (r) => r.is_active ? 'Yes' : 'No' },
            ],
            `assets-export-${new Date().toISOString().slice(0, 10)}`
          )} />
          {canWriteRole && (
            <Button size="sm" onClick={openCreate}>Add Asset</Button>
          )}
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No assets yet.</p>
          {canWriteRole && (
            <Button size="sm" onClick={openCreate}>Create your first asset</Button>
          )}
        </div>
      ) : (
        <>
          {viewMode === 'table' ? (
            <>
              <DataTable
                columns={columns}
                rows={assets.map((a) => ({
                  ...a,
                  site_name: a.sites?.name ?? '',
                  job_plan_name: a.job_plans?.name ?? '',
                  status_label: a.is_active ? 'Active' : 'Inactive',
                } as AssetRow))}
                emptyMessage="No assets match your filters."
                selectable={canWriteRole}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                onRowClick={(row) => openDetail(row as AssetWithSite)}
              />
              <Pagination page={page} totalPages={totalPages} total={total} perPage={perPage} />
            </>
          ) : (
            <AssetGroupedView assets={allAssets} onAssetClick={openDetail} canWrite={canWriteRole} />
          )}
        </>
      )}

      <AssetForm
        prefillSiteId={prefillSiteId}
        assetTypes={assetTypes}
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setSelected(null) }}
        asset={selected}
        sites={sites}
        jobPlans={allJobPlans}
        isAdmin={isAdmin}
        canWrite={canWriteRole}
      />

      <ImportAssetsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        sites={sites}
      />

      {canWriteRole && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          entityName="Assets"
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
          onDeactivate={(ids) => bulkDeactivateAction('assets', ids)}
          onDelete={(ids) => bulkDeleteAction('assets', ids)}
        />
      )}
    </>
  )
}
