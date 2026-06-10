'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { SiteForm } from './SiteForm'
import { ImportCSVModal } from '@/components/ui/ImportCSVModal'
import type { ImportCSVConfig } from '@/components/ui/ImportCSVModal'
import { importSitesAction } from './actions'
import type { Site, Customer } from '@/lib/types'
import { BulkActionBar } from '@/components/ui/BulkActionBar'
import { bulkDeactivateAction, bulkDeleteAction } from '@/lib/actions/bulk'
import { Upload } from 'lucide-react'
import Link from 'next/link'
import { ExportButton } from '@/components/ui/ExportButton'
import { exportToCsv } from '@/lib/utils/csv-export'

interface SiteWithCustomer extends Site {
  customers: { name: string; logo_url: string | null } | null
  asset_count?: number
}

interface SiteListProps {
  sites: SiteWithCustomer[]
  customers: Pick<Customer, 'id' | 'name'>[]
  page: number
  totalPages: number
  isAdmin: boolean
}

export function SiteList({ sites, customers, page, totalPages, isAdmin }: SiteListProps) {
  const searchParams = useSearchParams()
  // Auto-open the create panel when the URL carries ?new=1 — used by the
  // customer detail page's "Add Site" CTA (UX audit PR #149 §A.4 / §2.9).
  // The detail page passes ?customer_id=X&new=1 — customer_id flows through
  // to the form's prefill (smart-defaults framework, PR D, see below) and
  // new=1 opens the panel directly without an intermediate click.
  const [panelOpen, setPanelOpen] = useState(() => searchParams.get('new') === '1')
  const [selected, setSelected] = useState<SiteWithCustomer | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Smart-defaults framework (UX audit PR #149 §A.5 / §2.8): when the
  // list is filtered to a single customer via the URL, pre-fill that
  // customer on the Add Site form. Selected is checked to avoid leaking
  // the prefill into an edit-an-existing-site flow.
  const prefillCustomerId = !selected ? (searchParams.get('customer_id') || null) : null

  const siteImportConfig: ImportCSVConfig<{
    name: string
    code: string | null
    customer_name: string | null
    address: string | null
    city: string | null
    state: string | null
    postcode: string | null
    country: string | null
  }> = {
    entityName: 'Sites',
    requiredColumns: ['name'],
    optionalColumns: ['code', 'customer', 'address', 'city', 'state', 'postcode', 'country'],
    // No blocking validation — server action auto-creates missing customers
    mapRow: (row, columnMap) => {
      const name = row[columnMap['name']]?.trim()
      if (!name) return null
      return {
        name,
        code: row[columnMap['code']]?.trim() || null,
        customer_name: row[columnMap['customer']]?.trim() || null,
        address: row[columnMap['address']]?.trim() || null,
        city: row[columnMap['city']]?.trim() || null,
        state: row[columnMap['state']]?.trim() || null,
        postcode: row[columnMap['postcode']]?.trim() || null,
        country: row[columnMap['country']]?.trim() || null,
      }
    },
    importAction: importSitesAction,
  }

  function openCreate() {
    setSelected(null)
    setPanelOpen(true)
  }

  function openEdit(site: SiteWithCustomer) {
    setSelected(site)
    setPanelOpen(true)
  }

  type SiteRow = SiteWithCustomer & Record<string, unknown>

  const columns: DataTableColumn<SiteRow>[] = [
    {
      key: 'name',
      header: 'Name',
      // Plain text — the row click handler opens the edit slide panel.
      // Do not wrap in <Link>, since row-level onRowClick races with Link
      // navigation and the panel flashes open then disappears as the
      // router pushes to /sites/{id}.
      render: (row) => (
        <span className="text-eq-sky font-medium">{(row as SiteWithCustomer).name}</span>
      ),
    },
    {
      key: 'customer_name',
      header: 'Customer',
      render: (row) => {
        const site = row as SiteWithCustomer
        if (!site.customers) return '—'
        return (
          <div className="flex items-center gap-2">
            {site.customers.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.customers.logo_url} alt="" className="w-6 h-6 rounded object-contain bg-gray-50 border border-gray-100 shrink-0" />
            ) : (
              <div className="w-6 h-6 rounded bg-eq-ice flex items-center justify-center text-[10px] font-bold text-eq-deep shrink-0">
                {site.customers.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span>{site.customers.name}</span>
          </div>
        )
      },
    },
    {
      key: 'address',
      header: 'Address',
      render: (row) => {
        const site = row as SiteWithCustomer
        const address = site.address?.trim()
        if (address) {
          return <span title={address}>{address.length > 40 ? `${address.substring(0, 40)}…` : address}</span>
        }
        const fallback = [site.city, site.state].filter(Boolean).join(', ')
        if (fallback) return fallback
        return '—'
      },
    },
    { key: 'city', header: 'City' },
    { key: 'state', header: 'State' },
    {
      key: 'asset_count',
      header: 'Assets',
      render: (row) => {
        const site = row as SiteWithCustomer
        const count = site.asset_count ?? 0
        return count > 0 ? (
          <Link
            href={`/assets?site_id=${site.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-eq-sky hover:text-eq-deep transition-colors font-medium"
          >
            {count}
          </Link>
        ) : (
          <span className="text-eq-grey">0</span>
        )
      },
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => <StatusBadge status={(row as SiteWithCustomer).is_active ? 'active' : 'inactive'} />,
    },
  ]

  const customerFilterOptions = customers.map((c) => ({ value: c.id, label: c.name }))

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter
          placeholder="Search sites..."
          filters={[{ key: 'customer_id', label: 'All Customers', options: customerFilterOptions }]}
        />
        <div className="flex items-center gap-2 ml-4 shrink-0">
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
          )}
          <ExportButton onClick={() => exportToCsv(
            sites.map(s => ({ ...s, customer_name: s.customers?.name ?? '' })),
            [
              { key: 'name', header: 'Name' },
              { key: 'code', header: 'Code' },
              { key: 'customer_name', header: 'Customer' },
              { key: 'address', header: 'Address' },
              { key: 'city', header: 'City' },
              { key: 'state', header: 'State' },
              { key: 'postcode', header: 'Postcode' },
              { key: 'asset_count', header: 'Assets' },
              { key: 'is_active', header: 'Active', format: (r) => r.is_active ? 'Yes' : 'No' },
            ],
            `sites-export-${new Date().toISOString().slice(0, 10)}`
          )} />
          {isAdmin && (
            <Button size="sm" onClick={openCreate}>Add Site</Button>
          )}
        </div>
      </div>

      {sites.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No sites yet.</p>
          {isAdmin && (
            <Button size="sm" onClick={openCreate}>Create your first site</Button>
          )}
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={sites.map((s) => ({ ...s, customer_name: '' } as SiteRow))}
            emptyMessage="No sites match your filters."
            selectable={isAdmin}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onRowClick={(row) => openEdit(row as SiteWithCustomer)}
          />
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}

      <SiteForm
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setSelected(null) }}
        site={selected}
        customers={customers}
        isAdmin={isAdmin}
        prefillCustomerId={prefillCustomerId}
      />

      <ImportCSVModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        config={siteImportConfig}
      />

      {isAdmin && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          entityName="Sites"
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
          onDeactivate={(ids) => bulkDeactivateAction('sites', ids)}
          onDelete={(ids) => bulkDeleteAction('sites', ids)}
        />
      )}
    </>
  )
}
