'use client'

import { useState, useMemo } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { batchCreateChecksAction } from './actions'
import type { JobPlan, Site } from '@/lib/types'
import { formatDate } from '@/lib/utils/format'

interface BatchCreateFormProps {
  open: boolean
  onClose: () => void
  jobPlans: Pick<JobPlan, 'id' | 'name' | 'code'>[]
  sites: Pick<Site, 'id' | 'name' | 'customer_id'>[]
  // Accept the same widened shape the page.tsx now produces (id +
  // email + full_name + role + is_active). BatchCreateForm only uses
  // id / full_name / email today; the extra fields are harmless.
  technicians: {
    id: string
    email: string
    full_name: string | null
    role?: string | null
    is_active?: boolean
  }[]
}

export function BatchCreateForm({ open, onClose, jobPlans, sites, technicians }: BatchCreateFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedJobPlan, setSelectedJobPlan] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const jobPlan = jobPlans.find((jp) => jp.id === selectedJobPlan)

  // Preview dates (batch create is being rebuilt — placeholder)
  const previewDates = useMemo(() => {
    if (!jobPlan || !startDate || !endDate) return []
    // TODO: batch create needs rebuild for new frequency-on-items model
    return [new Date(startDate)]
  }, [jobPlan, startDate, endDate])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await batchCreateChecksAction(formData)
    setLoading(false)

    if (result.success) {
      setSuccess(true)
      setTimeout(() => {
        onClose()
        setSelectedJobPlan('')
        setStartDate('')
        setEndDate('')
      }, 500)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  return (
    <SlidePanel open={open} onClose={onClose} title="Batch Create Maintenance Checks">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Maintenance Plan</label>
          <select
            name="job_plan_id"
            required
            value={selectedJobPlan}
            onChange={(e) => setSelectedJobPlan(e.target.value)}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Select maintenance plan...</option>
            {jobPlans.map((jp) => (
              <option key={jp.id} value={jp.id}>
                {jp.name}{jp.code ? ` (${jp.code})` : ''}
              </option>
            ))}
          </select>
        </div>

        {jobPlan && (
          <div className="text-xs text-eq-grey bg-eq-ice/50 rounded-md p-3">
            Maintenance Plan: <span className="font-medium text-eq-ink">{jobPlan.name}</span>
            {jobPlan.code && <> · Code: <span className="font-medium text-eq-ink">{jobPlan.code}</span></>}
          </div>
        )}

        <FormInput
          label="Start Date"
          name="start_date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate((e.target as HTMLInputElement).value)}
          required
        />

        <FormInput
          label="End Date"
          name="end_date"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate((e.target as HTMLInputElement).value)}
          required
        />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Assign To (Optional)</label>
          <select
            name="assigned_to"
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">— Unassigned —</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name ?? t.email}
              </option>
            ))}
          </select>
        </div>

        {/* Preview of dates */}
        {previewDates.length > 0 && (
          <div className="text-sm text-eq-grey bg-eq-ice/30 rounded-md p-3">
            <p className="font-medium text-eq-ink mb-2">
              Preview: {previewDates.length} check{previewDates.length !== 1 ? 's' : ''} will be created
            </p>
            <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto">
              {previewDates.map((date, idx) => (
                <span key={idx} className="text-xs">
                  {formatDate(date.toISOString().split('T')[0])}
                </span>
              ))}
            </div>
          </div>
        )}

        {previewDates.length > 52 && (
          <p className="text-sm text-amber-600">
            Maximum 52 checks allowed. Only the first 52 dates will be created.
          </p>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Checks created successfully!</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" loading={loading} disabled={!selectedJobPlan || !startDate || !endDate}>
            Create {previewDates.length} Checks
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </SlidePanel>
  )
}
