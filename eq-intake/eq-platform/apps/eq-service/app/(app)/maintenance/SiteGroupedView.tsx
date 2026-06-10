'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/utils/format'
import {
  ChevronDown,
  ChevronRight,
  MapPin,
  Eye,
  Trash2,
  AlertTriangle,
  CalendarClock,
  Factory,
  Layers,
  ArrowRight,
} from 'lucide-react'
import type { MaintenanceCheck, MaintenanceCheckItem, CheckStatus, Site } from '@/lib/types'
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

type SiteInfo = Pick<Site, 'id' | 'name' | 'customer_id'> & {
  code?: string | null
  customers?: { name?: string | null } | { name?: string | null }[] | null
}

interface SiteGroupedViewProps {
  checks: CheckRow[]
  itemsMap: Record<string, MaintenanceCheckItem[]>
  sites: SiteInfo[]
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

function formatFrequency(f: string | null | undefined): string {
  if (!f) return ''
  return f.replace('_', '-').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Kanban columns mirror the global kanban order: Scheduled, In Progress, Overdue, Complete
type KanbanCol = 'scheduled' | 'in_progress' | 'overdue' | 'complete'
const KANBAN_COLS: KanbanCol[] = ['scheduled', 'in_progress', 'overdue', 'complete']
const KANBAN_LABEL: Record<KanbanCol, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  overdue: 'Overdue',
  complete: 'Complete',
}
const KANBAN_HEADER_TEXT: Record<KanbanCol, string> = {
  scheduled: 'text-gray-600',
  in_progress: 'text-eq-deep',
  overdue: 'text-red-600',
  complete: 'text-green-700',
}
const KANBAN_HEADER_BG: Record<KanbanCol, string> = {
  scheduled: 'bg-gray-50',
  in_progress: 'bg-eq-ice',
  overdue: 'bg-red-50',
  complete: 'bg-green-50',
}
const KANBAN_DOT: Record<KanbanCol, string> = {
  scheduled: 'bg-gray-400',
  in_progress: 'bg-eq-sky',
  overdue: 'bg-red-500',
  complete: 'bg-green-500',
}

// Worst-wins aggregate when rolling multiple checks into one cycle card.
// Ordering: overdue beats everything, then in_progress, then scheduled,
// then complete, then cancelled. A single overdue child paints the card red.
const STATUS_PRIORITY: Record<CheckStatus, number> = {
  overdue: 5,
  in_progress: 4,
  scheduled: 3,
  complete: 2,
  cancelled: 1,
}

function worstStatus(statuses: CheckStatus[]): CheckStatus {
  let worst: CheckStatus = 'complete'
  let bestScore = -1
  for (const s of statuses) {
    const score = STATUS_PRIORITY[s] ?? 0
    if (score > bestScore) {
      bestScore = score
      worst = s
    }
  }
  return worst
}

function statusToKanbanCol(status: CheckStatus): KanbanCol {
  if (status === 'scheduled') return 'scheduled'
  if (status === 'in_progress') return 'in_progress'
  if (status === 'overdue') return 'overdue'
  return 'complete' // complete + cancelled
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T00:00:00Z').getTime()
  const b = new Date(bIso + 'T00:00:00Z').getTime()
  return Math.round((a - b) / (1000 * 60 * 60 * 24))
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Return the anchor date used to place a check into a cycle. Prefer start_date
// (when the cycle began) and fall back to due_date so we never drop a check.
function cycleAnchor(check: CheckRow): string | null {
  const start = (check.start_date as string | null) ?? null
  const due = (check.due_date as string | null) ?? null
  return start ?? due ?? null
}

// 'YYYY-MM' key for sorting / grouping
function monthKey(iso: string | null): string {
  if (!iso) return 'unknown'
  return iso.slice(0, 7)
}

// 'August 2025' label for display
function monthLabel(iso: string | null): string {
  if (!iso) return 'Unscheduled'
  const d = new Date(iso + 'T00:00:00Z')
  if (isNaN(d.getTime())) return 'Unscheduled'
  return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

interface CycleGroup {
  key: string
  siteId: string
  frequency: string | null
  startMonthKey: string
  startMonthLabel: string
  checks: CheckRow[]
  status: CheckStatus
  earliestDue: string | null
  latestDue: string | null
  totalItems: number
  completedItems: number
}

interface SiteGroup {
  siteId: string
  siteName: string
  siteCode: string | null
  customerName: string | null
  cycles: CycleGroup[]
  byCol: Record<KanbanCol, CycleGroup[]>
  counts: Record<KanbanCol, number>
  checkCount: number
  totalItems: number
  completedItems: number
  nextDue: string | null
  earliestOverdue: string | null
}

export function SiteGroupedView({ checks, itemsMap, sites, onCheckClick, isAdmin = false }: SiteGroupedViewProps) {
  const router = useRouter()
  const siteInfoMap = useMemo(() => {
    const m = new Map<string, SiteInfo>()
    for (const s of sites) m.set(s.id, s)
    return m
  }, [sites])

  const [allExpanded, setAllExpanded] = useState(true)
  const [forceKey, setForceKey] = useState(0)
  const [activeCycle, setActiveCycle] = useState<CycleGroup | null>(null)

  const groups = useMemo<SiteGroup[]>(() => {
    const today = todayISO()

    // Pass 1: bucket checks into cycle groups keyed by (site, frequency, month)
    const cycleMap = new Map<string, CycleGroup>()
    for (const check of checks) {
      const siteId = (check.site_id as string) ?? 'unassigned'
      const frequency = (check.frequency as string | null) ?? null
      const anchor = cycleAnchor(check)
      const mKey = monthKey(anchor)
      const key = `${siteId}|${frequency ?? 'none'}|${mKey}`

      if (!cycleMap.has(key)) {
        cycleMap.set(key, {
          key,
          siteId,
          frequency,
          startMonthKey: mKey,
          startMonthLabel: monthLabel(anchor),
          checks: [],
          status: 'complete',
          earliestDue: null,
          latestDue: null,
          totalItems: 0,
          completedItems: 0,
        })
      }

      const c = cycleMap.get(key)!
      c.checks.push(check)
      c.totalItems += check.item_count ?? 0
      c.completedItems += check.completed_count ?? 0

      const due = check.due_date as string | null
      if (due) {
        if (!c.earliestDue || due < c.earliestDue) c.earliestDue = due
        if (!c.latestDue || due > c.latestDue) c.latestDue = due
      }
    }

    // Pass 2: compute aggregate status for each cycle (worst-wins, with
    // overdue re-applied for past-due non-terminal checks in case the DB status
    // column hasn't been refreshed)
    for (const c of cycleMap.values()) {
      const statuses: CheckStatus[] = c.checks.map((ck) => {
        const s = ck.status as CheckStatus
        const due = ck.due_date as string | null
        if (s !== 'complete' && s !== 'cancelled' && due && due < today) return 'overdue'
        return s
      })
      c.status = worstStatus(statuses)
    }

    // Pass 3: roll cycles up into site sections
    const siteMap = new Map<string, SiteGroup>()
    for (const cycle of cycleMap.values()) {
      const info = siteInfoMap.get(cycle.siteId)
      const sampleCheck = cycle.checks[0]
      const siteName = info?.name ?? sampleCheck?.sites?.name ?? 'Unassigned'
      const siteCode = info?.code ?? null
      const customerField = info?.customers
      const customer = Array.isArray(customerField) ? customerField[0] : customerField
      const customerName = customer?.name ?? null

      if (!siteMap.has(cycle.siteId)) {
        siteMap.set(cycle.siteId, {
          siteId: cycle.siteId,
          siteName,
          siteCode,
          customerName,
          cycles: [],
          byCol: { scheduled: [], in_progress: [], overdue: [], complete: [] },
          counts: { scheduled: 0, in_progress: 0, overdue: 0, complete: 0 },
          checkCount: 0,
          totalItems: 0,
          completedItems: 0,
          nextDue: null,
          earliestOverdue: null,
        })
      }
      const g = siteMap.get(cycle.siteId)!
      g.cycles.push(cycle)

      const col = statusToKanbanCol(cycle.status)
      g.byCol[col].push(cycle)
      g.counts[col] += 1

      g.checkCount += cycle.checks.length
      g.totalItems += cycle.totalItems
      g.completedItems += cycle.completedItems

      const due = cycle.earliestDue
      if (due) {
        if (cycle.status !== 'complete' && cycle.status !== 'cancelled') {
          if (!g.nextDue || due < g.nextDue) g.nextDue = due
        }
        if (cycle.status === 'overdue') {
          if (!g.earliestOverdue || due < g.earliestOverdue) g.earliestOverdue = due
        }
      }
    }

    // Sort cycles within each column by earliest due date, then by start month
    for (const g of siteMap.values()) {
      for (const col of KANBAN_COLS) {
        g.byCol[col].sort((a, b) => {
          const aDue = a.earliestDue ?? '9999-12-31'
          const bDue = b.earliestDue ?? '9999-12-31'
          if (aDue !== bDue) return aDue.localeCompare(bDue)
          return a.startMonthKey.localeCompare(b.startMonthKey)
        })
      }
    }

    return Array.from(siteMap.values()).sort((a, b) => {
      if (a.customerName && b.customerName && a.customerName !== b.customerName) {
        return a.customerName.localeCompare(b.customerName)
      }
      return a.siteName.localeCompare(b.siteName)
    })
  }, [checks, siteInfoMap])

  if (groups.length === 0) return null

  function toggleAll(next: boolean) {
    setAllExpanded(next)
    setForceKey((k) => k + 1)
  }

  const totalChecks = groups.reduce((sum, g) => sum + g.checkCount, 0)
  const totalCycles = groups.reduce((sum, g) => sum + g.cycles.length, 0)
  const totalOverdue = groups.reduce((sum, g) => sum + g.counts.overdue, 0)
  const totalInProgress = groups.reduce((sum, g) => sum + g.counts.in_progress, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-eq-grey">
        <div className="flex items-center gap-3">
          <span>{groups.length} site{groups.length !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>{totalCycles} cycle{totalCycles !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>{totalChecks} check{totalChecks !== 1 ? 's' : ''}</span>
          {totalOverdue > 0 && (
            <>
              <span>·</span>
              <span className="text-red-600 font-semibold">{totalOverdue} overdue</span>
            </>
          )}
          {totalInProgress > 0 && (
            <>
              <span>·</span>
              <span className="text-eq-deep font-semibold">{totalInProgress} in progress</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleAll(true)}
            className="px-2 py-1 rounded hover:bg-gray-100 text-eq-deep"
          >
            Expand all
          </button>
          <button
            onClick={() => toggleAll(false)}
            className="px-2 py-1 rounded hover:bg-gray-100 text-eq-deep"
          >
            Collapse all
          </button>
        </div>
      </div>

      {groups.map((group) => (
        <SiteSection
          key={`${group.siteId}-${forceKey}`}
          group={group}
          onCycleClick={setActiveCycle}
          defaultOpen={allExpanded}
        />
      ))}

      <CycleDetailModal
        cycle={activeCycle}
        itemsMap={itemsMap}
        onClose={() => setActiveCycle(null)}
        onCheckClick={(check) => {
          setActiveCycle(null)
          onCheckClick(check)
        }}
        onArchived={() => {
          // Close the modal and force the page's server data to refetch.
          // Without router.refresh() the client never sees the
          // revalidatePath() effect — the modal would redraw from a
          // stale activeCycle reference and the deleted check would
          // reappear, sending the user round in circles.
          setActiveCycle(null)
          router.refresh()
        }}
        isAdmin={isAdmin}
        siteLabel={(() => {
          if (!activeCycle) return null
          const g = groups.find((gr) => gr.siteId === activeCycle.siteId)
          if (!g) return null
          return g.siteCode ? `${g.siteCode} — ${g.siteName}` : g.siteName
        })()}
      />
    </div>
  )
}

function SiteSection({
  group,
  onCycleClick,
  defaultOpen,
}: {
  group: SiteGroup
  onCycleClick: (cycle: CycleGroup) => void
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const cycleCount = group.cycles.length
  const pctComplete = group.totalItems > 0 ? Math.round((group.completedItems / group.totalItems) * 100) : 0

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-3 px-4 py-3 bg-eq-ice hover:bg-eq-ice/80 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-4 h-4 text-eq-deep mt-0.5 shrink-0" /> : <ChevronRight className="w-4 h-4 text-eq-deep mt-0.5 shrink-0" />}
        <MapPin className="w-4 h-4 text-eq-sky mt-0.5 shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-eq-deep">
              {group.siteCode ? `${group.siteCode} — ${group.siteName}` : group.siteName}
            </span>
            {group.customerName && (
              <span className="text-xs text-eq-grey flex items-center gap-1">
                <Factory className="w-3 h-3" />
                {group.customerName}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="text-xs text-eq-grey">
              {cycleCount} cycle{cycleCount !== 1 ? 's' : ''}
            </span>
            <span className="text-xs text-eq-grey">·</span>
            <span className="text-xs text-eq-grey">
              {group.checkCount} check{group.checkCount !== 1 ? 's' : ''}
            </span>
            {group.totalItems > 0 && (
              <>
                <span className="text-xs text-eq-grey">·</span>
                <span className="text-xs text-eq-grey">
                  {group.completedItems}/{group.totalItems} items ({pctComplete}%)
                </span>
              </>
            )}
            {group.nextDue && (
              <>
                <span className="text-xs text-eq-grey">·</span>
                <span className="text-xs text-eq-grey flex items-center gap-1">
                  <CalendarClock className="w-3 h-3" />
                  Next due {formatDate(group.nextDue)}
                </span>
              </>
            )}
            {group.earliestOverdue && (
              <>
                <span className="text-xs text-eq-grey">·</span>
                <span className="text-xs text-red-600 font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Oldest overdue {formatDate(group.earliestOverdue)}
                </span>
              </>
            )}
          </div>

          {group.totalItems > 0 && (
            <div className="w-full bg-gray-200 rounded-full h-1 mt-2">
              <div
                className="bg-eq-sky h-1 rounded-full transition-all"
                style={{ width: `${pctComplete}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto text-xs shrink-0 flex-wrap justify-end max-w-[50%]">
          {KANBAN_COLS.map((key) => {
            const n = group.counts[key]
            if (!n) return null
            return (
              <span
                key={key}
                className="px-2 py-0.5 rounded-full bg-white border border-gray-200 flex items-center gap-1.5 text-eq-ink"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${KANBAN_DOT[key]}`} />
                {n} {KANBAN_LABEL[key].toLowerCase()}
              </span>
            )
          })}
        </div>
      </button>

      {open && (
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {KANBAN_COLS.map((col) => (
              <KanbanColumn
                key={col}
                col={col}
                cycles={group.byCol[col]}
                onCycleClick={onCycleClick}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KanbanColumn({
  col,
  cycles,
  onCycleClick,
}: {
  col: KanbanCol
  cycles: CycleGroup[]
  onCycleClick: (cycle: CycleGroup) => void
}) {
  return (
    <div className="flex flex-col">
      <div className={`p-3 rounded-lg ${KANBAN_HEADER_BG[col]} border border-gray-200 mb-3`}>
        <h4 className={`font-semibold text-xs uppercase tracking-wide ${KANBAN_HEADER_TEXT[col]}`}>
          {KANBAN_LABEL[col]}
        </h4>
        <p className="text-[11px] text-eq-grey mt-0.5">
          {cycles.length} cycle{cycles.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {cycles.length === 0 ? (
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-3 text-center">
            <p className="text-[11px] text-eq-grey">No cycles</p>
          </div>
        ) : (
          cycles.map((cycle) => (
            <CycleCard
              key={cycle.key}
              cycle={cycle}
              onClick={() => onCycleClick(cycle)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// Cycle card — the only summary surface. Shows Site / Frequency / Month Started.
// Job plans and per-check detail are deliberately hidden until the user clicks.
function CycleCard({
  cycle,
  onClick,
}: {
  cycle: CycleGroup
  onClick: () => void
}) {
  const frequency = formatFrequency(cycle.frequency)
  const pct = cycle.totalItems > 0 ? (cycle.completedItems / cycle.totalItems) * 100 : 0
  const count = cycle.checks.length

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick() }}
      className="relative text-left p-3 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-all duration-200 hover:border-eq-sky group cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-eq-grey">
          {frequency || 'Check'}
        </p>
        <span className="px-1.5 py-0.5 rounded bg-eq-ice text-eq-deep text-[10px] font-semibold flex items-center gap-1">
          <Layers className="w-2.5 h-2.5" />
          {count}
        </span>
      </div>

      <p className="font-semibold text-sm text-eq-ink mb-2 group-hover:text-eq-sky">
        {cycle.startMonthLabel}
      </p>

      {cycle.totalItems > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] font-semibold text-eq-grey">Progress</p>
            <p className="text-[11px] font-semibold text-eq-grey">
              {cycle.completedItems}/{cycle.totalItems}
            </p>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1">
            <div
              className="bg-eq-sky h-1 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-2">
        <StatusBadge status={statusToBadge(cycle.status)} />
        <Eye className="w-3.5 h-3.5 text-eq-grey opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  )
}

// Detail modal — reveals the maintenance plans / individual checks inside a cycle.
function CycleDetailModal({
  cycle,
  itemsMap,
  onClose,
  onCheckClick,
  onArchived,
  isAdmin,
  siteLabel,
}: {
  cycle: CycleGroup | null
  itemsMap: Record<string, MaintenanceCheckItem[]>
  onClose: () => void
  onCheckClick: (check: CheckRow) => void
  onArchived: () => void
  isAdmin: boolean
  siteLabel: string | null
}) {
  if (!cycle) return null

  const frequency = formatFrequency(cycle.frequency)
  const title = [siteLabel, frequency || null, cycle.startMonthLabel]
    .filter(Boolean)
    .join(' · ')

  // Sort child checks by maintenance plan name, then by due date for stable reveal
  const sortedChecks = [...cycle.checks].sort((a, b) => {
    const jpA = a.job_plans?.name ?? a.custom_name ?? ''
    const jpB = b.job_plans?.name ?? b.custom_name ?? ''
    if (jpA !== jpB) return jpA.localeCompare(jpB)
    const dA = (a.due_date as string) ?? ''
    const dB = (b.due_date as string) ?? ''
    return dA.localeCompare(dB)
  })

  return (
    <Modal open={Boolean(cycle)} onClose={onClose} title={title} className="max-w-2xl">
      <div className="space-y-3">
        <p className="text-xs text-eq-grey">
          {sortedChecks.length} check{sortedChecks.length !== 1 ? 's' : ''} in this cycle · {cycle.completedItems}/{cycle.totalItems} items complete
        </p>

        <div className="flex flex-col gap-2">
          {sortedChecks.map((check) => (
            <CycleChildRow
              key={check.id}
              check={check}
              items={itemsMap[check.id] ?? []}
              onOpen={() => onCheckClick(check)}
              onArchived={onArchived}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      </div>
    </Modal>
  )
}

function CycleChildRow({
  check,
  items,
  onOpen,
  onArchived,
  isAdmin,
}: {
  check: CheckRow
  items: MaintenanceCheckItem[]
  onOpen: () => void
  onArchived: () => void
  isAdmin: boolean
}) {
  const [pending, startTransition] = useTransition()
  const confirm = useConfirm()
  const toast = useToast()

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    const ok = await confirm({
      title: 'Delete this check?',
      message: 'It will be removed from all views. You can restore it from Admin → Archive.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    startTransition(async () => {
      const res = await archiveCheckAction(check.id, false)
      if (!res?.success) {
        // Surface the error so the user isn't left clicking a dead button.
        // archiveCheckAction returns { success, error } — previously we
        // discarded the result and the user saw zero feedback on failure.
        toast.error(res?.error ?? 'Could not delete this check. Please try again.')
        return
      }
      onArchived()
    })
  }

  const completedCount = items.filter((i) => i.result !== null).length
  const total = items.length
  const pct = total > 0 ? (completedCount / total) * 100 : 0

  const status = check.status as CheckStatus
  const due = check.due_date as string
  const today = todayISO()
  const dueDelta = due ? daysBetween(due, today) : null
  const isOverdue = status === 'overdue' || (dueDelta !== null && dueDelta < 0 && status !== 'complete' && status !== 'cancelled')

  const jobPlan = check.job_plans?.name ?? check.custom_name ?? '—'
  const wo = (check.maximo_wo_number as string | null) ?? null
  const pm = (check.maximo_pm_number as string | null) ?? null

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}
      className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:border-eq-sky hover:shadow-sm transition-all cursor-pointer group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="px-1.5 py-0.5 rounded bg-eq-ice text-eq-deep text-[10px] font-semibold uppercase tracking-wide">
            {jobPlan}
          </span>
          <StatusBadge status={statusToBadge(status)} />
        </div>

        <p className="text-xs text-eq-grey flex items-center gap-2 flex-wrap">
          {due && (
            <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-600 font-semibold' : ''}`}>
              <CalendarClock className="w-3 h-3" />
              Due {formatDate(due)}
            </span>
          )}
          {check.assignee_name && (
            <>
              <span>·</span>
              <span>{check.assignee_name}</span>
            </>
          )}
          {(wo || pm) && (
            <>
              <span>·</span>
              <span className="font-mono">{wo ? `WO ${wo}` : `PM ${pm}`}</span>
            </>
          )}
        </p>

        {total > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] text-eq-grey">Progress</p>
              <p className="text-[11px] text-eq-grey">{completedCount}/{total}</p>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1">
              <div className="bg-eq-sky h-1 rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {isAdmin && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="p-1 rounded hover:bg-red-50 text-eq-grey hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete check"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        <ArrowRight className="w-4 h-4 text-eq-grey group-hover:text-eq-sky transition-colors" />
      </div>
    </div>
  )
}
