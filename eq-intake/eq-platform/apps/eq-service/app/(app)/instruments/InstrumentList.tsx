'use client'

import { useState } from 'react'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { InstrumentForm } from './InstrumentForm'
import { InstrumentDetail } from './InstrumentDetail'
import { ImportCSVModal } from '@/components/ui/ImportCSVModal'
import type { ImportCSVConfig } from '@/components/ui/ImportCSVModal'
import { importInstrumentsAction } from './actions'
import { formatDate } from '@/lib/utils/format'
import type { Instrument, InstrumentStatus, Profile } from '@/lib/types'
import { BulkActionBar } from '@/components/ui/BulkActionBar'
import { bulkDeactivateAction, bulkDeleteAction } from '@/lib/actions/bulk'
import { Upload } from 'lucide-react'

type InstrumentRow = Instrument & { assignee_name?: string | null } & Record<string, unknown>

interface InstrumentListProps {
  instruments: InstrumentRow[]
  instrumentTypes: string[]
  technicians: Pick<Profile, 'id' | 'email' | 'full_name'>[]
  page: number
  totalPages: number
  isAdmin: boolean
  canWrite: boolean
}

function statusToBadge(status: InstrumentStatus): 'active' | 'inactive' | 'not-started' | 'blocked' {
  const map: Record<InstrumentStatus, 'active' | 'inactive' | 'not-started' | 'blocked'> = {
    Active: 'active',
    'Out for Cal': 'not-started',
    Retired: 'inactive',
    Lost: 'blocked',
  }
  return map[status]
}

export function InstrumentList({
  instruments, instrumentTypes, technicians, page, totalPages, isAdmin, canWrite: canWriteRole,
}: InstrumentListProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editInst, setEditInst] = useState<InstrumentRow | null>(null)
  const [detailInst, setDetailInst] = useState<InstrumentRow | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const instrumentImportConfig: ImportCSVConfig<{
    name: string
    instrument_type: string
    make: string | null
    model: string | null
    serial_number: string | null
    asset_tag: string | null
    calibration_date: string | null
    calibration_due: string | null
    calibration_cert: string | null
    status: string | null
    notes: string | null
  }> = {
    entityName: 'Instruments',
    requiredColumns: ['name', 'instrument_type'],
    optionalColumns: ['make', 'model', 'serial_number', 'asset_tag', 'calibration_date', 'calibration_due', 'calibration_cert', 'status', 'notes'],
    mapRow: (row, columnMap) => {
      const name = row[columnMap['name']]?.trim()
      const instrument_type = row[columnMap['instrument_type']]?.trim()
      if (!name || !instrument_type) return null
      return {
        name,
        instrument_type,
        make: row[columnMap['make']]?.trim() || null,
        model: row[columnMap['model']]?.trim() || null,
        serial_number: row[columnMap['serial_number']]?.trim() || null,
        asset_tag: row[columnMap['asset_tag']]?.trim() || null,
        calibration_date: row[columnMap['calibration_date']]?.trim() || null,
        calibration_due: row[columnMap['calibration_due']]?.trim() || null,
        calibration_cert: row[columnMap['calibration_cert']]?.trim() || null,
        status: row[columnMap['status']]?.trim() || null,
        notes: row[columnMap['notes']]?.trim() || null,
      }
    },
    importAction: importInstrumentsAction,
  }

  const columns: DataTableColumn<InstrumentRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span className="font-medium text-eq-ink">{row.name}</span>,
    },
    {
      key: 'instrument_type',
      header: 'Type',
      render: (row) => row.instrument_type,
    },
    {
      key: 'make_model',
      header: 'Make / Model',
      render: (row) => {
        const parts = [row.make, row.model].filter(Boolean)
        return parts.length > 0 ? parts.join(' — ') : '—'
      },
    },
    {
      key: 'serial_number',
      header: 'Serial',
      render: (row) => row.serial_number ?? '—',
    },
    {
      key: 'calibration_due',
      header: 'Cal Due',
      render: (row) => {
        if (!row.calibration_due) return '—'
        const due = new Date(row.calibration_due)
        const isOverdue = due < new Date()
        return (
          <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
            {formatDate(row.calibration_due)}
          </span>
        )
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={statusToBadge(row.status)} label={row.status} />,
    },
  ]

  const statusOptions = [
    { value: 'Active', label: 'Active' },
    { value: 'Out for Cal', label: 'Out for Cal' },
    { value: 'Retired', label: 'Retired' },
    { value: 'Lost', label: 'Lost' },
  ]
  const typeOptions = instrumentTypes.map((t) => ({ value: t, label: t }))

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter
          placeholder="Search instruments..."
          filters={[
            { key: 'status', label: 'All Statuses', options: statusOptions },
            { key: 'instrument_type', label: 'All Types', options: typeOptions },
          ]}
        />
        <div className="flex items-center gap-2 ml-4 shrink-0">
          {canWriteRole && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
          )}
          {canWriteRole && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>Add Instrument</Button>
          )}
        </div>
      </div>

      {instruments.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No instruments registered yet.</p>
          {canWriteRole && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>Add your first instrument</Button>
          )}
        </div>
      ) : (
        <>
          <DataTable columns={columns} rows={instruments.map((i) => ({ ...i, make_model: '' }))} emptyMessage="No instruments match your filters." selectable={canWriteRole} selectedIds={selectedIds} onSelectionChange={setSelectedIds} onRowClick={(row) => setDetailInst(row)} />
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}

      <InstrumentForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        technicians={technicians}
      />

      {editInst && (
        <InstrumentForm
          open={!!editInst}
          onClose={() => setEditInst(null)}
          instrument={editInst}
          technicians={technicians}
        />
      )}

      {detailInst && (
        <InstrumentDetail
          open={!!detailInst}
          onClose={() => setDetailInst(null)}
          instrument={detailInst}
          isAdmin={isAdmin}
          canWrite={canWriteRole}
          onEdit={() => { setEditInst(detailInst); setDetailInst(null) }}
        />
      )}

      <ImportCSVModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        config={instrumentImportConfig}
      />

      {canWriteRole && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          entityName="Instruments"
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
          onDeactivate={(ids) => bulkDeactivateAction('instruments', ids)}
          onDelete={(ids) => bulkDeleteAction('instruments', ids)}
        />
      )}
    </>
  )
}
