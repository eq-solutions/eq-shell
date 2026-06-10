'use client'

import { useState } from 'react'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { TestRecordForm } from './TestRecordForm'
import { TestRecordDetail } from './TestRecordDetail'
import { formatDate, formatTestResult, formatSiteLabel } from '@/lib/utils/format'
import type { TestRecord, TestRecordReading, Asset, Site, Profile, TestResult, Attachment } from '@/lib/types'
// icons removed — rows are clickable

type RecordRow = TestRecord & {
  assets?: { name: string; asset_type: string } | null
  sites?: { name: string } | null
  tester_name?: string | null
} & Record<string, unknown>

interface TestRecordListProps {
  records: RecordRow[]
  readingsMap: Record<string, TestRecordReading[]>
  attachmentsMap: Record<string, Attachment[]>
  assets: Pick<Asset, 'id' | 'name' | 'asset_type' | 'site_id'>[]
  sites: (Pick<Site, 'id' | 'name'> & {
    code?: string | null
    customers?: { name?: string | null } | { name?: string | null }[] | null
  })[]
  technicians: Pick<Profile, 'id' | 'email' | 'full_name'>[]
  page: number
  totalPages: number
  isAdmin: boolean
  canWrite: boolean
}

function resultToBadge(result: TestResult): 'not-started' | 'complete' | 'blocked' | 'in-progress' {
  const map: Record<TestResult, 'not-started' | 'complete' | 'blocked' | 'in-progress'> = {
    pending: 'not-started',
    pass: 'complete',
    fail: 'blocked',
    defect: 'blocked',
  }
  return map[result]
}

export function TestRecordList({
  records, readingsMap, attachmentsMap, assets, sites, technicians,
  page, totalPages, isAdmin, canWrite: canWriteRole,
}: TestRecordListProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<RecordRow | null>(null)
  const [detailRecord, setDetailRecord] = useState<RecordRow | null>(null)

  const columns: DataTableColumn<RecordRow>[] = [
    {
      key: 'asset_name',
      header: 'Asset',
      render: (row) => (
        <div>
          <span className="font-medium text-eq-ink">{row.assets?.name ?? '—'}</span>
          {row.assets?.asset_type && (
            <span className="ml-2 text-xs text-eq-grey">{row.assets.asset_type}</span>
          )}
        </div>
      ),
    },
    {
      key: 'test_type',
      header: 'Test Type',
      render: (row) => row.test_type,
    },
    {
      key: 'site_name',
      header: 'Site',
      render: (row) => row.sites?.name ?? '—',
    },
    {
      key: 'test_date',
      header: 'Test Date',
      render: (row) => formatDate(row.test_date),
    },
    {
      key: 'tested_by',
      header: 'Tested By',
      render: (row) => (row as RecordRow).tester_name ?? '—',
    },
    {
      key: 'result',
      header: 'Result',
      render: (row) => <StatusBadge status={resultToBadge(row.result)} label={formatTestResult(row.result)} />,
    },
  ]

  const siteFilterOptions = sites.map((s) => ({ value: s.id, label: formatSiteLabel(s) }))
  const resultFilterOptions = [
    { value: 'pending', label: 'Pending' },
    { value: 'pass', label: 'Pass' },
    { value: 'fail', label: 'Fail' },
    { value: 'defect', label: 'Defect' },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <SearchFilter
          placeholder="Search records..."
          filters={[
            { key: 'site_id', label: 'All Sites', options: siteFilterOptions },
            { key: 'result', label: 'All Results', options: resultFilterOptions },
          ]}
        />
        {canWriteRole && (
          <Button onClick={() => setCreateOpen(true)} className="ml-4 shrink-0">Add Test Record</Button>
        )}
      </div>

      {records.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-3">No test records yet.</p>
          {canWriteRole && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>Create your first test record</Button>
          )}
        </div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={records}
            emptyMessage="No records match your filters."
            onRowClick={(row) => setDetailRecord(row as RecordRow)}
          />
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}

      <TestRecordForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        assets={assets}
        sites={sites}
        technicians={technicians}
      />

      {editRecord && (
        <TestRecordForm
          open={!!editRecord}
          onClose={() => setEditRecord(null)}
          record={editRecord}
          assets={assets}
          sites={sites}
          technicians={technicians}
        />
      )}

      {detailRecord && (
        <TestRecordDetail
          open={!!detailRecord}
          onClose={() => setDetailRecord(null)}
          record={detailRecord}
          readings={readingsMap[detailRecord.id] ?? []}
          attachments={attachmentsMap[detailRecord.id] ?? []}
          assets={assets}
          sites={sites}
          technicians={technicians}
          isAdmin={isAdmin}
          canWrite={canWriteRole}
          onEdit={() => { setEditRecord(detailRecord); setDetailRecord(null) }}
        />
      )}
    </>
  )
}
