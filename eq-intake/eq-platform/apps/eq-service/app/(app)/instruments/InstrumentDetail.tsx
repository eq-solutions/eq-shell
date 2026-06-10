'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { toggleInstrumentActiveAction } from './actions'
import { formatDate } from '@/lib/utils/format'
import type { Instrument, InstrumentStatus } from '@/lib/types'

type InstrumentRow = Instrument & { assignee_name?: string | null }

interface InstrumentDetailProps {
  open: boolean
  onClose: () => void
  instrument: InstrumentRow
  isAdmin: boolean
  canWrite: boolean
  onEdit: () => void
}

function statusToBadge(status: InstrumentStatus): 'active' | 'inactive' | 'not-started' | 'blocked' {
  const map: Record<InstrumentStatus, 'active' | 'inactive' | 'not-started' | 'blocked'> = {
    Active: 'active',
    'Out for Cal': 'not-started',
    Retired: 'inactive',
    Lost: 'blocked',
  }
  return map[status]
}

export function InstrumentDetail({
  open, onClose, instrument, isAdmin: isAdminRole, canWrite: canWriteRole, onEdit,
}: InstrumentDetailProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isCalOverdue = instrument.calibration_due
    ? new Date(instrument.calibration_due) < new Date()
    : false

  async function handleToggleActive() {
    setLoading(true)
    const result = await toggleInstrumentActiveAction(instrument.id, !instrument.is_active)
    setLoading(false)
    if (result.success) onClose()
    else setError(result.error ?? 'Failed to update.')
  }

  return (
    <SlidePanel open={open} onClose={onClose} title={instrument.name}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <StatusBadge status={statusToBadge(instrument.status)} label={instrument.status} />
          <div className="flex items-center gap-2">
            {canWriteRole && <Button size="sm" onClick={onEdit}>Edit</Button>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs font-bold text-eq-grey uppercase">Type</dt>
            <dd className="text-eq-ink mt-1">{instrument.instrument_type}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-eq-grey uppercase">Make</dt>
            <dd className="text-eq-ink mt-1">{instrument.make ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-eq-grey uppercase">Model</dt>
            <dd className="text-eq-ink mt-1">{instrument.model ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-eq-grey uppercase">Serial</dt>
            <dd className="text-eq-ink mt-1">{instrument.serial_number ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-eq-grey uppercase">Asset Tag</dt>
            <dd className="text-eq-ink mt-1">{instrument.asset_tag ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-eq-grey uppercase">Assigned To</dt>
            <dd className="text-eq-ink mt-1">{instrument.assignee_name ?? 'Unassigned'}</dd>
          </div>
        </div>

        <div className="pt-3 border-t border-gray-200">
          <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Calibration</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-eq-grey">Last Calibrated</dt>
              <dd className="text-eq-ink mt-0.5">{instrument.calibration_date ? formatDate(instrument.calibration_date) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-eq-grey">Due</dt>
              <dd className={`mt-0.5 ${isCalOverdue ? 'text-red-600 font-medium' : 'text-eq-ink'}`}>
                {instrument.calibration_due ? formatDate(instrument.calibration_due) : '—'}
                {isCalOverdue && ' (Overdue)'}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-eq-grey">Certificate</dt>
              <dd className="text-eq-ink mt-0.5">{instrument.calibration_cert ?? '—'}</dd>
            </div>
          </div>
        </div>

        {instrument.notes && (
          <div className="text-sm text-eq-grey bg-gray-50 rounded-md p-3">{instrument.notes}</div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        {isAdminRole && (
          <div className="pt-4 border-t border-gray-200">
            <Button
              size="sm"
              variant={instrument.is_active ? 'danger' : 'primary'}
              onClick={handleToggleActive}
              disabled={loading}
            >
              {instrument.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        )}
      </div>
    </SlidePanel>
  )
}
