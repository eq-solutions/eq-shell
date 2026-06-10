'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { createInstrumentAction, updateInstrumentAction } from './actions'
import type { Instrument, Profile } from '@/lib/types'

interface InstrumentFormProps {
  open: boolean
  onClose: () => void
  instrument?: Instrument | null
  technicians: Pick<Profile, 'id' | 'email' | 'full_name'>[]
}

export function InstrumentForm({ open, onClose, instrument, technicians }: InstrumentFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const isEdit = !!instrument

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = isEdit
      ? await updateInstrumentAction(instrument!.id, formData)
      : await createInstrumentAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
      setTimeout(() => handleClose(), 500)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  function handleClose() {
    onClose()
    setError(null)
    setSuccess(false)
  }

  return (
    <SlidePanel open={open} onClose={handleClose} title={isEdit ? 'Edit Instrument' : 'Add Instrument'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormInput label="Name" name="name" required defaultValue={instrument?.name ?? ''} placeholder="e.g. Fluke 87V" />
        <FormInput label="Instrument Type" name="instrument_type" required defaultValue={instrument?.instrument_type ?? ''} placeholder="e.g. Multimeter, Insulation Tester" />

        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Make" name="make" defaultValue={instrument?.make ?? ''} placeholder="e.g. Fluke" />
          <FormInput label="Model" name="model" defaultValue={instrument?.model ?? ''} placeholder="e.g. 87V" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Serial Number" name="serial_number" defaultValue={instrument?.serial_number ?? ''} />
          <FormInput label="Asset Tag" name="asset_tag" defaultValue={instrument?.asset_tag ?? ''} />
        </div>

        <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide pt-4">Calibration</h3>

        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Calibration Date" name="calibration_date" type="date" defaultValue={instrument?.calibration_date ?? ''} />
          <FormInput label="Calibration Due" name="calibration_due" type="date" defaultValue={instrument?.calibration_due ?? ''} />
        </div>

        <FormInput label="Cert Reference" name="calibration_cert" defaultValue={instrument?.calibration_cert ?? ''} placeholder="Certificate number" />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Status</label>
          <select
            name="status"
            defaultValue={instrument?.status ?? 'Active'}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="Active">Active</option>
            <option value="Out for Cal">Out for Cal</option>
            <option value="Retired">Retired</option>
            <option value="Lost">Lost</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Assigned To</label>
          <select
            name="assigned_to"
            defaultValue={instrument?.assigned_to ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Unassigned</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>{t.full_name ?? t.email}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Notes</label>
          <textarea
            name="notes"
            defaultValue={instrument?.notes ?? ''}
            rows={3}
            placeholder="Optional notes..."
            className="px-4 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20 resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Saved successfully.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" loading={loading}>
            {isEdit ? 'Update Instrument' : 'Create Instrument'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleClose}>Cancel</Button>
        </div>
      </form>
    </SlidePanel>
  )
}
