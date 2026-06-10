'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { togglePmCalendarActiveAction } from './actions'
import { ExternalLink } from 'lucide-react'
import type { PmCalendarEntry } from '@/lib/types'

type EntryRow = PmCalendarEntry & { site_name: string }

interface SiteLookup {
  id: string
  name: string
  code: string | null
  customers?: { id?: string | null; name?: string | null } | { id?: string | null; name?: string | null }[] | null
}

interface PmCalendarDetailProps {
  open: boolean
  onClose: () => void
  entry: EntryRow
  isAdmin: boolean
  canWrite: boolean
  onEdit: () => void
  site?: SiteLookup | null
}

function resolveCustomer(site: SiteLookup | null | undefined): { id?: string | null; name?: string | null } | null {
  if (!site?.customers) return null
  return Array.isArray(site.customers) ? (site.customers[0] ?? null) : site.customers
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

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return '—'
  // Pin timeZone so SSR (UTC) and browser (AEST) agree — avoids React
  // hydration mismatch (error #418) on edge-of-day UTC timestamps.
  return new Date(dateStr).toLocaleString('en-AU', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Australia/Sydney',
  })
}

const categoryColours: Record<string, string> = {
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

export function PmCalendarDetail({ open, onClose, entry, isAdmin, canWrite, onEdit, site }: PmCalendarDetailProps) {
  const router = useRouter()
  const [toggling, setToggling] = useState(false)
  const [staleNotice, setStaleNotice] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleToggleActive() {
    setToggling(true)
    setError(null)
    setStaleNotice(false)
    const res = await togglePmCalendarActiveAction(entry.id, !entry.is_active, entry.updated_at, crypto.randomUUID())
    setToggling(false)
    if (res.success) {
      onClose()
      return
    }
    if ('stale' in res && res.stale) {
      setStaleNotice(true)
      setTimeout(() => {
        router.refresh()
        onClose()
      }, 2000)
      return
    }
    setError(res.error ?? 'Failed to update.')
  }

  const cls = categoryColours[entry.category] ?? 'bg-gray-100 text-gray-600'

  return (
    <SlidePanel open={open} onClose={onClose} title={entry.title}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <StatusBadge status={statusToBadge(entry.status)} label={entry.status.replace('_', ' ')} />
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{entry.category}</span>
          {entry.quarter && (
            <span className="text-xs text-eq-grey bg-gray-100 px-2 py-0.5 rounded-full">{entry.quarter} — FY {entry.financial_year}</span>
          )}
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
          <div>
            <div className="text-xs text-eq-grey font-medium uppercase">Customer</div>
            {(() => {
              const c = resolveCustomer(site)
              if (c?.id && c.name) {
                return (
                  <Link
                    href={`/customers/${c.id}`}
                    className="text-eq-deep hover:text-eq-sky inline-flex items-center gap-1 group"
                  >
                    <span className="underline-offset-2 group-hover:underline">{c.name}</span>
                    <ExternalLink className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                  </Link>
                )
              }
              return <div className="text-eq-grey italic">—</div>
            })()}
          </div>
          <div>
            <div className="text-xs text-eq-grey font-medium uppercase">Site</div>
            {site?.id ? (
              <Link
                href={`/sites/${site.id}`}
                className="text-eq-deep hover:text-eq-sky inline-flex items-center gap-1 group"
              >
                <span className="underline-offset-2 group-hover:underline">{entry.site_name}</span>
                <ExternalLink className="w-3 h-3 opacity-60 group-hover:opacity-100" />
              </Link>
            ) : (
              <div className="text-eq-ink">{entry.site_name}</div>
            )}
          </div>
          <div>
            <div className="text-xs text-eq-grey font-medium uppercase">Location</div>
            <div className="text-eq-ink">{entry.location ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-eq-grey font-medium uppercase">Start</div>
            <div className="text-eq-ink">{formatDateTime(entry.start_time)}</div>
          </div>
          <div>
            <div className="text-xs text-eq-grey font-medium uppercase">End</div>
            <div className="text-eq-ink">{formatDateTime(entry.end_time)}</div>
          </div>
        </div>

        {/* Description */}
        {entry.description && (
          <div>
            <div className="text-xs text-eq-grey font-medium uppercase mb-1">Description</div>
            <div className="text-sm text-eq-ink whitespace-pre-wrap bg-gray-50 rounded-md p-3 border border-gray-100">
              {entry.description}
            </div>
          </div>
        )}

        {/* Notification config + last-sent timestamp */}
        {(entry.reminder_days_before?.length > 0 || entry.notification_recipients?.length > 0 || entry.last_notified_at) && (
          <div>
            <div className="text-xs text-eq-grey font-medium uppercase mb-1">Notifications</div>
            <div className="text-xs text-eq-grey space-y-0.5">
              {entry.reminder_days_before?.length > 0 && <div>Reminders: {entry.reminder_days_before.join(', ')} days before (picked up by the supervisor digest)</div>}
              {entry.notification_recipients?.length > 0 && <div>Cc recipients: {entry.notification_recipients.join(', ')}</div>}
              {entry.last_notified_at && <div>Last included in a digest: {formatDateTime(entry.last_notified_at)}</div>}
            </div>
          </div>
        )}

        {staleNotice && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            This entry was changed by someone else. Refreshing to show their changes...
          </p>
        )}
        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
          {canWrite && (
            <Button size="sm" onClick={onEdit}>Edit</Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="secondary" onClick={handleToggleActive} loading={toggling}>
              {entry.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          )}
        </div>
      </div>
    </SlidePanel>
  )
}
