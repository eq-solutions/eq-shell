'use client'

import { DataTable } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, formatCheckStatus, formatTestResult } from '@/lib/utils/format'
import type { Asset, MaintenanceCheck, TestRecord } from '@/lib/types'

/* ---------- Assets ---------- */

interface SiteAssetsTableProps {
  assets: Asset[]
}

export function SiteAssetsTable({ assets }: SiteAssetsTableProps) {
  return (
    <DataTable<Asset & Record<string, unknown>>
      columns={[
        {
          key: 'name',
          header: 'Asset Name',
          render: (row) => (
            <a href={`/assets/${row.id}`} className="text-eq-sky hover:text-eq-deep font-medium">
              {row.name}
            </a>
          ),
        },
        {
          key: 'asset_type',
          header: 'Type',
        },
        {
          key: 'manufacturer',
          header: 'Manufacturer',
          render: (row) => row.manufacturer || '-',
        },
        {
          key: 'model',
          header: 'Model',
          render: (row) => row.model || '-',
        },
        {
          key: 'serial_number',
          header: 'Serial Number',
          render: (row) => row.serial_number || '-',
        },
      ]}
      rows={assets as (Asset & Record<string, unknown>)[]}
      emptyMessage="No assets found for this site."
    />
  )
}

/* ---------- Maintenance Checks ---------- */

type CheckRow = MaintenanceCheck & { job_plans: { name: string } | null }

interface SiteMaintenanceChecksTableProps {
  checks: CheckRow[]
}

export function SiteMaintenanceChecksTable({ checks }: SiteMaintenanceChecksTableProps) {
  return (
    <DataTable<CheckRow & Record<string, unknown>>
      columns={[
        {
          key: 'job_plans',
          header: 'Maintenance Plan',
          render: (row) => (
            <a
              href={`/job-plans/${row.job_plans?.name}`}
              className="text-eq-sky hover:text-eq-deep font-medium"
            >
              {row.job_plans?.name || '-'}
            </a>
          ),
        },
        {
          key: 'status',
          header: 'Status',
          render: (row) => {
            const statusMap: Record<string, 'not-started' | 'in-progress' | 'complete' | 'cancelled' | 'overdue'> = {
              scheduled: 'not-started', in_progress: 'in-progress', complete: 'complete', cancelled: 'cancelled', overdue: 'overdue',
            }
            return (
              <StatusBadge
                status={statusMap[row.status] ?? 'not-started'}
                label={formatCheckStatus(row.status)}
              />
            )
          },
        },
        {
          key: 'due_date',
          header: 'Due Date',
          render: (row) => formatDate(row.due_date),
        },
        {
          key: 'assigned_to',
          header: 'Assigned To',
          render: (row) => row.assigned_to || '-',
        },
        {
          key: 'completed_at',
          header: 'Completed',
          render: (row) => (row.completed_at ? formatDate(row.completed_at) : '-'),
        },
      ]}
      rows={checks as (CheckRow & Record<string, unknown>)[]}
      emptyMessage="No maintenance checks found for this site."
    />
  )
}

/* ---------- Test Records ---------- */

interface SiteTestRecordsTableProps {
  tests: TestRecord[]
}

export function SiteTestRecordsTable({ tests }: SiteTestRecordsTableProps) {
  return (
    <DataTable<TestRecord & Record<string, unknown>>
      columns={[
        {
          key: 'test_type',
          header: 'Test Type',
        },
        {
          key: 'test_date',
          header: 'Test Date',
          render: (row) => formatDate(row.test_date),
        },
        {
          key: 'result',
          header: 'Result',
          render: (row) => (
            <StatusBadge
              status={row.result === 'pass' ? 'complete' : row.result === 'fail' ? 'blocked' : 'not-started'}
              label={formatTestResult(row.result)}
            />
          ),
        },
        {
          key: 'tested_by',
          header: 'Tested By',
          render: (row) => row.tested_by || '-',
        },
        {
          key: 'next_test_due',
          header: 'Next Test Due',
          render: (row) => (row.next_test_due ? formatDate(row.next_test_due) : '-'),
        },
      ]}
      rows={tests as (TestRecord & Record<string, unknown>)[]}
      emptyMessage="No test records found for this site."
    />
  )
}
