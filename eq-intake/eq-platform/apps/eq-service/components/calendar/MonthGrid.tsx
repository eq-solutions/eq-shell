'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
import type { PmCalendarEntry } from '@/lib/types'

type EntryRow = PmCalendarEntry & { site_name: string }

interface MonthGridProps {
  entries: EntryRow[]
  onEntryClick: (entry: EntryRow) => void
  onMoveEntry?: (id: string, newDate: string) => Promise<void> | void
  initialMonth?: Date
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const CATEGORY_PILL: Record<string, string> = {
  'Thermal scanning': 'bg-red-100 text-red-700 hover:bg-red-200',
  'Dark site test': 'bg-purple-100 text-purple-700 hover:bg-purple-200',
  'Emergency lighting': 'bg-amber-100 text-amber-700 hover:bg-amber-200',
  'Lightning protection testing': 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200',
  'Management': 'bg-gray-100 text-gray-700 hover:bg-gray-200',
  'RCD testing': 'bg-blue-100 text-blue-700 hover:bg-blue-200',
  'Test and tagging': 'bg-teal-100 text-teal-700 hover:bg-teal-200',
  'Quarterly maintenance': 'bg-green-100 text-green-700 hover:bg-green-200',
  'WOs': 'bg-orange-100 text-orange-700 hover:bg-orange-200',
}

function pillClass(category: string): string {
  return CATEGORY_PILL[category] ?? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
}

function statusRing(status: string, startTimeIso: string): string {
  if (status === 'completed') return 'ring-1 ring-green-400/60'
  if (status === 'cancelled') return 'opacity-50 line-through'
  const start = new Date(startTimeIso)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (start < todayStart) return 'ring-1 ring-red-400'
  return ''
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function MonthGrid({ entries, onEntryClick, onMoveEntry, initialMonth }: MonthGridProps) {
  const [cursor, setCursor] = useState<Date>(() => {
    const base = initialMonth ?? new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  // Optimistic moves: id → dayKey the user dragged the entry onto. Cleared
  // once the revalidated `entries` prop reflects the new position (so we
  // don't flash back to the old day during the server roundtrip).
  const [optimisticMoves, setOptimisticMoves] = useState<Map<string, string>>(() => new Map())

  const today = useMemo(() => new Date(), [])
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const dndEnabled = !!onMoveEntry

  // Reconcile: drop optimistic entries that now match server-side reality.
  useEffect(() => {
    if (optimisticMoves.size === 0) return
    setOptimisticMoves((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const [id, expectedKey] of prev) {
        const entry = entries.find((e) => e.id === id)
        if (!entry) continue
        const actualKey = formatDateKey(new Date(entry.start_time))
        if (actualKey === expectedKey) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [entries, optimisticMoves])

  const cells = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1)
    const startWeekday = (firstOfMonth.getDay() + 6) % 7
    const gridStart = new Date(year, month, 1 - startWeekday)

    const out: Date[] = []
    for (let i = 0; i < 42; i++) {
      out.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i))
    }
    return out
  }, [year, month])

  const entriesByDay = useMemo(() => {
    const map = new Map<string, EntryRow[]>()
    for (const e of entries) {
      const d = new Date(e.start_time)
      const key = optimisticMoves.get(e.id) ?? formatDateKey(d)
      const list = map.get(key) ?? []
      list.push(e)
      map.set(key, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    }
    return map
  }, [entries, optimisticMoves])

  const monthEntryCount = useMemo(
    () => entries.filter((e) => {
      const d = new Date(e.start_time)
      return d.getFullYear() === year && d.getMonth() === month
    }).length,
    [entries, year, month],
  )

  function goPrev() {
    setCursor(new Date(year, month - 1, 1))
  }
  function goNext() {
    setCursor(new Date(year, month + 1, 1))
  }
  function goToday() {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1))
  }

  async function handleDrop(e: React.DragEvent, dayKey: string) {
    e.preventDefault()
    setDragOverKey(null)
    setDraggingId(null)
    if (!onMoveEntry) return
    const id = e.dataTransfer.getData('text/plain')
    if (!id) return
    const sourceEntry = entries.find((entry) => entry.id === id)
    if (!sourceEntry) return
    const sourceKey = formatDateKey(new Date(sourceEntry.start_time))
    if (sourceKey === dayKey) return

    // Optimistic: pill jumps to the new day immediately. Reconciled or
    // rolled back below once the server settles.
    setMoveError(null)
    setOptimisticMoves((prev) => {
      const next = new Map(prev)
      next.set(id, dayKey)
      return next
    })

    try {
      await onMoveEntry(id, dayKey)
    } catch (err) {
      setMoveError((err as Error).message ?? 'Move failed.')
      setOptimisticMoves((prev) => {
        if (!prev.has(id)) return prev
        const next = new Map(prev)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-eq-sky/5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            className="p-1.5 rounded-md text-eq-grey hover:bg-white hover:text-eq-deep transition-colors"
            title="Previous month"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={goNext}
            className="p-1.5 rounded-md text-eq-grey hover:bg-white hover:text-eq-deep transition-colors"
            title="Next month"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToday}
            className="ml-1 inline-flex items-center gap-1 h-7 px-2 text-xs font-medium rounded-md border border-gray-200 bg-white text-eq-ink hover:bg-eq-ice"
            title="Jump to today"
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            Today
          </button>
        </div>
        <h3 className="text-base font-semibold text-eq-ink">
          {MONTH_FULL[month]} {year}
        </h3>
        <div className="text-xs text-eq-grey tabular-nums">
          {monthEntryCount} {monthEntryCount === 1 ? 'entry' : 'entries'}
          {dndEnabled && (
            <span className="ml-2 text-[10px] uppercase tracking-wide text-eq-grey/70">drag to move</span>
          )}
        </div>
      </div>

      {moveError && (
        <div className="px-4 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200 flex items-center justify-between">
          <span>{moveError}</span>
          <button
            onClick={() => setMoveError(null)}
            className="text-red-600 hover:text-red-800 ml-3"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/50">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-eq-grey text-center"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 grid-rows-6">
        {cells.map((cell, idx) => {
          const inMonth = cell.getMonth() === month
          const isToday = isSameDay(cell, today)
          const key = formatDateKey(cell)
          const dayEntries = entriesByDay.get(key) ?? []
          const visible = dayEntries.slice(0, 3)
          const overflow = dayEntries.length - visible.length
          const isLastCol = idx % 7 === 6
          const isLastRow = idx >= 35
          const isDragOver = dndEnabled && dragOverKey === key

          return (
            <div
              key={idx}
              onDragOver={dndEnabled ? (e) => {
                e.preventDefault()
                if (dragOverKey !== key) setDragOverKey(key)
              } : undefined}
              onDragLeave={dndEnabled ? () => {
                if (dragOverKey === key) setDragOverKey(null)
              } : undefined}
              onDrop={dndEnabled ? (e) => handleDrop(e, key) : undefined}
              className={`min-h-[96px] p-1.5 ${isLastCol ? '' : 'border-r'} ${isLastRow ? '' : 'border-b'} border-gray-100 transition-colors ${
                isDragOver
                  ? 'bg-eq-ice ring-2 ring-eq-sky ring-inset'
                  : inMonth
                  ? 'bg-white'
                  : 'bg-gray-50/40'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`inline-flex items-center justify-center text-xs tabular-nums ${
                    isToday
                      ? 'h-5 w-5 rounded-full bg-eq-sky text-white font-semibold'
                      : inMonth
                      ? 'text-eq-ink font-medium px-0.5'
                      : 'text-gray-400 px-0.5'
                  }`}
                >
                  {cell.getDate()}
                </span>
              </div>
              <div className="space-y-1">
                {visible.map((e) => {
                  const isDragging = draggingId === e.id
                  const isPendingMove = optimisticMoves.has(e.id)
                  return (
                    <button
                      key={e.id}
                      draggable={dndEnabled}
                      onDragStart={dndEnabled ? (ev) => {
                        ev.dataTransfer.setData('text/plain', e.id)
                        ev.dataTransfer.effectAllowed = 'move'
                        setDraggingId(e.id)
                      } : undefined}
                      onDragEnd={dndEnabled ? () => {
                        setDraggingId(null)
                        setDragOverKey(null)
                      } : undefined}
                      onClick={() => onEntryClick(e)}
                      className={`w-full text-left px-1.5 py-0.5 rounded text-[10.5px] font-medium truncate ${pillClass(e.category)} ${statusRing(e.status, e.start_time)} ${
                        isDragging ? 'opacity-40' : ''
                      } ${isPendingMove ? 'opacity-70 animate-pulse' : ''} ${dndEnabled ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      title={`${e.title} — ${e.site_name}${isPendingMove ? ' (saving...)' : dndEnabled ? ' (drag to move)' : ''}`}
                    >
                      {e.title}
                    </button>
                  )
                })}
                {overflow > 0 && (
                  <div className="px-1.5 text-[10px] text-eq-grey">+{overflow} more</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
