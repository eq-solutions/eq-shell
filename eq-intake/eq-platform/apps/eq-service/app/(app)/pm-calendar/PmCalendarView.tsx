'use client'

import { useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { PmCalendarForm } from './PmCalendarForm'
import { PmCalendarDetail } from './PmCalendarDetail'
import { ClearFilteredDialog } from './ClearFilteredDialog'
import { KpiBucketDrawer } from './KpiBucketDrawer'
import { MonthGrid } from '@/components/calendar/MonthGrid'
import {
  seedPmCalendarAction,
  togglePmCalendarActiveAction,
  importPmCalendarCsvAction,
  previewSupervisorDigestAction,
  sendSupervisorDigestNowAction,
  movePmCalendarEntryAction,
} from './actions'
import type { SupervisorRunResult } from '@/lib/calendar/supervisor-digest'
import { CalendarDays, List, LayoutGrid, Loader2, Archive, Upload, Mail, Eye, Trash2 } from 'lucide-react'
import { CsvExportButton } from '@/components/ui/CsvExportButton'
import { parseCsv } from '@/lib/utils/csv'
import { events as analyticsEvents } from '@/lib/analytics'
import type { PmCalendarEntry, Site, PmCalendarCategory, AuFyQuarter } from '@/lib/types'
import { formatSiteLabel } from '@/lib/utils/format'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

type SiteOption = Pick<Site, 'id' | 'name' | 'code' | 'address'> & {
  customers?: { id?: string | null; name?: string | null } | { id?: string | null; name?: string | null }[] | null
}

type EntryRow = PmCalendarEntry & { site_name: string } & Record<string, unknown>

interface PmCalendarViewProps {
  entries: EntryRow[]
  sites: SiteOption[]
  categories: string[]
  financialYears: string[]
  technicians: { id: string; email: string; full_name: string | null }[]
  notificationRecipients: { email: string; name: string | null }[]
  siteLocations: Record<string, string[]>
  page: number
  totalPages: number
  viewMode: 'list' | 'calendar' | 'quarterly'
  isAdmin: boolean
  canWrite: boolean
}

// Category colour mapping
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

function CategoryBadge({ category }: { category: string }) {
  const cls = categoryColours[category] ?? 'bg-gray-100 text-gray-600'
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{category}</span>
}

/**
 * Top-of-page summary card — a single number on a tinted background. Renders
 * the four timing buckets (Overdue / This Week / Looking Ahead / Completed)
 * so the user sees the headline counts before any filtering. When `onClick`
 * is supplied (and count > 0) the card becomes a button that opens the
 * KpiBucketDrawer with the entries in that bucket.
 */
function StatusStripCard({
  label,
  count,
  tone,
  hint,
  onClick,
}: {
  label: string
  count: number
  tone: 'red' | 'amber' | 'blue' | 'green'
  hint?: string
  onClick?: () => void
}) {
  const toneClasses: Record<typeof tone, { bar: string; text: string; bg: string; hover: string }> = {
    red:   { bar: 'bg-red-500',   text: 'text-red-700',   bg: 'bg-red-50/50 border-red-200/70',     hover: 'hover:bg-red-50' },
    amber: { bar: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50/50 border-amber-200/70', hover: 'hover:bg-amber-50' },
    blue:  { bar: 'bg-eq-sky',    text: 'text-eq-deep',   bg: 'bg-eq-ice/40 border-eq-sky/30',      hover: 'hover:bg-eq-ice/70' },
    green: { bar: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50/50 border-green-200/70', hover: 'hover:bg-green-50' },
  }
  const c = toneClasses[tone]
  const interactive = onClick && count > 0
  const Body = (
    <div className={`relative border rounded-lg overflow-hidden text-left w-full transition-colors ${c.bg} ${interactive ? c.hover : ''}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${c.bar}`} />
      <div className="px-4 py-3 pl-5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-eq-grey">{label}</div>
        <div className={`text-2xl font-bold tabular-nums ${c.text}`}>{count}</div>
        {hint && <div className="text-[11px] text-eq-grey mt-0.5">{hint}</div>}
      </div>
    </div>
  )
  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-eq-sky rounded-lg"
        aria-label={`Open ${label} entries`}
      >
        {Body}
      </button>
    )
  }
  return Body
}

function DigestStatusBadge({ status, error }: { status: SupervisorRunResult['status']; error?: string }) {
  const config: Record<SupervisorRunResult['status'], { cls: string; label: string }> = {
    sent: { cls: 'bg-green-100 text-green-700', label: 'Sent' },
    preview: { cls: 'bg-blue-100 text-blue-700', label: 'Preview' },
    skipped_empty: { cls: 'bg-gray-100 text-gray-600', label: 'Skipped — empty' },
    skipped_no_email: { cls: 'bg-amber-100 text-amber-700', label: 'Skipped — no Resend key' },
    error: { cls: 'bg-red-100 text-red-700', label: 'Error' },
  }
  const c = config[status]
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${c.cls}`}
      title={status === 'error' ? error : undefined}
    >
      {c.label}
    </span>
  )
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

function formatDate(dateStr: string) {
  // Pin timeZone so SSR (UTC) and browser (AEST) agree — avoids React
  // hydration mismatch (error #418) on edge-of-day UTC timestamps.
  return new Date(dateStr).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Australia/Sydney',
  })
}

/**
 * Classify an entry's start_time relative to now for visual cues on the
 * list view. Entries that are completed/cancelled are always 'none' so we
 * don't nag users about finished work.
 */
function timingBucket(
  startTimeIso: string,
  status: string,
): 'overdue' | 'today' | 'upcoming' | 'none' {
  if (status === 'completed' || status === 'cancelled') return 'none'
  const now = new Date()
  const start = new Date(startTimeIso)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
  const sevenDays = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000)
  if (start < todayStart) return 'overdue'
  if (start < todayEnd) return 'today'
  if (start < sevenDays) return 'upcoming'
  return 'none'
}



const QUARTER_LABELS: Record<AuFyQuarter, string> = {
  Q1: 'Q1 (Jul–Sep)',
  Q2: 'Q2 (Oct–Dec)',
  Q3: 'Q3 (Jan–Mar)',
  Q4: 'Q4 (Apr–Jun)',
}

export function PmCalendarView({
  entries, sites, categories, financialYears, technicians,
  notificationRecipients, siteLocations,
  page, totalPages, viewMode, isAdmin, canWrite: canWriteRole,
}: PmCalendarViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [createOpen, setCreateOpen] = useState(false)
  const [editEntry, setEditEntry] = useState<EntryRow | null>(null)
  const [detailEntry, setDetailEntry] = useState<EntryRow | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [bucketOpen, setBucketOpen] = useState<'overdue' | 'this_week' | 'looking_ahead' | 'completed' | null>(null)
  const confirm = useConfirm()
  const toast = useToast()

  // Supervisor digest state
  const [digestBusy, setDigestBusy] = useState<'preview' | 'send' | null>(null)
  const [digestResults, setDigestResults] = useState<SupervisorRunResult[] | null>(null)
  const [digestMode, setDigestMode] = useState<'preview' | 'send' | null>(null)
  const [digestError, setDigestError] = useState<string | null>(null)

  // View toggle
  function setView(v: 'list' | 'calendar' | 'quarterly') {
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', v)
    params.delete('page')
    router.push(`/calendar?${params.toString()}`)
  }

  // Show deactivated toggle
  const showArchived = searchParams.get('show_archived') === '1'
  function toggleArchived() {
    const params = new URLSearchParams(searchParams.toString())
    if (showArchived) {
      params.delete('show_archived')
    } else {
      params.set('show_archived', '1')
    }
    params.delete('page')
    router.push(`/calendar?${params.toString()}`)
  }

  // Archive a single row (soft-delete via is_active=false)
  async function handleArchiveRow(id: string, title: string, e: React.MouseEvent) {
    e.stopPropagation()
    const ok = await confirm({
      title: `Archive "${title}"?`,
      message: 'It will be hidden from the list (use the Show Archived toggle to restore).',
      confirmLabel: 'Archive',
    })
    if (!ok) return
    const row = entries.find((entry) => entry.id === id)
    const result = await togglePmCalendarActiveAction(id, false, row?.updated_at, crypto.randomUUID())
    if (result.success) {
      analyticsEvents.archivedCheckToggled({ new_state: false })
      router.refresh()
    } else if ('stale' in result && result.stale) {
      toast.info('This entry was changed by someone else. Refreshing to show their changes.')
      router.refresh()
    } else {
      toast.error(`Error: ${result.error}`)
    }
  }

  // Drag-and-drop move handler (called from MonthGrid)
  async function handleMoveEntry(id: string, newDate: string) {
    const sourceEntry = entries.find((entry) => entry.id === id)
    const res = await movePmCalendarEntryAction(id, newDate, sourceEntry?.updated_at, crypto.randomUUID())
    if (res.success) {
      router.refresh()
      return
    }
    if ('stale' in res && res.stale) {
      // Auto-refresh on stale conflict; don't throw — MonthGrid would
      // surface a scary banner, but the right UX is silent recovery.
      router.refresh()
      return
    }
    throw new Error(res.error ?? 'Move failed.')
  }

  // CSV import handler
  const [importing, setImporting] = useState(false)
  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const parsed = parseCsv(text)
      const result = await importPmCalendarCsvAction(parsed)
      if (result.success) {
        toast.success(`Imported ${(result as { success: true; count: number }).count} entries.${(result as { success: true; skipped: number }).skipped ? ` Skipped ${(result as { success: true; skipped: number }).skipped} invalid rows.` : ''}`)
        router.refresh()
      } else {
        toast.error(`Import failed: ${result.error}`)
      }
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`)
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  // Supervisor digest handlers
  async function handlePreviewDigest() {
    setDigestBusy('preview')
    setDigestError(null)
    setDigestMode('preview')
    const res = await previewSupervisorDigestAction()
    setDigestBusy(null)
    if (res.success) {
      const results = res.results ?? []
      setDigestResults(results)
      analyticsEvents.supervisorDigestPreviewed({
        supervisor_count: results.length,
        total_entries: results.reduce((s, r) => s + r.total, 0),
        with_entries_count: results.filter((r) => r.total > 0).length,
      })
    } else {
      setDigestError(res.error ?? 'Preview failed.')
      setDigestResults(null)
    }
  }

  async function handleSendDigestNow() {
    const count = digestResults?.filter((r) => r.total > 0).length ?? null
    const msg = count != null
      ? `Send the digest email now to ${count} supervisor(s) with entries? This will log to supervisor_digests and trigger Resend.`
      : 'Send the digest email now to every supervisor in this tenant? This will log to supervisor_digests and trigger Resend.'
    const ok = await confirm({
      title: 'Send supervisor digest now?',
      message: msg,
      confirmLabel: 'Send digest',
    })
    if (!ok) return

    setDigestBusy('send')
    setDigestError(null)
    setDigestMode('send')
    const res = await sendSupervisorDigestNowAction()
    setDigestBusy(null)
    if (res.success) {
      const results = res.results ?? []
      setDigestResults(results)
      analyticsEvents.supervisorDigestSent({
        supervisor_count: results.length,
        sent_count: res.sent ?? 0,
        skipped_count: res.skipped ?? 0,
        errored_count: res.errored ?? 0,
      })
    } else {
      setDigestError(res.error ?? 'Send failed.')
      setDigestResults(null)
    }
  }

  function closeDigestPanel() {
    setDigestResults(null)
    setDigestError(null)
    setDigestMode(null)
  }

  // Seed data handler
  async function handleSeed() {
    const ok = await confirm({
      title: 'Seed PM calendar?',
      message: 'This will seed ~100 PM calendar entries for the 2025-2026 FY.',
      confirmLabel: 'Seed entries',
    })
    if (!ok) return
    setSeeding(true)
    setSeedMsg(null)
    const result = await seedPmCalendarAction()
    setSeeding(false)
    if (result.success) {
      setSeedMsg((result as { success: true; message: string }).message ?? 'Seeded successfully')
      router.refresh()
    } else {
      setSeedMsg(`Error: ${result.error}`)
    }
  }

  // ===== QUARTERLY SUMMARY =====
  const quarterlySummary = useMemo(() => {
    const summary: Record<string, Record<string, { count: number }>> = {}
    for (const e of entries) {
      const q = e.quarter ?? 'Unknown'
      const site = e.site_name
      if (!summary[q]) summary[q] = {}
      if (!summary[q][site]) summary[q][site] = { count: 0 }
      summary[q][site].count += 1
    }
    return summary
  }, [entries])

  // Filter options
  const siteOptions = sites.map((s) => ({ value: s.id, label: formatSiteLabel(s) }))
  const categoryOptions = categories.map((c) => ({ value: c, label: c }))
  const quarterOptions = [
    { value: 'Q1', label: 'Q1 (Jul–Sep)' },
    { value: 'Q2', label: 'Q2 (Oct–Dec)' },
    { value: 'Q3', label: 'Q3 (Jan–Mar)' },
    { value: 'Q4', label: 'Q4 (Apr–Jun)' },
  ]
  // FY options kept for data but removed from UI filters per Item 8
  const _fyOptions = financialYears.map((fy) => ({ value: fy, label: `FY ${fy}` }))
  const statusOptions = [
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ]

  // ===== TABLE COLUMNS (all sortable by default) =====
  const columns: DataTableColumn<EntryRow>[] = [
    {
      key: 'site_name',
      header: 'Site',
      render: (row) => <span className="font-medium text-eq-ink text-xs">{row.site_name}</span>,
    },
    {
      key: 'title',
      header: 'Title',
      render: (row) => <span className="font-medium text-eq-ink">{row.title}</span>,
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => <CategoryBadge category={row.category} />,
    },
    {
      key: 'start_time',
      header: 'Start',
      render: (row) => {
        const bucket = timingBucket(row.start_time, row.status)
        const cls =
          bucket === 'overdue' ? 'text-red-600 font-semibold'
          : bucket === 'today' ? 'text-amber-600 font-semibold'
          : bucket === 'upcoming' ? 'text-eq-deep'
          : ''
        return (
          <span className={`text-xs ${cls}`}>
            {formatDate(row.start_time)}
            {bucket === 'overdue' && <span className="ml-1.5 text-[10px] uppercase">overdue</span>}
            {bucket === 'today' && <span className="ml-1.5 text-[10px] uppercase">today</span>}
          </span>
        )
      },
      sortAccessor: (row) => new Date(row.start_time).getTime(),
    },
    {
      key: 'quarter',
      header: 'Quarter',
      render: (row) => <span className="text-xs">{row.quarter ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge status={statusToBadge(row.status)} label={row.status.replace('_', ' ')} />,
    },
    ...(canWriteRole
      ? [{
          key: '__actions',
          header: 'Actions',
          sortable: false as const,
          className: 'w-20',
          render: (row: EntryRow) => (
            <button
              onClick={(e) => handleArchiveRow(row.id, row.title, e)}
              className="inline-flex items-center gap-1 text-xs text-eq-grey hover:text-red-600"
              title="Archive (soft-delete)"
            >
              <Archive className="w-3.5 h-3.5" />
              Archive
            </button>
          ),
        }]
      : []),
  ]

  // CSV export rows
  const csvRows = entries.map((e) => ({
    site: e.site_name,
    title: e.title,
    location: e.location ?? '',
    description: e.description ?? '',
    category: e.category,
    start_time: e.start_time,
    end_time: e.end_time ?? '',
    quarter: e.quarter ?? '',
    financial_year: e.financial_year ?? '',
    status: e.status,
  }))
  const csvHeaders = [
    { key: 'site' as const, label: 'Site' },
    { key: 'title' as const, label: 'Title' },
    { key: 'location' as const, label: 'Location' },
    { key: 'description' as const, label: 'Description' },
    { key: 'category' as const, label: 'Category' },
    { key: 'start_time' as const, label: 'Start' },
    { key: 'end_time' as const, label: 'End' },
    { key: 'quarter' as const, label: 'Quarter' },
    { key: 'status' as const, label: 'Status' },
  ]

  // ===== TIMING ROLLUP — drives the top-of-page status strip =====
  // Sprint 4.2 (26-Apr): give site teams a single glance at "what should I be
  // worrying about" before they dig into months. Uses the same timingBucket
  // classifier as the list view so the numbers match across views.
  const timingBuckets = useMemo(() => {
    const overdue: EntryRow[] = []
    const thisWeek: EntryRow[] = []
    const lookingAhead: EntryRow[] = []
    const completed: EntryRow[] = []
    for (const e of entries) {
      if (e.status === 'completed') {
        completed.push(e)
        continue
      }
      const b = timingBucket(e.start_time, e.status)
      if (b === 'overdue') overdue.push(e)
      else if (b === 'today' || b === 'upcoming') thisWeek.push(e)
      else lookingAhead.push(e)
    }
    return { overdue, thisWeek, lookingAhead, completed }
  }, [entries])
  const timingCounts = {
    overdue: timingBuckets.overdue.length,
    thisWeek: timingBuckets.thisWeek.length,
    lookingAhead: timingBuckets.lookingAhead.length,
    completed: timingBuckets.completed.length,
  }

  return (
    <>
      {/* Status strip — overdue / due this week / upcoming / completed.
          Sits above the toolbar so the most important number is the first
          thing the user sees on the page. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatusStripCard
          label="Overdue"
          count={timingCounts.overdue}
          tone="red"
          hint="Past due, not completed"
          onClick={() => setBucketOpen('overdue')}
        />
        <StatusStripCard
          label="This Week"
          count={timingCounts.thisWeek}
          tone="amber"
          hint="Due in the next 7 days"
          onClick={() => setBucketOpen('this_week')}
        />
        <StatusStripCard
          label="Looking Ahead"
          count={timingCounts.lookingAhead}
          tone="blue"
          hint="Beyond next week"
          onClick={() => setBucketOpen('looking_ahead')}
        />
        <StatusStripCard
          label="Completed"
          count={timingCounts.completed}
          tone="green"
          hint="Already done"
          onClick={() => setBucketOpen('completed')}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SearchFilter
            placeholder="Search entries..."
            filters={[
              { key: 'site', label: 'All Sites', options: siteOptions },
              { key: 'category', label: 'All Categories', options: categoryOptions },
              { key: 'quarter', label: 'All Quarters', options: quarterOptions },
              { key: 'status', label: 'All Statuses', options: statusOptions },
            ]}
          />
          <div className="flex items-center gap-2 ml-4 shrink-0">
            {/* View toggle */}
            <div className="flex items-center border border-gray-200 rounded-md overflow-hidden">
              <button
                onClick={() => setView('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-eq-sky text-white' : 'text-eq-grey hover:bg-gray-50'}`}
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView('calendar')}
                className={`p-2 ${viewMode === 'calendar' ? 'bg-eq-sky text-white' : 'text-eq-grey hover:bg-gray-50'}`}
                title="Calendar view"
              >
                <CalendarDays className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView('quarterly')}
                className={`p-2 ${viewMode === 'quarterly' ? 'bg-eq-sky text-white' : 'text-eq-grey hover:bg-gray-50'}`}
                title="Quarterly summary"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={toggleArchived}
              className={`inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border transition-colors ${
                showArchived
                  ? 'border-eq-sky bg-eq-ice text-eq-deep'
                  : 'border-gray-200 bg-white text-eq-grey hover:bg-gray-50'
              }`}
              title={showArchived ? 'Hide deactivated checks' : 'Show deactivated checks'}
            >
              <Archive className="w-3.5 h-3.5 mr-1" />
              {showArchived ? 'Hide Archived' : 'Show Archived'}
            </button>
            {isAdmin && entries.length === 0 && (
              <Button variant="secondary" size="sm" onClick={handleSeed} loading={seeding}>
                Seed Data
              </Button>
            )}
            {isAdmin && (
              <>
                <button
                  onClick={handlePreviewDigest}
                  disabled={digestBusy !== null}
                  className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border border-gray-200 bg-white text-eq-ink hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Preview who'd receive the digest right now (no email sent)"
                >
                  {digestBusy === 'preview'
                    ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    : <Eye className="w-3.5 h-3.5 mr-1" />}
                  Preview Digest
                </button>
                <button
                  onClick={handleSendDigestNow}
                  disabled={digestBusy !== null}
                  className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border border-eq-sky bg-eq-ice text-eq-deep hover:bg-eq-sky/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Send the supervisor digest now"
                >
                  {digestBusy === 'send'
                    ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    : <Mail className="w-3.5 h-3.5 mr-1" />}
                  Send Digest Now
                </button>
                {entries.length > 0 && (
                  <button
                    onClick={() => setClearOpen(true)}
                    className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                    title="Soft-delete every entry currently shown by your filters"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Clear filtered ({entries.length})
                  </button>
                )}
              </>
            )}
            {canWriteRole && (
              <label className="inline-flex items-center">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleCsvImport}
                  disabled={importing}
                />
                <span className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border border-gray-200 bg-white text-eq-ink hover:bg-gray-50 cursor-pointer">
                  {importing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
                  Import
                </span>
              </label>
            )}
            <CsvExportButton
              filename={`calendar-${new Date().toISOString().slice(0, 10)}`}
              rows={csvRows}
              headers={csvHeaders}
            />
            {canWriteRole && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>Add Entry</Button>
            )}
          </div>
        </div>
        {seedMsg && <p className={`text-sm ${seedMsg.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{seedMsg}</p>}
        {digestError && (
          <div className="flex items-start justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-700">{digestError}</p>
            <button onClick={closeDigestPanel} className="text-xs text-red-600 hover:text-red-800 shrink-0">Dismiss</button>
          </div>
        )}
        {digestResults && (
          <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-eq-sky/5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-eq-deep" />
                <h3 className="text-sm font-semibold text-eq-ink">
                  Supervisor digest — {digestMode === 'preview' ? 'Preview' : 'Sent'}
                </h3>
                <span className="text-xs text-eq-grey">
                  {digestResults.length} supervisor{digestResults.length === 1 ? '' : 's'}
                </span>
              </div>
              <button onClick={closeDigestPanel} className="text-xs text-eq-grey hover:text-eq-ink">Close</button>
            </div>
            {digestResults.length === 0 ? (
              <p className="px-4 py-6 text-sm text-eq-grey italic">
                No active supervisors found in this tenant. Assign a user the supervisor, admin, or super_admin role to enable the digest.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-eq-grey border-b border-gray-100">
                    <th className="px-4 py-2">Supervisor</th>
                    <th className="px-4 py-2 text-right">Overdue</th>
                    <th className="px-4 py-2 text-right">Today</th>
                    <th className="px-4 py-2 text-right">This week</th>
                    <th className="px-4 py-2 text-right">Next 7–14</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {digestResults.map((r) => (
                    <tr key={`${r.tenantId}-${r.supervisorUserId}`} className="border-b border-gray-50">
                      <td className="px-4 py-2">
                        <div className="font-medium text-eq-ink text-xs">{r.supervisorName ?? r.supervisorEmail}</div>
                        {r.supervisorName && (
                          <div className="text-[11px] text-eq-grey">{r.supervisorEmail}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-xs">
                        {r.overdue > 0 ? <span className="text-red-600 font-semibold">{r.overdue}</span> : r.overdue}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-xs">
                        {r.today > 0 ? <span className="text-amber-600 font-semibold">{r.today}</span> : r.today}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-xs">{r.thisWeek}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-xs">{r.nextWeek}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-xs font-semibold">{r.total}</td>
                      <td className="px-4 py-2">
                        <DigestStatusBadge status={r.status} error={r.error} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-[11px] text-eq-grey">
              {digestMode === 'preview'
                ? 'Preview only — no emails sent, no audit row written.'
                : 'Send complete — audit rows are in supervisor_digests.'}
            </div>
          </div>
        )}
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-6 px-4 py-3 bg-white border border-gray-200 rounded-lg">
        <div className="text-sm"><span className="text-eq-grey">Entries:</span> <span className="font-semibold text-eq-ink">{entries.length}</span></div>
      </div>

      {/* ===== LIST VIEW ===== */}
      {viewMode === 'list' && (
        entries.length === 0 ? (
          <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
            <p className="text-eq-grey text-sm mb-3">No PM calendar entries yet.</p>
            {canWriteRole && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>Add your first entry</Button>
            )}
          </div>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={entries}
              emptyMessage="No entries match your filters."
              onRowClick={(row) => setDetailEntry(row)}
            />
            <Pagination page={page} totalPages={totalPages} />
          </>
        )
      )}

      {/* ===== CALENDAR VIEW (Outlook-style month grid) ===== */}
      {viewMode === 'calendar' && (
        <MonthGrid
          entries={entries}
          onEntryClick={(e) => setDetailEntry(e as EntryRow)}
          onMoveEntry={canWriteRole ? handleMoveEntry : undefined}
        />
      )}

      {/* ===== QUARTERLY VIEW ===== */}
      {viewMode === 'quarterly' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {(['Q1', 'Q2', 'Q3', 'Q4'] as AuFyQuarter[]).map((q) => {
            const siteSummaries = quarterlySummary[q] ?? {}
            const siteKeys = Object.keys(siteSummaries).sort()
            const qCount = siteKeys.reduce((s, k) => s + siteSummaries[k].count, 0)

            return (
              <div key={q} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                <div className="px-4 py-3 bg-eq-sky/5 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-bold text-eq-ink">{QUARTER_LABELS[q]}</h3>
                  <div className="flex items-center gap-4 text-xs text-eq-grey">
                    <span>{qCount} tasks</span>
                  </div>
                </div>
                <div className="p-4">
                  {siteKeys.length === 0 ? (
                    <p className="text-sm text-eq-grey italic">No entries</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-eq-grey border-b border-gray-100">
                          <th className="pb-2">Site</th>
                          <th className="pb-2 text-right">Tasks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {siteKeys.map((site) => (
                          <tr key={site} className="border-b border-gray-50">
                            <td className="py-1.5 font-medium text-eq-ink text-xs">{site}</td>
                            <td className="py-1.5 text-right tabular-nums text-xs">{siteSummaries[site].count}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-semibold text-eq-ink">
                          <td className="pt-2 text-xs">Total</td>
                          <td className="pt-2 text-right tabular-nums text-xs">{qCount}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create/Edit Form */}
      <PmCalendarForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        sites={sites}
        categories={categories}
        technicians={technicians}
        notificationRecipients={notificationRecipients}
        siteLocations={siteLocations}
      />

      {editEntry && (
        <PmCalendarForm
          open={!!editEntry}
          onClose={() => setEditEntry(null)}
          entry={editEntry}
          sites={sites}
          categories={categories}
          technicians={technicians}
          notificationRecipients={notificationRecipients}
          siteLocations={siteLocations}
        />
      )}

      {/* Detail View */}
      {detailEntry && (
        <PmCalendarDetail
          open={!!detailEntry}
          onClose={() => setDetailEntry(null)}
          entry={detailEntry}
          isAdmin={isAdmin}
          canWrite={canWriteRole}
          onEdit={() => { setEditEntry(detailEntry); setDetailEntry(null) }}
          site={detailEntry.site_id ? sites.find((s) => s.id === detailEntry.site_id) : null}
        />
      )}

      {/* Clear Filtered (admin-only, danger) */}
      <ClearFilteredDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        ids={entries.map((e) => e.id)}
        filterSummary={buildFilterSummary(searchParams, sites, isAdmin && showArchived)}
      />

      {/* KPI Bucket drawers — open when a top-of-page tile is clicked */}
      <KpiBucketDrawer
        open={bucketOpen === 'overdue'}
        onClose={() => setBucketOpen(null)}
        label="Overdue"
        description="Entries past their start time that haven't been marked completed."
        entries={timingBuckets.overdue}
        onEntryClick={(e) => { setBucketOpen(null); setDetailEntry(e as EntryRow) }}
      />
      <KpiBucketDrawer
        open={bucketOpen === 'this_week'}
        onClose={() => setBucketOpen(null)}
        label="This Week"
        description="Entries scheduled today or in the next 7 days."
        entries={timingBuckets.thisWeek}
        onEntryClick={(e) => { setBucketOpen(null); setDetailEntry(e as EntryRow) }}
      />
      <KpiBucketDrawer
        open={bucketOpen === 'looking_ahead'}
        onClose={() => setBucketOpen(null)}
        label="Looking Ahead"
        description="Entries scheduled beyond the next 7 days."
        entries={timingBuckets.lookingAhead}
        onEntryClick={(e) => { setBucketOpen(null); setDetailEntry(e as EntryRow) }}
      />
      <KpiBucketDrawer
        open={bucketOpen === 'completed'}
        onClose={() => setBucketOpen(null)}
        label="Completed"
        description="Entries marked as completed."
        entries={timingBuckets.completed}
        onEntryClick={(e) => { setBucketOpen(null); setDetailEntry(e as EntryRow) }}
      />
    </>
  )
}

function buildFilterSummary(
  searchParams: ReturnType<typeof useSearchParams>,
  sites: SiteOption[],
  showArchivedActive: boolean,
): string {
  const parts: string[] = []
  const search = searchParams.get('search')
  const siteId = searchParams.get('site')
  const category = searchParams.get('category')
  const quarter = searchParams.get('quarter')
  const status = searchParams.get('status')

  if (search) parts.push(`search "${search}"`)
  if (siteId) {
    const site = sites.find((s) => s.id === siteId)
    parts.push(`site ${site ? formatSiteLabel(site) : siteId}`)
  }
  if (category) parts.push(`category ${category}`)
  if (quarter) parts.push(`quarter ${quarter}`)
  if (status) parts.push(`status ${status}`)
  if (showArchivedActive) parts.push('including archived')

  return parts.length === 0 ? 'All entries (no filters applied).' : parts.join(' · ')
}
