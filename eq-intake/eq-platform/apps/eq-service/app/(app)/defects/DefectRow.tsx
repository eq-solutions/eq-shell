'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateDefectAction } from '@/app/(app)/maintenance/actions'
import { formatDate } from '@/lib/utils/format'

interface DefectRowProps {
  defect: {
    id: string
    title: string
    description: string | null
    severity: string
    status: string
    work_order_number: string | null
    work_order_date: string | null
    raised_by: string | null
    assigned_to: string | null
    resolved_at: string | null
    resolved_by: string | null
    resolution_notes: string | null
    created_at: string
    updated_at: string
    assets: { id: string; name: string } | { id: string; name: string }[] | null
    sites: { id: string; name: string } | { id: string; name: string }[] | null
    maintenance_checks: { id: string; custom_name: string | null } | { id: string; custom_name: string | null }[] | null
  }
  team: Array<{ id: string; name: string }>
  canWrite: boolean
  currentUserId: string | null
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-red-100', text: 'text-red-700' },
  high:     { bg: 'bg-orange-100', text: 'text-orange-700' },
  medium:   { bg: 'bg-amber-100', text: 'text-amber-700' },
  low:      { bg: 'bg-sky-100', text: 'text-sky-700' },
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  open:        { bg: 'bg-red-100', text: 'text-red-700' },
  in_progress: { bg: 'bg-amber-100', text: 'text-amber-700' },
  resolved:    { bg: 'bg-green-100', text: 'text-green-700' },
  closed:      { bg: 'bg-gray-100', text: 'text-eq-grey' },
}

export function DefectRow({ defect, team, canWrite, currentUserId }: DefectRowProps) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [localStatus, setLocalStatus] = useState(defect.status)
  const [localAssigned, setLocalAssigned] = useState(defect.assigned_to ?? '')
  const [localWO, setLocalWO] = useState(defect.work_order_number ?? '')
  const [localWODate, setLocalWODate] = useState(defect.work_order_date ?? '')
  const [localNotes, setLocalNotes] = useState(defect.resolution_notes ?? '')
  const [error, setError] = useState<string | null>(null)

  const rawAsset = defect.assets
  const assetName = Array.isArray(rawAsset) ? rawAsset[0]?.name ?? '—' : rawAsset?.name ?? '—'
  const rawSite = defect.sites
  const siteName = Array.isArray(rawSite) ? rawSite[0]?.name ?? '' : rawSite?.name ?? ''
  const rawCheck = defect.maintenance_checks
  const checkName = Array.isArray(rawCheck) ? rawCheck[0]?.custom_name ?? null : rawCheck?.custom_name ?? null

  const severity = SEVERITY_STYLES[defect.severity] ?? SEVERITY_STYLES.medium
  const status = STATUS_STYLES[localStatus] ?? STATUS_STYLES.open

  const isAssignedToMe = defect.assigned_to === currentUserId
  const canEdit = canWrite || isAssignedToMe

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await updateDefectAction(defect.id, {
        status: localStatus,
        assigned_to: localAssigned || null,
        work_order_number: localWO || null,
        work_order_date: localWODate || null,
        resolution_notes: localNotes || undefined,
      })
      if (!result.success) setError(result.error ?? 'Failed to update defect.')
      else {
        setExpanded(false)
        router.refresh()
      }
    })
  }

  return (
    <div className="py-3 px-2">
      {/* Summary row — click to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 text-left hover:bg-gray-50 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-eq-ink truncate">{defect.title}</p>
          <p className="text-xs text-eq-grey mt-0.5">{assetName}{siteName ? ` · ${siteName}` : ''}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {defect.work_order_number && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">WO: {defect.work_order_number}</span>
          )}
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${severity.bg} ${severity.text}`}>
            {defect.severity}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${status.bg} ${status.text}`}>
            {localStatus.replace('_', ' ')}
          </span>
          <span className="text-xs text-eq-grey">{formatDate(defect.created_at)}</span>
          <span className="text-eq-grey text-sm">{expanded ? '▾' : '▸'}</span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 ml-2 space-y-4 border-l-2 border-gray-100 pl-4">
          {/* Description */}
          {defect.description && (
            <div>
              <p className="text-xs font-bold text-eq-grey uppercase mb-1">Description</p>
              <p className="text-sm text-eq-ink">{defect.description}</p>
            </div>
          )}

          {/* Linked maintenance check */}
          {checkName && (
            <div>
              <p className="text-xs font-bold text-eq-grey uppercase mb-1">From check</p>
              <p className="text-sm text-eq-ink">{checkName}</p>
            </div>
          )}

          {/* Resolution notes (if resolved/closed) */}
          {defect.resolution_notes && !canEdit && (
            <div>
              <p className="text-xs font-bold text-eq-grey uppercase mb-1">Resolution</p>
              <p className="text-sm text-eq-ink">{defect.resolution_notes}</p>
            </div>
          )}

          {/* Editable fields */}
          {canEdit && (
            <div className="space-y-3 bg-gray-50 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-3">
                {/* Status */}
                <div>
                  <label className="text-xs font-bold text-eq-grey uppercase block mb-1">Status</label>
                  <select
                    value={localStatus}
                    onChange={(e) => setLocalStatus(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>

                {/* Assigned to */}
                <div>
                  <label className="text-xs font-bold text-eq-grey uppercase block mb-1">Assigned to</label>
                  <select
                    value={localAssigned}
                    onChange={(e) => setLocalAssigned(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
                  >
                    <option value="">Unassigned</option>
                    {team.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                {/* Work Order Number */}
                <div>
                  <label className="text-xs font-bold text-eq-grey uppercase block mb-1">Work Order #</label>
                  <input
                    type="text"
                    value={localWO}
                    onChange={(e) => setLocalWO(e.target.value)}
                    placeholder="e.g. WO-2024-0123"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
                  />
                </div>

                {/* Work Order Date */}
                <div>
                  <label className="text-xs font-bold text-eq-grey uppercase block mb-1">Work Order Date</label>
                  <input
                    type="date"
                    value={localWODate}
                    onChange={(e) => setLocalWODate(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white"
                  />
                </div>
              </div>

              {/* Resolution notes */}
              <div>
                <label className="text-xs font-bold text-eq-grey uppercase block mb-1">Resolution notes</label>
                <textarea
                  value={localNotes}
                  onChange={(e) => setLocalNotes(e.target.value)}
                  rows={2}
                  placeholder="Describe what was done to resolve this defect..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white resize-none"
                />
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={isPending}
                  className="px-4 py-1.5 rounded-lg bg-eq-sky text-white text-sm font-medium hover:bg-eq-deep transition-colors disabled:opacity-50"
                >
                  {isPending ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setExpanded(false)}
                  className="px-4 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-eq-grey hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Read-only metadata */}
          <div className="flex items-center gap-4 text-xs text-eq-grey">
            <span>Raised: {formatDate(defect.created_at)}</span>
            {defect.resolved_at && <span>Resolved: {formatDate(defect.resolved_at)}</span>}
            {defect.work_order_date && <span>WO date: {formatDate(defect.work_order_date)}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
