'use client'

import { useState, useMemo, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  startCheckAction,
  completeCheckAction,
  archiveCheckAction,
  updateCheckItemAction,
  forceCompleteCheckAssetAction,
  bulkUpdateWorkOrdersAction,
  updateCheckAssetAction,
  completeAllCheckAssetsAction,
  batchForceCompleteAssetsAction,
  updateCheckItemResultAction,
  reopenCheckAction,
} from '../actions'
import { formatDate } from '@/lib/utils/format'
import { AttachmentList } from '@/components/ui/AttachmentList'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'

/**
 * Thresholds for the check-page progressive-disclosure pattern.
 * Below the threshold the section stays expanded on first render (small
 * enough to scan at a glance). At or above, it starts collapsed and the
 * tech taps to expand. Picked from Royce's 2026-05-14 review — the asset
 * table threshold matters most because Jemena boards routinely carry 40+
 * assets per check.
 */
const ASSET_TABLE_COLLAPSE_THRESHOLD = 10
const ATTACHMENTS_COLLAPSE_THRESHOLD = 5
import type { MaintenanceCheck, MaintenanceCheckItem, CheckAsset, CheckStatus, CheckItemResult, Attachment } from '@/lib/types'
import { CheckCircle, XCircle, MinusCircle, Download, ChevronDown, ChevronRight, ClipboardPaste, CheckCheck, ArrowLeft, Send } from 'lucide-react'
import Link from 'next/link'
import { events as analyticsEvents } from '@/lib/analytics'
import { SendReportModal } from './SendReportModal'
import { ReportDownloadDialog } from '@/components/ui/ReportDownloadDialog'
import type { ReportComplexity } from '@/components/ui/ReportDownloadDialog'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { PrintBlankButton } from './components/PrintBlankButton'
import { PrintReportSplit } from './components/PrintReportSplit'

interface CheckAssetWithDetails extends CheckAsset {
  assets?: { name: string; maximo_id: string | null; location: string | null; job_plans?: { name: string } | null } | null
}

interface CheckDetailPageProps {
  check: MaintenanceCheck & {
    job_plans?: { name: string } | null
    sites?: { name: string } | null
    assignee_name?: string | null
  }
  items: MaintenanceCheckItem[]
  checkAssets: CheckAssetWithDetails[]
  attachments: Attachment[]
  isAdmin: boolean
  canWrite: boolean
  isAssigned: boolean
  /**
   * True if the current user's role is technician. Used to re-shape the
   * action buttons on a `complete` check so the primary CTA is "Back to
   * my checks" instead of "Customer Report" (UX audit PR #149 §2 / §B.14).
   */
  isTechnician?: boolean
}

type SortKey = 'maximo_id' | 'name' | 'location' | 'work_order' | 'job_plan' | 'completed' | 'notes'
type SortDir = 'asc' | 'desc'

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

export function CheckDetailPage({ check, items, checkAssets, attachments, isAdmin, canWrite: canWriteRole, isAssigned, isTechnician = false }: CheckDetailPageProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [forceCompletePending, startForceCompleteTransition] = useTransition()
  // PR G remainder (UX audit §A.13 / §3.4): client-side override for the
  // status, used to route item updates through the in_progress branch
  // immediately after auto-start. router.refresh() picks up the real
  // server-side status one cycle later — this just smooths the gap so the
  // second tap doesn't trip a re-start.
  const [localStatus, setLocalStatus] = useState<CheckStatus>(check.status)
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('maximo_id')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filterText, setFilterText] = useState('')
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
  const [showSendReport, setShowSendReport] = useState(false)
  const [showReportDialog, setShowReportDialog] = useState(false)
  const confirm = useConfirm()

  async function handleDownloadReport(complexity: ReportComplexity) {
    const res = await fetch(`/api/pm-asset-report?check_id=${check.id}&complexity=${complexity}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Download failed' }))
      setError(err.error ?? 'Report generation failed')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const disposition = res.headers.get('Content-Disposition')
    const match = disposition?.match(/filename="(.+?)"/)
    a.download = match?.[1] ?? 'PM Asset Report.docx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    analyticsEvents.reportGenerated({
      report_type: `pm_asset_${complexity}`,
      asset_count: checkAssets.length,
    })
  }

  const canAct = canWriteRole || isAssigned

  // Sort logic
  const sortedAssets = useMemo(() => {
    const arr = [...checkAssets]
    arr.sort((a, b) => {
      let aVal = ''
      let bVal = ''
      const aAsset = a.assets
      const bAsset = b.assets

      switch (sortKey) {
        case 'maximo_id': aVal = aAsset?.maximo_id ?? ''; bVal = bAsset?.maximo_id ?? ''; break
        case 'name': aVal = aAsset?.name ?? ''; bVal = bAsset?.name ?? ''; break
        case 'location': aVal = aAsset?.location ?? ''; bVal = bAsset?.location ?? ''; break
        case 'work_order': aVal = a.work_order_number ?? ''; bVal = b.work_order_number ?? ''; break
        case 'job_plan': aVal = (aAsset?.job_plans as { name: string } | null)?.name ?? ''; bVal = (bAsset?.job_plans as { name: string } | null)?.name ?? ''; break
        case 'completed': {
          const aDone = items.filter(i => i.check_asset_id === a.id && i.result !== null).length
          const bDone = items.filter(i => i.check_asset_id === b.id && i.result !== null).length
          return sortDir === 'asc' ? aDone - bDone : bDone - aDone
        }
        case 'notes': aVal = a.notes ?? ''; bVal = b.notes ?? ''; break
      }
      const cmp = aVal.localeCompare(bVal, undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [checkAssets, items, sortKey, sortDir])

  // Free-text filter on asset name + Maximo ID. Case-insensitive substring
  // match. Royce 2026-04-28: scanning a 100-row table by eye is painful.
  const displayedAssets = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    if (!q) return sortedAssets
    return sortedAssets.filter((ca) => {
      const a = ca.assets
      const name = (a?.name ?? '').toLowerCase()
      const mx = (a?.maximo_id ?? '').toLowerCase()
      const loc = (a?.location ?? '').toLowerCase()
      return name.includes(q) || mx.includes(q) || loc.includes(q)
    })
  }, [sortedAssets, filterText])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  function toggleAssetSelection(assetId: string) {
    const newSelected = new Set(selectedAssetIds)
    if (newSelected.has(assetId)) {
      newSelected.delete(assetId)
    } else {
      newSelected.add(assetId)
    }
    setSelectedAssetIds(newSelected)
  }

  function toggleAllAssets(checked: boolean) {
    if (checked) {
      // Select only what's currently visible (filter-respecting), so the
      // header checkbox + Complete N Selected works on the filtered view.
      setSelectedAssetIds(new Set(displayedAssets.map(a => a.id)))
    } else {
      setSelectedAssetIds(new Set())
    }
  }

  // Actions
  async function handleStart() {
    setError(null); setLoading(true)
    const result = await startCheckAction(check.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to start.')
  }

  /**
   * Re-open a completed check so the user can amend results, add notes,
   * or attach follow-up work orders. Single confirm — no reason field
   * (per Royce 26-Apr decision). Audit log captures who + when.
   */
  async function handleReopen() {
    const ok = await confirm({
      title: 'Re-open this completed check?',
      message: 'The change will be audit-logged. Any subsequent edits will appear as an amendment on the next-generated report.',
      confirmLabel: 'Re-open',
    })
    if (!ok) return
    setError(null); setLoading(true)
    const result = await reopenCheckAction(check.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to re-open.')
  }

  async function handleComplete() {
    setError(null); setLoading(true)
    const result = await completeCheckAction(check.id)
    setLoading(false)
    if (!result.success) {
      setError(result.error ?? 'Failed to complete.')
      return
    }
    const startedMs = check.started_at ? new Date(check.started_at).getTime() : null
    const durationSeconds = startedMs ? Math.max(0, Math.round((Date.now() - startedMs) / 1000)) : 0
    const defectsFound = items.filter((i) => i.result === 'fail').length
    analyticsEvents.checkCompleted({
      check_type: check.job_plans?.name ?? 'general',
      duration_seconds: durationSeconds,
      defects_found: defectsFound,
    })
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${check.custom_name ?? 'this check'}"?`,
      message: 'It will be removed from all views. You can restore it from Admin → Archive.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    setError(null); setLoading(true)
    const result = await archiveCheckAction(check.id, false)
    if (!result.success) {
      setLoading(false)
      setError(result.error ?? 'Failed to delete.')
      return
    }
    // Success: leave the now-archived check behind and return to the list.
    // We intentionally don't clear `loading` first — the button stays
    // disabled while the navigation transitions so a double-click can't
    // re-fire archiveCheckAction. router.push handles unmount cleanup.
    router.push('/maintenance')
  }

  function handleForceComplete(checkAssetId: string) {
    if (forceCompletePending) return
    setError(null)
    startForceCompleteTransition(async () => {
      const result = await forceCompleteCheckAssetAction(check.id, checkAssetId)
      if (!result.success) {
        setError(result.error ?? 'Failed to force complete.')
        return
      }
      // revalidatePath() server-side won't push new data through to this
      // client view on its own — without router.refresh the AssetRow stays
      // visually un-ticked until the next navigation.
      router.refresh()
    })
  }

  async function handleCompleteAll() {
    const ok = await confirm({
      title: 'Complete all assets?',
      message: 'Mark ALL assets and their tasks as complete. This cannot be undone.',
      confirmLabel: 'Complete all',
    })
    if (!ok) return
    setError(null); setLoading(true)
    const result = await completeAllCheckAssetsAction(check.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Failed to complete all assets.')
  }

  async function handleBatchComplete() {
    const selectedIds = Array.from(selectedAssetIds)
    if (selectedIds.length === 0) return
    const ok = await confirm({
      title: 'Complete selected assets?',
      message: `Mark ${selectedIds.length} selected asset(s) and their tasks as complete. This cannot be undone.`,
      confirmLabel: 'Complete selected',
    })
    if (!ok) return
    setError(null); setLoading(true)
    const result = await batchForceCompleteAssetsAction(check.id, selectedIds)
    setLoading(false)
    if (result.success) {
      setSelectedAssetIds(new Set())
    } else {
      setError(result.error ?? 'Failed to complete selected assets.')
    }
  }

  async function handleItemResult(itemId: string, result: CheckItemResult | null) {
    setError(null)
    const item = items.find(i => i.id === itemId)
    if (!item) return

    // PR G remainder (UX audit §A.13 / §3.4): auto-start the check on first
    // tap of a result button when the check is still 'scheduled' or
    // 'overdue'. Field reality: techs open a check, start tapping pass/fail,
    // then get rejected because they forgot the Start Check button at the
    // top. Removing that gate by promoting the *real* intent — they're
    // working the check — is the right ergonomic. Audit log captures the
    // start via startCheckAction, so we don't lose the timestamp.
    let effectiveStatus = localStatus
    if (effectiveStatus === 'scheduled' || effectiveStatus === 'overdue') {
      const startResult = await startCheckAction(check.id)
      if (!startResult.success) {
        setError(startResult.error ?? 'Failed to auto-start the check. Try the Start Check button.')
        return
      }
      // Track locally so subsequent taps don't try to re-start. router.refresh
      // below pulls the real server-side status into the prop one tick later.
      setLocalStatus('in_progress')
      effectiveStatus = 'in_progress'
      router.refresh()
    }

    // Both branches read the action result. The in_progress branch used to
    // discard it — silent failures would leave the optimistic TaskRow dot
    // pressed while the DB hadn't actually written. Audit 2026-05-13.
    if (effectiveStatus === 'in_progress') {
      const formData = new FormData()
      formData.set('result', result ?? '')
      const resultValue = await updateCheckItemAction(check.id, itemId, formData)
      if (!resultValue?.success) {
        setError(resultValue?.error ?? 'Failed to update task result.')
      }
    } else {
      // For completed assets (after force-complete), allow result changes
      const resultValue = await updateCheckItemResultAction(check.id, itemId, result)
      if (!resultValue.success) {
        setError(resultValue.error ?? 'Failed to update task result.')
      }
    }
  }

  async function handleItemNotes(itemId: string, notes: string) {
    setError(null)
    const item = items.find(i => i.id === itemId)
    if (!item) return

    if (check.status === 'in_progress') {
      const formData = new FormData()
      formData.set('result', item.result ?? '')
      formData.set('notes', notes)
      const resultValue = await updateCheckItemAction(check.id, itemId, formData)
      if (!resultValue?.success) {
        setError(resultValue?.error ?? 'Failed to update task comments.')
      }
    } else {
      // For completed assets, use new action
      const resultValue = await updateCheckItemResultAction(check.id, itemId, item.result ?? null, notes)
      if (!resultValue.success) {
        setError(resultValue.error ?? 'Failed to update task comments.')
      }
    }
  }

  const handleAssetNote = useCallback(async (checkAssetId: string, notes: string) => {
    const result = await updateCheckAssetAction(check.id, checkAssetId, { notes })
    if (!result?.success) {
      setError(result?.error ?? 'Failed to save asset note.')
    }
  }, [check.id])

  const handleAssetWO = useCallback(async (checkAssetId: string, wo: string) => {
    const result = await updateCheckAssetAction(check.id, checkAssetId, { work_order_number: wo })
    if (!result?.success) {
      setError(result?.error ?? 'Failed to save WO number.')
    }
  }, [check.id])

  // Paste WO numbers from Excel
  async function handlePasteWOs() {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return

    const updates: { checkAssetId: string; workOrderNumber: string }[] = []
    for (let i = 0; i < Math.min(lines.length, sortedAssets.length); i++) {
      updates.push({ checkAssetId: sortedAssets[i].id, workOrderNumber: lines[i] })
    }

    setLoading(true)
    const result = await bulkUpdateWorkOrdersAction(check.id, updates)
    setLoading(false)
    if (!result.success) {
      setError(result.error ?? 'Failed to paste WO numbers.')
      return
    }
    // Server reports per-row outcomes. If anything failed, keep the modal
    // open and surface the count so the tech knows the paste was partial.
    const failedCount = result.failed?.length ?? 0
    if (failedCount > 0) {
      setError(`Applied ${result.updated} of ${updates.length} WOs — ${failedCount} failed (likely permissions or invalid row). Modal stays open so you can retry.`)
      return
    }
    setShowPasteModal(false)
    setPasteText('')
  }

  const completedCount = items.filter(i => i.result !== null).length
  const totalCount = items.length
  const completedAssets = checkAssets.filter(ca => ca.status === 'completed').length
  const requiredIncomplete = items.filter(i => i.is_required && i.result === null).length

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex items-start justify-between gap-4 bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <StatusBadge status={statusToBadge(check.status)} />
            <span className="text-sm text-eq-grey">{completedCount}/{totalCount} tasks done</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Site</dt>
              <dd className="text-eq-ink mt-1">{check.sites?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Due Date</dt>
              <dd className="text-eq-ink mt-1">{formatDate(check.due_date)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Assigned To</dt>
              <dd className="text-eq-ink mt-1">{check.assignee_name ?? 'Unassigned'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Frequency</dt>
              <dd className="text-eq-ink mt-1">
                {check.frequency ? check.frequency.replace('_', '-').replace(/\b\w/g, c => c.toUpperCase()) : '—'}
              </dd>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap shrink-0">
          {(check.status === 'scheduled' || check.status === 'overdue') && canAct && (
            <Button size="sm" onClick={handleStart} loading={loading}>Start Check</Button>
          )}
          {check.status === 'in_progress' && canAct && (
            <>
              {/* "Complete All Assets" is the bulk-pass button — only meaningful
                  for kind=maintenance (PPM) checks where each asset has a fixed
                  task list. ACB/NSX/RCD assets are multi-step test workflows,
                  not bulk-passable. Hidden on those kinds (Royce 2026-04-28). */}
              {(check as { kind?: string | null }).kind !== 'acb' &&
               (check as { kind?: string | null }).kind !== 'nsx' &&
               (check as { kind?: string | null }).kind !== 'rcd' && (
                <Button size="sm" onClick={handleCompleteAll} loading={loading}>
                  <CheckCheck className="w-4 h-4 mr-1" /> Complete All Assets
                </Button>
              )}
              {/* Complete Check + inline disabled-reason. The previous
                  pattern hid the reason in a `title=` tooltip which doesn't
                  fire on touch (UX audit §2.10 / §B.9). Inline amber text
                  works on every screen, every input modality. */}
              <Button size="sm" onClick={handleComplete} loading={loading} disabled={requiredIncomplete > 0}>
                Complete Check
              </Button>
              {requiredIncomplete > 0 && (
                <span className="self-center text-xs text-amber-700 font-medium">
                  {requiredIncomplete} required {requiredIncomplete === 1 ? 'task' : 'tasks'} remaining
                </span>
              )}
            </>
          )}
          {check.status === 'complete' && (
            <>
              {/* For techs, the primary "I'm done" affordance is to go back
                  to their assigned-checks list — not to download a customer-
                  facing PDF (which is admin / supervisor work). Customer
                  Report demoted to a secondary text button. UX audit §2 /
                  §B.14 (locked 2026-05-18). */}
              {isTechnician && (
                <Link
                  href="/maintenance?view=mine"
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-eq-sky text-white rounded hover:bg-eq-deep transition-colors"
                >
                  &larr; Back to my checks
                </Link>
              )}
              {/* Relabelled 26-Apr-2026 (audit item 9): the customer-facing
                  PDF (cover page, sign-off, asset breakdown). Distinct from
                  the Field Run-Sheet, which is the tech's clipboard print. */}
              <button
                onClick={() => setShowReportDialog(true)}
                title="Customer-facing PDF — full report with cover page and sign-off block"
                className={isTechnician
                  ? "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-eq-deep border border-eq-sky/30 rounded hover:bg-eq-ice transition-colors"
                  : "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-eq-sky text-white rounded hover:bg-eq-deep transition-colors"
                }>
                <Download className="w-4 h-4" /> Customer Report
              </button>
              <button
                onClick={() => setShowSendReport(true)}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-eq-deep text-white rounded hover:bg-eq-ink transition-colors">
                <Send className="w-4 h-4" /> Send Report
              </button>
              {/* Re-open is also offered on completed checks so techs can add
                  WOs/notes after handover. Per Royce 26-Apr — single confirm,
                  no reason field, audit-logged. */}
              {canAct && (
                <Button size="sm" variant="secondary" onClick={handleReopen} loading={loading}
                  title="Re-open this check to add notes, work orders, or amend results. Audit-logged.">
                  Re-open
                </Button>
              )}
              {/* Print Report is now available on completed checks too — was
                  scheduled/in_progress only before, which surprised users
                  during testing. */}
              {canWriteRole && (
                <>
                  <PrintBlankButton checkId={check.id} />
                  <PrintReportSplit checkId={check.id} />
                </>
              )}
            </>
          )}
          {(check.status === 'scheduled' || check.status === 'in_progress' || check.status === 'overdue') && canWriteRole && (
            <>
              <PrintBlankButton checkId={check.id} />
              <PrintReportSplit checkId={check.id} />
            </>
          )}
          {isAdmin && (
            <Button size="sm" variant="danger" onClick={handleDelete} loading={loading}>Delete</Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-500 bg-red-50 px-4 py-2 rounded-lg">{error}</p>}

      {/* Paste WO modal */}
      {showPasteModal && (
        <div className="border border-eq-sky/30 rounded-lg bg-eq-ice/30 p-4 space-y-3">
          <h4 className="text-xs font-bold text-eq-grey uppercase">Paste Work Order Numbers</h4>
          <p className="text-xs text-eq-grey">Paste a column from Excel — one WO per line. Numbers will be matched to assets in the current sort order.</p>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={6}
            placeholder="Paste here..."
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-mono text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handlePasteWOs} disabled={loading || !pasteText.trim()}>
              Apply ({pasteText.split('\n').filter(l => l.trim()).length} WOs)
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { setShowPasteModal(false); setPasteText('') }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Report download dialog */}
      <ReportDownloadDialog
        open={showReportDialog}
        onClose={() => setShowReportDialog(false)}
        onDownload={handleDownloadReport}
        title="Maintenance Report"
      />

      {/* Send Report modal */}
      {showSendReport && (
        <SendReportModal
          checkId={check.id}
          onClose={() => setShowSendReport(false)}
        />
      )}

      {/* Attachments — moved above the asset table 2026-04-28 (issue 2 in
          Royce's review). Eye lands on summary + linked tests + supporting
          docs first; the long breaker table sits at the bottom.
          Progressive-disclosure wrap added 2026-05-14: collapsed by
          default when there are more than ATTACHMENTS_COLLAPSE_THRESHOLD
          attachments (sign-off photo dumps from busy visits). When empty
          or small, stays open so the upload affordance is visible. */}
      <CollapsibleSection
        title="Attachments"
        summary={
          attachments.length === 0
            ? 'no files yet'
            : `${attachments.length} file${attachments.length === 1 ? '' : 's'}`
        }
        defaultOpen={attachments.length <= ATTACHMENTS_COLLAPSE_THRESHOLD}
      >
        <div className="p-4">
          <AttachmentList
            entityType="maintenance_check"
            entityId={check.id}
            attachments={attachments}
            canWrite={canWriteRole || isAssigned}
            isAdmin={isAdmin}
          />
        </div>
      </CollapsibleSection>

      {/* Print Blank for Onsite — promoted above the asset table for scheduled
          / in_progress checks (UX audit §A.14 / §B.13). The button lives in
          the header toolbar too, but the toolbar overflows on a phone and
          this is the moment the tech actually needs it: about to walk the
          floor with the asset list. Hidden on completed checks where the
          eyeline tool is Customer Report / Send Report. */}
      {(localStatus === 'scheduled' || localStatus === 'in_progress' || localStatus === 'overdue') && canAct && checkAssets.length > 0 && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg border border-eq-sky/30 bg-eq-ice/50">
          <div className="text-sm text-eq-ink">
            <span className="font-semibold">Heading on site?</span>{' '}
            <span className="text-eq-grey">Print a blank Field Run-Sheet so you can capture readings on the clipboard and key them in later.</span>
          </div>
          <div className="shrink-0">
            <PrintBlankButton checkId={check.id} />
          </div>
        </div>
      )}

      {/* Asset Table — full width */}
      {checkAssets.length > 0 && (
        <>
          {selectedAssetIds.size > 0 && canAct && (
            <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg mb-4">
              <span className="text-sm font-medium text-eq-ink flex-1">
                {selectedAssetIds.size} asset(s) selected
              </span>
              <Button size="sm" onClick={handleBatchComplete} loading={loading}>
                <CheckCheck className="w-4 h-4 mr-1" /> Complete {selectedAssetIds.size} Selected
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setSelectedAssetIds(new Set())}>
                Clear
              </Button>
            </div>
          )}

          <CollapsibleSection
            title="Assets"
            summary={`${completedAssets}/${checkAssets.length} completed`}
            defaultOpen={checkAssets.length <= ASSET_TABLE_COLLAPSE_THRESHOLD}
            actions={
              <>
                {/* Free-text filter (Royce 2026-04-28 — scanning a 100-row
                    table by eye is painful). Empty = all assets. */}
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Filter by name, Maximo ID, or location…"
                  className="h-8 px-2 text-sm border border-gray-200 rounded focus:outline-none focus:border-eq-deep focus:ring-1 focus:ring-eq-sky/30 w-56 max-w-[40%]"
                />
                {filterText && (
                  <span className="text-sm text-eq-grey shrink-0">
                    {displayedAssets.length}/{checkAssets.length}
                  </span>
                )}
                {canAct && (
                  <Button size="sm" variant="secondary" onClick={() => setShowPasteModal(true)}>
                    <ClipboardPaste className="w-4 h-4 mr-1" /> Paste WO #s
                  </Button>
                )}
              </>
            }
          >
          {/* Full-width table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {canAct && (
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedAssetIds.size === displayedAssets.length && displayedAssets.length > 0}
                        onChange={(e) => toggleAllAssets(e.target.checked)}
                        className="cursor-pointer"
                      />
                    </th>
                  )}
                  {([
                    ['maximo_id', 'ID', 'w-24'],
                    ['name', 'Name', ''],
                    ['location', 'Location', ''],
                    ['work_order', 'Work Order #', 'w-36'],
                    ['job_plan', 'Maintenance Plan', 'w-32'],
                    ['completed', 'Done', 'w-24'],
                    ['notes', 'Notes', 'w-40'],
                  ] as [SortKey, string, string][]).map(([key, label, width]) => (
                    <th key={key}
                      onClick={() => toggleSort(key)}
                      className={`px-4 py-2.5 text-left text-xs font-bold text-eq-grey uppercase cursor-pointer hover:text-eq-ink transition-colors select-none ${width}`}
                    >
                      {label}{sortIndicator(key)}
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayedAssets.map(ca => (
                  <AssetRow
                    key={ca.id}
                    ca={ca}
                    items={items.filter(i => i.check_asset_id === ca.id)}
                    isExpanded={expandedAssetId === ca.id}
                    onToggle={() => setExpandedAssetId(expandedAssetId === ca.id ? null : ca.id)}
                    canAct={canAct}
                    checkStatus={check.status}
                    isSelected={selectedAssetIds.has(ca.id)}
                    onToggleSelect={() => toggleAssetSelection(ca.id)}
                    onForceComplete={() => handleForceComplete(ca.id)}
                    onItemResult={handleItemResult}
                    onItemNotes={handleItemNotes}
                    onAssetNote={(notes) => handleAssetNote(ca.id, notes)}
                    onAssetWO={(wo) => handleAssetWO(ca.id, wo)}
                  />
                ))}
                {displayedAssets.length === 0 && filterText && (
                  <tr>
                    <td colSpan={canAct ? 9 : 8} className="px-4 py-8 text-center text-sm text-eq-grey">
                      No assets match &ldquo;{filterText}&rdquo;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </CollapsibleSection>
        </>
      )}

      {checkAssets.length === 0 && (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm">No assets linked to this maintenance check.</p>
        </div>
      )}

      {/*
        Sticky bottom action bar — mobile only (sm:hidden so desktop
        unchanged). Mirrors the primary CTA from the header so a tech
        who's scrolled through 40 tasks doesn't have to scroll back to
        the top to start or complete the check. Padded for the home-
        indicator safe area on iPhones via `pb-[env(safe-area-inset-bottom)]`.
      */}
      {canAct && (check.status === 'scheduled' || check.status === 'overdue' || check.status === 'in_progress') && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-eq-line shadow-[0_-4px_12px_rgba(0,0,0,0.05)] pb-[env(safe-area-inset-bottom)]">
          <div className="px-4 py-3 flex items-center gap-2">
            {(check.status === 'scheduled' || check.status === 'overdue') && (
              <Button size="md" onClick={handleStart} loading={loading} className="w-full min-h-[44px]">
                Start Check
              </Button>
            )}
            {check.status === 'in_progress' && (
              <>
                <Button
                  size="md"
                  onClick={handleComplete}
                  loading={loading}
                  disabled={requiredIncomplete > 0}
                  className="flex-1 min-h-[44px]"
                >
                  {requiredIncomplete > 0
                    ? `${requiredIncomplete} required ${requiredIncomplete === 1 ? 'task' : 'tasks'} left`
                    : 'Complete Check'}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {/* Spacer so the sticky bar doesn't cover the last task row on mobile. */}
      {canAct && (check.status === 'scheduled' || check.status === 'overdue' || check.status === 'in_progress') && (
        <div className="sm:hidden h-20" aria-hidden="true" />
      )}
    </div>
  )
}

/* ──────── Asset Row ──────── */

function AssetRow({
  ca, items, isExpanded, onToggle, canAct, checkStatus, isSelected, onToggleSelect,
  onForceComplete, onItemResult, onItemNotes, onAssetNote, onAssetWO,
}: {
  ca: CheckAssetWithDetails
  items: MaintenanceCheckItem[]
  isExpanded: boolean
  onToggle: () => void
  canAct: boolean
  checkStatus: CheckStatus
  isSelected: boolean
  onToggleSelect: () => void
  onForceComplete: () => void
  onItemResult: (itemId: string, result: CheckItemResult | null) => void
  onItemNotes: (itemId: string, notes: string) => void
  onAssetNote: (notes: string) => void
  onAssetWO: (wo: string) => void
}) {
  const [editingWO, setEditingWO] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)

  const asset = ca.assets
  const doneCount = items.filter(i => i.result !== null).length
  const total = items.length
  const allDone = doneCount === total && total > 0
  const jpName = (asset?.job_plans as { name: string } | null)?.name ?? '—'

  return (
    <>
      {/* Main row */}
      <tr
        className={`transition-colors ${
          isExpanded ? 'bg-eq-ice/40' : 'hover:bg-gray-50'
        } ${allDone ? 'opacity-60' : ''} ${isSelected ? 'bg-blue-50' : ''}`}
      >
        {canAct && (
          <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="cursor-pointer"
            />
          </td>
        )}
        <td className="px-4 py-2.5 font-mono text-eq-ink whitespace-nowrap cursor-pointer" onClick={onToggle}>
          <span className="flex items-center gap-1">
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-eq-grey shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-eq-grey shrink-0" />}
            {asset?.maximo_id ?? '—'}
          </span>
        </td>
        <td className="px-4 py-2.5 text-eq-ink cursor-pointer" onClick={onToggle}>{asset?.name ?? '—'}</td>
        <td className="px-4 py-2.5 text-eq-grey cursor-pointer" onClick={onToggle}>{asset?.location ?? '—'}</td>

        {/* WO # — editable */}
        <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
          {editingWO ? (
            <input
              defaultValue={ca.work_order_number ?? ''}
              onBlur={e => { onAssetWO(e.target.value); setEditingWO(false) }}
              onKeyDown={e => { if (e.key === 'Enter') { onAssetWO((e.target as HTMLInputElement).value); setEditingWO(false) } }}
              className="w-full h-7 px-2 border border-eq-sky rounded text-sm font-mono bg-white focus:outline-none"
              autoFocus
            />
          ) : (
            <span
              className={`cursor-text ${ca.work_order_number ? 'text-eq-ink font-mono' : 'text-gray-300'}`}
              onClick={() => canAct && setEditingWO(true)}
            >
              {ca.work_order_number || '---'}
            </span>
          )}
        </td>

        <td className="px-4 py-2.5 text-eq-grey">{jpName}</td>

        {/* Completed indicator */}
        <td className="px-4 py-2.5">
          <span className={allDone ? 'text-green-600 font-medium' : 'text-eq-grey'}>
            {allDone ? 'Yes' : `${doneCount}/${total}`}
          </span>
        </td>

        {/* Notes — editable */}
        <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
          {editingNotes ? (
            <input
              defaultValue={ca.notes ?? ''}
              onBlur={e => { onAssetNote(e.target.value); setEditingNotes(false) }}
              onKeyDown={e => { if (e.key === 'Enter') { onAssetNote((e.target as HTMLInputElement).value); setEditingNotes(false) } }}
              className="w-full h-7 px-2 border border-eq-sky rounded text-sm bg-white focus:outline-none"
              autoFocus
            />
          ) : (
            <span
              className={`cursor-text truncate block max-w-[10rem] ${ca.notes ? 'text-eq-ink' : 'text-gray-300'}`}
              onClick={() => canAct && setEditingNotes(true)}
            >
              {ca.notes || '---'}
            </span>
          )}
        </td>

        <td className="px-2 py-2.5">
          {canAct && !allDone && items.length > 0 && (
            <button
              onClick={e => { e.stopPropagation(); onForceComplete() }}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded text-green-600 hover:bg-green-50 transition-colors touch-manipulation active:scale-95"
              aria-label="Force complete all tasks for this asset"
              title="Force complete all tasks"
            >
              <CheckCheck className="w-4 h-4" />
            </button>
          )}
        </td>
      </tr>

      {/* Expanded: Outstanding tasks for this asset */}
      {isExpanded && (
        <tr>
          <td colSpan={canAct ? 9 : 8} className="bg-gray-50 px-0 py-0">
            <div className="px-6 py-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-eq-ink">
                  Outstanding Tasks — {jpName} ({items.length} tasks, {doneCount} completed)
                </h4>
                {canAct && !allDone && (
                  <button
                    onClick={onForceComplete}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 rounded hover:bg-green-200 transition-colors"
                  >
                    <CheckCheck className="w-3.5 h-3.5" /> Force Complete All
                  </button>
                )}
              </div>

              {items.length === 0 ? (
                <p className="text-sm text-eq-grey">No tasks for this asset.</p>
              ) : (
                <table className="w-full text-sm border border-gray-200 rounded overflow-hidden">
                  <thead>
                    <tr className="bg-white border-b border-gray-200">
                      <th className="px-4 py-2 text-left text-xs font-bold text-eq-grey uppercase w-12">Order</th>
                      <th className="px-4 py-2 text-left text-xs font-bold text-eq-grey uppercase">Task</th>
                      <th className="px-4 py-2 text-left text-xs font-bold text-eq-grey uppercase w-28">Result</th>
                      <th className="px-4 py-2 text-left text-xs font-bold text-eq-grey uppercase">Comments</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {items.map(item => (
                      <TaskRow
                        key={item.id}
                        item={item}
                        checkStatus={checkStatus}
                        canAct={canAct}
                        onResult={onItemResult}
                        onNotes={onItemNotes}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/* ──────── Task Row ──────── */

function TaskRow({
  item, checkStatus, canAct, onResult, onNotes,
}: {
  item: MaintenanceCheckItem
  checkStatus: CheckStatus
  canAct: boolean
  onResult: (itemId: string, result: CheckItemResult | null) => void
  onNotes: (itemId: string, notes: string) => void
}) {
  const [editingNotes, setEditingNotes] = useState(false)
  const isActive = canAct

  const resultColors: Record<string, string> = {
    pass: 'text-green-600',
    fail: 'text-red-600',
    na: 'text-gray-400',
  }

  return (
    <tr className={`${item.result ? 'opacity-60' : ''}`}>
      <td className="px-4 py-2 text-eq-grey font-mono text-xs">{item.sort_order}</td>
      <td className="px-4 py-2 text-eq-ink">
        {item.description}
        {item.is_required && <span className="text-eq-sky font-medium ml-1">*</span>}
      </td>

      {/* Result buttons — 44px tap targets, mirrors the AcbWorkflow
          TriStateButton (UX audit PR #149 §2.5 / §B.8). Icon visual size
          stays 4×4 (16px) but the surrounding hit area is the field-
          ergonomic 44×44 minimum. touch-manipulation kills the iOS 300ms
          tap delay; active:scale-95 gives immediate tactile feedback. */}
      <td className="px-4 py-2">
        {isActive ? (
          <div className="flex items-center gap-1">
            <button onClick={() => onResult(item.id, item.result === 'pass' ? null : 'pass')}
              className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded transition-colors touch-manipulation active:scale-95 ${item.result === 'pass' ? 'bg-green-50 text-green-600' : 'text-gray-300 hover:text-green-500 hover:bg-green-50/40'}`} aria-label="Pass">
              <CheckCircle className="w-4 h-4" />
            </button>
            <button onClick={() => onResult(item.id, item.result === 'fail' ? null : 'fail')}
              className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded transition-colors touch-manipulation active:scale-95 ${item.result === 'fail' ? 'bg-red-50 text-red-600' : 'text-gray-300 hover:text-red-500 hover:bg-red-50/40'}`} aria-label="Fail">
              <XCircle className="w-4 h-4" />
            </button>
            <button onClick={() => onResult(item.id, item.result === 'na' ? null : 'na')}
              className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded transition-colors touch-manipulation active:scale-95 ${item.result === 'na' ? 'bg-gray-100 text-gray-600' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50'}`} aria-label="N/A">
              <MinusCircle className="w-4 h-4" />
            </button>
          </div>
        ) : item.result ? (
          <span className={`font-semibold uppercase ${resultColors[item.result]}`}>
            {item.result === 'na' ? 'N/A' : item.result}
          </span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>

      {/* Comments — inline editable */}
      <td className="px-4 py-2">
        {editingNotes ? (
          <input
            defaultValue={item.notes ?? ''}
            onBlur={e => { onNotes(item.id, e.target.value); setEditingNotes(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { onNotes(item.id, (e.target as HTMLInputElement).value); setEditingNotes(false) } }}
            className="w-full h-7 px-2 border border-eq-sky rounded text-sm bg-white focus:outline-none"
            autoFocus
          />
        ) : (
          <span
            className={`cursor-text ${item.notes ? 'text-eq-ink' : 'text-gray-300'}`}
            onClick={() => isActive && setEditingNotes(true)}
          >
            {item.notes || '---'}
          </span>
        )}
      </td>
    </tr>
  )
}
