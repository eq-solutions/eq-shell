'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { clearPmCalendarEntriesAction } from './actions'

interface ClearFilteredDialogProps {
  open: boolean
  onClose: () => void
  ids: string[]
  filterSummary: string
}

export function ClearFilteredDialog({
  open,
  onClose,
  ids,
  filterSummary,
}: ClearFilteredDialogProps) {
  const router = useRouter()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const count = ids.length
  const expected = String(count)
  const matches = typed.trim() === expected

  useEffect(() => {
    if (open) {
      setTyped('')
      setError(null)
    }
  }, [open])

  async function handleConfirm() {
    if (!matches) return
    setBusy(true)
    setError(null)
    const res = await clearPmCalendarEntriesAction(ids, count, crypto.randomUUID())
    setBusy(false)
    if (res.success) {
      onClose()
      router.refresh()
    } else {
      setError(res.error ?? 'Clear failed.')
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Clear filtered entries">
      <div className="space-y-4">
        <div className="flex gap-3 p-3 bg-red-50 border border-red-200 rounded-md">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm text-red-900">
            <p className="font-semibold mb-1">
              You are about to soft-delete {count} {count === 1 ? 'entry' : 'entries'}.
            </p>
            <p className="text-red-800">
              They&apos;ll be hidden from the calendar and move to the Show Archived list, where an
              admin can reactivate them. Audit-logged.
            </p>
          </div>
        </div>

        <div className="text-sm text-eq-ink">
          <div className="text-xs font-medium uppercase text-eq-grey mb-1">Scope</div>
          <p className="text-eq-ink">{filterSummary}</p>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase text-eq-grey mb-1">
            Type <span className="font-mono text-eq-ink">{expected}</span> to confirm
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            autoFocus
            className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 disabled:opacity-50"
            placeholder={expected}
          />
        </div>

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleConfirm}
            disabled={!matches || busy}
            loading={busy}
          >
            {busy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Clearing...
              </>
            ) : (
              `Clear ${count}`
            )}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
