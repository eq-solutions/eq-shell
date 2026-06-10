'use client'

import { useState, useTransition } from 'react'
import { Button } from './Button'
import { Archive, Trash2, X, AlertTriangle } from 'lucide-react'

interface BulkActionBarProps {
  selectedCount: number
  entityName: string
  onDeactivate: (ids: string[]) => Promise<{ success: boolean; error?: string }>
  onDelete: (ids: string[]) => Promise<{ success: boolean; error?: string }>
  selectedIds: Set<string>
  onClear: () => void
  /** Hide the hard-delete option (e.g. for maintenance checks) */
  hideDelete?: boolean
}

export function BulkActionBar({
  selectedCount,
  entityName,
  onDeactivate,
  onDelete,
  selectedIds,
  onClear,
  hideDelete = false,
}: BulkActionBarProps) {
  const [confirmAction, setConfirmAction] = useState<'deactivate' | 'delete' | null>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (selectedCount === 0) return null

  function handleAction(action: 'deactivate' | 'delete') {
    setError(null)
    setConfirmAction(action)
  }

  function executeAction() {
    setError(null)
    const ids = [...selectedIds]
    startTransition(async () => {
      try {
        const result = confirmAction === 'deactivate'
          ? await onDeactivate(ids)
          : await onDelete(ids)

        if (result.success) {
          onClear()
          setConfirmAction(null)
        } else {
          setError(result.error ?? 'Action failed.')
        }
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  return (
    <div className="sticky bottom-4 z-30 mx-auto max-w-2xl">
      <div className="bg-eq-ink text-white rounded-xl shadow-2xl px-5 py-3 flex items-center gap-3">
        {/* Count + clear */}
        <div className="flex items-center gap-2 mr-auto">
          <span className="bg-eq-sky text-white text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center">
            {selectedCount}
          </span>
          <span className="text-sm font-medium">
            {entityName} selected
          </span>
          <button
            onClick={onClear}
            className="ml-1 p-1 hover:bg-white/20 rounded transition-colors"
            title="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action buttons or confirmation */}
        {confirmAction ? (
          <div className="flex items-center gap-2">
            {error && <span className="text-red-300 text-xs mr-2">{error}</span>}
            <span className="text-sm text-gray-300">
              {confirmAction === 'deactivate' ? 'Deactivate' : 'Permanently delete'} {selectedCount} {entityName.toLowerCase()}?
            </span>
            <Button
              size="sm"
              variant={confirmAction === 'delete' ? 'danger' : 'secondary'}
              onClick={executeAction}
              disabled={isPending}
            >
              {isPending ? 'Working...' : 'Confirm'}
            </Button>
            <button
              onClick={() => { setConfirmAction(null); setError(null) }}
              className="text-sm text-gray-400 hover:text-white transition-colors px-2"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleAction('deactivate')}
              className="!border-gray-500 !text-gray-200 hover:!bg-gray-700"
            >
              <Archive className="w-3.5 h-3.5 mr-1.5" />
              Deactivate
            </Button>
            {!hideDelete && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => handleAction('delete')}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Delete
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
