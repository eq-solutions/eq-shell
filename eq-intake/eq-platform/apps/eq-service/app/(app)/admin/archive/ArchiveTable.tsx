'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { restoreEntityAction, hardDeleteEntityAction } from './actions'
import type { ArchiveEntityType } from './helpers'

export interface ArchiveRow {
  id: string
  name: string
  entity_type: ArchiveEntityType
  entity_label: string
  deleted_at: string | null
  days_remaining: number | null
  dependency_count: number
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  // Pin timeZone so server (UTC) and client (AEST) render the same string —
  // prevents React hydration mismatch (error #418) on late-evening UTC dates.
  return new Date(s).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Australia/Sydney',
  })
}

function fmtCountdown(days: number | null): { label: string; tone: 'grey' | 'amber' | 'red' | 'green' } {
  if (days === null) return { label: 'Manual only', tone: 'grey' }
  if (days <= 0) return { label: 'Next run', tone: 'red' }
  if (days <= 7) return { label: `${days} day${days === 1 ? '' : 's'}`, tone: 'red' }
  if (days <= 14) return { label: `${days} days`, tone: 'amber' }
  return { label: `${days} days`, tone: 'green' }
}

export function ArchiveTable({ rows, graceDays }: { rows: ArchiveRow[]; graceDays: number }) {
  const [pending, startTransition] = useTransition()
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ArchiveRow | null>(null)
  const [confirmName, setConfirmName] = useState('')

  function handleRestore(row: ArchiveRow) {
    setBanner(null)
    const fd = new FormData()
    fd.set('entity_type', row.entity_type)
    fd.set('entity_id', row.id)
    startTransition(async () => {
      const res = await restoreEntityAction(fd)
      if (res && 'error' in res && res.error) {
        setBanner({ kind: 'err', msg: res.error })
      } else {
        setBanner({ kind: 'ok', msg: `Restored ${row.entity_label.toLowerCase()} "${row.name}".` })
      }
    })
  }

  function handleDelete() {
    if (!deleteTarget) return
    setBanner(null)
    const fd = new FormData()
    fd.set('entity_type', deleteTarget.entity_type)
    fd.set('entity_id', deleteTarget.id)
    fd.set('confirm_name', confirmName)
    startTransition(async () => {
      const res = await hardDeleteEntityAction(fd)
      if (res && 'error' in res && res.error) {
        setBanner({ kind: 'err', msg: res.error })
      } else {
        setBanner({ kind: 'ok', msg: `Permanently deleted "${deleteTarget.name}".` })
        setDeleteTarget(null)
        setConfirmName('')
      }
    })
  }

  if (rows.length === 0) return null

  return (
    <>
      {banner && (
        <div className={
          'px-4 py-2 rounded-md border text-xs ' +
          (banner.kind === 'ok'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800')
        }>
          {banner.msg}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-bold text-eq-grey uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Archived</th>
              <th className="text-left px-4 py-3">Dependencies</th>
              <th className="text-left px-4 py-3">Auto-deletes</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => {
              const countdown = fmtCountdown(row.days_remaining)
              const rowBg = countdown.tone === 'red' ? 'bg-red-50/40' : ''
              const blocked = row.dependency_count > 0 && (row.entity_type !== 'testing_check')
              return (
                <tr key={`${row.entity_type}-${row.id}`} className={rowBg}>
                  <td className="px-4 py-3 text-eq-ink font-medium">{row.name}</td>
                  <td className="px-4 py-3 text-eq-grey text-xs">{row.entity_label}</td>
                  <td className="px-4 py-3 text-eq-grey text-xs">{fmtDate(row.deleted_at)}</td>
                  <td className="px-4 py-3">
                    {row.dependency_count === 0 ? (
                      <span className="text-xs text-eq-grey">None</span>
                    ) : (
                      <span className={
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ' +
                        (blocked ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600')
                      }>
                        {row.dependency_count} {row.dependency_count === 1 ? 'item' : 'items'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={
                      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ' +
                      (countdown.tone === 'red'   ? 'bg-red-50 text-red-700'    :
                       countdown.tone === 'amber' ? 'bg-amber-50 text-amber-700' :
                       countdown.tone === 'green' ? 'bg-green-50 text-green-700' :
                                                    'bg-gray-100 text-gray-600')
                    }>
                      {countdown.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => handleRestore(row)}
                        disabled={pending}
                        className="text-xs font-semibold text-eq-deep hover:text-eq-sky disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => { setDeleteTarget(row); setConfirmName('') }}
                        disabled={pending || blocked}
                        title={blocked ? 'Delete dependent rows first' : 'Permanently delete'}
                        className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                      >
                        Delete permanently
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-eq-grey">
        Auto-delete countdown uses the current grace period of <span className="font-semibold">{graceDays} days</span>.
        Items with no countdown were archived before countdowns were tracked — they'll only be removed if you delete them manually.
      </p>

      {/* Delete confirm modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
             onClick={() => { if (!pending) { setDeleteTarget(null); setConfirmName('') } }}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
               onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-eq-ink">Delete permanently?</h3>
            <p className="text-sm text-eq-grey mt-2">
              This will permanently delete the {deleteTarget.entity_label.toLowerCase()}{' '}
              <span className="font-semibold text-eq-ink">&ldquo;{deleteTarget.name}&rdquo;</span>.
              This cannot be undone.
            </p>
            <p className="text-xs text-eq-grey mt-3">
              Type <span className="font-mono font-semibold text-eq-ink">{deleteTarget.name}</span> to confirm:
            </p>
            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoFocus
              className="w-full mt-2 h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
              placeholder="Type the name exactly"
            />
            <div className="flex items-center justify-end gap-2 mt-5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setDeleteTarget(null); setConfirmName('') }}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleDelete}
                disabled={pending || confirmName.trim() !== deleteTarget.name.trim()}
                className="!bg-red-600 hover:!bg-red-700 !text-white"
              >
                {pending ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
