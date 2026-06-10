'use client'

import { useState } from 'react'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { CustomerForm } from './CustomerForm'
import { ImportCSVModal } from '@/components/ui/ImportCSVModal'
import type { ImportCSVConfig } from '@/components/ui/ImportCSVModal'
import { importCustomersAction } from './actions'
import type { Customer } from '@/lib/types'
import { BulkActionBar } from '@/components/ui/BulkActionBar'
import { bulkDeactivateAction, bulkDeleteAction } from '@/lib/actions/bulk'
import { cn } from '@/lib/utils/cn'
import { Upload } from 'lucide-react'
import { ExportButton } from '@/components/ui/ExportButton'
import { exportToCsv } from '@/lib/utils/csv-export'

interface CustomerListProps {
  customers: Customer[]
  page: number
  totalPages: number
  isAdmin: boolean
}

const customerImportConfig: ImportCSVConfig<{
  name: string
  code: string | null
  email: string | null
  phone: string | null
  address: string | null
}> = {
  entityName: 'Customers',
  requiredColumns: ['name'],
  optionalColumns: ['code', 'email', 'phone', 'address'],
  mapRow: (row, columnMap) => {
    const name = row[columnMap['name']]?.trim()
    if (!name) return null
    return {
      name,
      code: row[columnMap['code']]?.trim() || null,
      email: row[columnMap['email']]?.trim() || null,
      phone: row[columnMap['phone']]?.trim() || null,
      address: row[columnMap['address']]?.trim() || null,
    }
  },
  importAction: importCustomersAction,
}

export function CustomerList({ customers, page, totalPages, isAdmin }: CustomerListProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function openCreate() {
    setSelected(null)
    setPanelOpen(true)
  }

  function openEdit(customer: Customer) {
    setSelected(customer)
    setPanelOpen(true)
  }

  const columns: DataTableColumn<Customer & Record<string, unknown>>[] = [
    {
      key: 'name',
      header: 'Customer',
      // Plain content — the row click handler opens the edit slide panel.
      // Do not wrap in <a href> or <Link>, since row-level onRowClick races
      // with anchor navigation and the panel flashes open then disappears
      // as the browser follows the link.
      render: (row) => (
        <div className="flex items-center gap-3">
          {row.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.logo_url as string} alt="" className="w-8 h-8 rounded object-contain bg-gray-50 border border-gray-100 shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded bg-eq-ice flex items-center justify-center text-xs font-bold text-eq-deep shrink-0">
              {(row.name as string)?.charAt(0)?.toUpperCase()}
            </div>
          )}
          <span className="font-medium text-eq-sky">{row.name as string}</span>
        </div>
      ),
    },
    { key: 'email', header: 'Email' },
    { key: 'phone', header: 'Phone' },
    {
      key: 'is_active',
      header: 'Status',
      render: (row) => <StatusBadge status={row.is_active ? 'active' : 'inactive'} />,
    },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter placeholder="Search customers..." />
        <div className="flex items-center gap-2 ml-4 shrink-0">
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
          )}
          <ExportButton onClick={() => exportToCsv(
            customers,
            [
              { key: 'name', header: 'Name' },
              { key: 'is_active', header: 'Active', format: (r) => r.is_active ? 'Yes' : 'No' },
            ],
            `customers-export-${new Date().toISOString().slice(0, 10)}`
          )} />
          {isAdmin && (
            <Button size="sm" onClick={openCreate}>Add Customer</Button>
          )}
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No customers yet.</p>
          {isAdmin && (
            <Button size="sm" onClick={openCreate}>Create your first customer</Button>
          )}
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={customers.map((c) => ({
              ...c,
              className: cn(!c.is_active && 'opacity-50'),
            } as Customer & Record<string, unknown>))}
            emptyMessage="No customers match your search."
            selectable={isAdmin}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onRowClick={(row) => openEdit(row as unknown as Customer)}
          />
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}

      <CustomerForm
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setSelected(null) }}
        customer={selected}
        isAdmin={isAdmin}
      />

      <ImportCSVModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        config={customerImportConfig}
      />

      {isAdmin && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          entityName="Customers"
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
          onDeactivate={(ids) => bulkDeactivateAction('customers', ids)}
          onDelete={(ids) => bulkDeleteAction('customers', ids)}
        />
      )}
    </>
  )
}
