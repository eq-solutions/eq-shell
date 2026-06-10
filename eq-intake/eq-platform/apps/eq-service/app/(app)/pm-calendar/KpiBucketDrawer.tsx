'use client'

import { SlidePanel } from '@/components/ui/SlidePanel'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { PmCalendarEntry } from '@/lib/types'

type EntryRow = PmCalendarEntry & { site_name: string }

interface KpiBucketDrawerProps {
  open: boolean
  onClose: () => void
  label: string
  description: string
  entries: EntryRow[]
  onEntryClick: (entry: EntryRow) => void
}

const CATEGORY_PILL: Record<string, string> = {
  'Thermal scanning': 'bg-red-100 text-red-700',
  'Dark site test': 'bg-purple-100 text-purple-700',
  'Emergency lighting': 'bg-amber-100 text-amber-700',
  'Lightning protection testing': 'bg-yellow-100 text-yellow-700',
  'Management': 'bg-gray-100 text-gray-600',
  'RCD testing': 'bg-blue-100 text-blue-700',
  'Test and tagging': 'bg-teal-100 text-teal-700',
  'Quarterly maintenance': 'bg-green-100 text-green-700',
  'WOs': 'bg-orange-100 text-orange-700',
}

function statusToBadge(status: string): 'active' | 'not-started' | 'complete' | 'inactive' {
  const map: Record<string, 'active' | 'not-started' | 'complete' | 'inactive'> = {
    scheduled: 'not-started',
    in_progress: 'active',
    completed: 'complete',
    cancelled: 'inactive',
  }
  return map[status] ?? 'not-started'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'Australia/Sydney',
  })
}

export function KpiBucketDrawer({
  open,
  onClose,
  label,
  description,
  entries,
  onEntryClick,
}: KpiBucketDrawerProps) {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
  )

  return (
    <SlidePanel open={open} onClose={onClose} title={`${label} (${entries.length})`}>
      <div className="space-y-3">
        <p className="text-sm text-eq-grey">{description}</p>

        {sorted.length === 0 ? (
          <div className="text-center py-12 text-sm text-eq-grey italic border border-gray-200 rounded-lg">
            Nothing in this bucket.
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
            {sorted.map((e) => {
              const pill = CATEGORY_PILL[e.category] ?? 'bg-gray-100 text-gray-600'
              return (
                <button
                  key={e.id}
                  onClick={() => onEntryClick(e)}
                  className="w-full text-left px-3 py-2.5 hover:bg-eq-ice/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-eq-ink truncate">{e.title}</div>
                      <div className="text-xs text-eq-grey mt-0.5 truncate">{e.site_name}</div>
                    </div>
                    <div className="text-xs text-eq-grey tabular-nums shrink-0">
                      {formatDate(e.start_time)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${pill}`}>
                      {e.category}
                    </span>
                    <StatusBadge status={statusToBadge(e.status)} label={e.status.replace('_', ' ')} />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </SlidePanel>
  )
}
