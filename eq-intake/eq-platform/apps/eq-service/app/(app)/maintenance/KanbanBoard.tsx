'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/utils/format'
import { Eye, Trash2 } from 'lucide-react'
import type { MaintenanceCheck, MaintenanceCheckItem, CheckStatus } from '@/lib/types'
import { archiveCheckAction } from './actions'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

type CheckRow = MaintenanceCheck & {
  job_plans?: { name: string } | null
  sites?: { name: string } | null
  assignee_name?: string | null
  item_count?: number
  completed_count?: number
} & Record<string, unknown>

interface KanbanBoardProps {
  checks: CheckRow[]
  itemsMap: Record<string, MaintenanceCheckItem[]>
  onCheckClick: (check: CheckRow) => void
  isAdmin?: boolean
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

function getColumnColor(column: 'scheduled' | 'in_progress' | 'overdue' | 'complete') {
  const colorMap = {
    scheduled: 'text-gray-600',
    in_progress: 'text-eq-deep',
    overdue: 'text-red-600',
    complete: 'text-green-700',
  }
  return colorMap[column]
}

function getColumnBg(column: 'scheduled' | 'in_progress' | 'overdue' | 'complete') {
  const bgMap = {
    scheduled: 'bg-gray-50',
    in_progress: 'bg-eq-ice',
    overdue: 'bg-red-50',
    complete: 'bg-green-50',
  }
  return bgMap[column]
}

export function KanbanBoard({ checks, itemsMap, onCheckClick, isAdmin = false }: KanbanBoardProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const confirm = useConfirm()
  const toast = useToast()

  async function handleDelete(e: React.MouseEvent, checkId: string) {
    // Stop propagation synchronously — the click bubbles to the card click
    // before any await runs.
    e.stopPropagation()
    const ok = await confirm({
      title: 'Delete this check?',
      message: 'It will be removed from all views. You can restore it from Admin → Archive.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    startTransition(async () => {
      const res = await archiveCheckAction(checkId, false)
      if (!res?.success) {
        // archiveCheckAction returns { success, error }. Previously we
        // discarded the result and the card stayed put with no feedback
        // on failure — admin-only check or DB error went unnoticed.
        toast.error(res?.error ?? 'Could not delete this check. Please try again.')
        return
      }
      // router.refresh() pulls the freshly-revalidated server data
      // through to this client view; without it the deleted card would
      // remain visible until the next navigation.
      router.refresh()
    })
  }
  // Group checks by status
  const columns = ['scheduled', 'in_progress', 'overdue', 'complete'] as const

  const groupedChecks: Record<string, CheckRow[]> = {
    scheduled: [],
    in_progress: [],
    overdue: [],
    complete: [],
  }

  for (const check of checks) {
    const status = check.status as CheckStatus
    if (status === 'scheduled') {
      groupedChecks.scheduled.push(check)
    } else if (status === 'in_progress') {
      groupedChecks.in_progress.push(check)
    } else if (status === 'overdue') {
      groupedChecks.overdue.push(check)
    } else if (status === 'complete') {
      groupedChecks.complete.push(check)
    } else if (status === 'cancelled') {
      groupedChecks.complete.push(check)
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {columns.map((column) => {
        const columnChecks = groupedChecks[column] ?? []
        const columnLabel = {
          scheduled: 'Scheduled',
          in_progress: 'In Progress',
          overdue: 'Overdue',
          complete: 'Complete',
        }[column]

        return (
          <div key={column} className="flex flex-col">
            {/* Column Header */}
            <div className={`p-4 rounded-lg ${getColumnBg(column)} border border-gray-200 mb-4`}>
              <h3 className={`font-semibold text-sm uppercase tracking-wide ${getColumnColor(column)}`}>
                {columnLabel}
              </h3>
              <p className="text-xs text-eq-grey mt-1">{columnChecks.length} check{columnChecks.length !== 1 ? 's' : ''}</p>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-3">
              {columnChecks.length === 0 ? (
                <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center">
                  <p className="text-xs text-eq-grey">No checks</p>
                </div>
              ) : (
                columnChecks.map((check) => {
                  const items = itemsMap[check.id] ?? []
                  const completedCount = items.filter((i) => i.result !== null).length

                  return (
                    <div
                      key={check.id}
                      onClick={() => onCheckClick(check)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') onCheckClick(check) }}
                      className="relative text-left p-4 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-all duration-200 hover:border-eq-sky group cursor-pointer"
                    >
                      {isAdmin && (
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, check.id)}
                            disabled={pending}
                            className="p-1 rounded hover:bg-red-50 text-eq-grey hover:text-red-600"
                            title="Delete check"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      {/* Maintenance Plan Name */}
                      <p className="font-semibold text-sm text-eq-ink mb-2 line-clamp-2 group-hover:text-eq-sky pr-12">
                        {check.job_plans?.name ?? '—'}
                      </p>

                      {/* Site Name */}
                      <p className="text-xs text-eq-grey mb-2">
                        {check.sites?.name ?? '—'}
                      </p>

                      {/* Due Date */}
                      <p className="text-xs text-eq-grey mb-3">
                        Due: {formatDate(check.due_date as string)}
                      </p>

                      {/* Assigned To */}
                      <p className="text-xs text-eq-grey mb-3">
                        Assigned: {(check as CheckRow).assignee_name ?? 'Unassigned'}
                      </p>

                      {/* Progress Bar */}
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-semibold text-eq-grey">
                            Progress
                          </p>
                          <p className="text-xs font-semibold text-eq-grey">
                            {completedCount}/{items.length}
                          </p>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div
                            className="bg-eq-sky h-1.5 rounded-full transition-all"
                            style={{ width: `${items.length > 0 ? (completedCount / items.length) * 100 : 0}%` }}
                          />
                        </div>
                      </div>

                      {/* Status Badge */}
                      <div className="flex items-center justify-between">
                        <StatusBadge status={statusToBadge(check.status as CheckStatus)} />
                        <Eye className="w-4 h-4 text-eq-grey opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
