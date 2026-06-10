'use client'

import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { formatDateTime } from '@/lib/utils/format'
import type { AuditLog } from '@/lib/types'

type LogRow = AuditLog & { user_name: string } & Record<string, unknown>

interface AuditLogListProps {
  logs: LogRow[]
  entityTypes: string[]
  page: number
  totalPages: number
}

const actionColours: Record<string, string> = {
  create: 'text-green-600 bg-green-50',
  update: 'text-blue-600 bg-blue-50',
  delete: 'text-red-600 bg-red-50',
  login: 'text-purple-600 bg-purple-50',
  export: 'text-amber-600 bg-amber-50',
}

export function AuditLogList({ logs, entityTypes, page, totalPages }: AuditLogListProps) {
  const columns: DataTableColumn<LogRow>[] = [
    {
      key: 'created_at',
      header: 'Time',
      render: (row) => <span className="text-xs text-eq-grey whitespace-nowrap">{formatDateTime(row.created_at)}</span>,
    },
    {
      key: 'user_name',
      header: 'User',
      render: (row) => <span className="font-medium text-eq-ink">{row.user_name}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      render: (row) => {
        const cls = actionColours[row.action] ?? 'text-gray-600 bg-gray-50'
        return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{row.action}</span>
      },
    },
    {
      key: 'entity_type',
      header: 'Entity',
      render: (row) => <span className="text-sm text-eq-ink">{row.entity_type}</span>,
    },
    {
      key: 'summary',
      header: 'Summary',
      render: (row) => <span className="text-sm text-eq-grey">{row.summary ?? '—'}</span>,
    },
  ]

  const entityFilterOptions = entityTypes.map((e) => ({ value: e, label: e.replace(/_/g, ' ') }))
  const actionFilterOptions = [
    { value: 'create', label: 'Create' },
    { value: 'update', label: 'Update' },
    { value: 'delete', label: 'Delete' },
    { value: 'login', label: 'Login' },
    { value: 'export', label: 'Export' },
  ]

  return (
    <>
      <div className="mb-4">
        <SearchFilter
          placeholder="Filter audit logs..."
          filters={[
            { key: 'entity_type', label: 'All Entities', options: entityFilterOptions },
            { key: 'action', label: 'All Actions', options: actionFilterOptions },
          ]}
        />
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm">No audit log entries found.</p>
        </div>
      ) : (
        <>
          <DataTable columns={columns} rows={logs} emptyMessage="No logs match your filters." />
          <Pagination page={page} totalPages={totalPages} />
        </>
      )}
    </>
  )
}
