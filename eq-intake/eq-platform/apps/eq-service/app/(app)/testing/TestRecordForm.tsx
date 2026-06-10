'use client'

import { useState, useMemo } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { createTestRecordAction, updateTestRecordAction } from './actions'
import type { TestRecord, Asset, Site, Profile } from '@/lib/types'

interface TestRecordFormProps {
  open: boolean
  onClose: () => void
  record?: TestRecord | null
  assets: Pick<Asset, 'id' | 'name' | 'asset_type' | 'site_id'>[]
  sites: Pick<Site, 'id' | 'name'>[]
  technicians: Pick<Profile, 'id' | 'email' | 'full_name'>[]
}

export function TestRecordForm({ open, onClose, record, assets, sites, technicians }: TestRecordFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedAssetId, setSelectedAssetId] = useState(record?.asset_id ?? '')

  const isEdit = !!record

  // Auto-resolve site from selected asset
  const resolvedSiteId = useMemo(() => {
    if (selectedAssetId) {
      const asset = assets.find((a) => a.id === selectedAssetId)
      return asset?.site_id ?? ''
    }
    return record?.site_id ?? ''
  }, [selectedAssetId, assets, record])

  const resolvedSiteName = useMemo(() => {
    if (!resolvedSiteId) return ''
    return sites.find((s) => s.id === resolvedSiteId)?.name ?? ''
  }, [resolvedSiteId, sites])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    // Inject resolved site_id
    formData.set('site_id', resolvedSiteId)

    const result = isEdit
      ? await updateTestRecordAction(record!.id, formData)
      : await createTestRecordAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
      setTimeout(() => { handleClose() }, 500)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  function handleClose() {
    onClose()
    setError(null)
    setSuccess(false)
    setSelectedAssetId(record?.asset_id ?? '')
  }

  return (
    <SlidePanel open={open} onClose={handleClose} title={isEdit ? 'Edit Test Record' : 'Add Test Record'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Asset selection */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Asset</label>
          <select
            name="asset_id"
            required
            value={selectedAssetId}
            onChange={(e) => setSelectedAssetId(e.target.value)}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Select asset...</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.asset_type})
              </option>
            ))}
          </select>
        </div>

        {/* Auto-resolved site (read-only) */}
        {resolvedSiteName && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site</label>
            <div className="h-10 px-4 flex items-center border border-gray-100 rounded-md text-sm text-eq-grey bg-gray-50">
              {resolvedSiteName}
            </div>
          </div>
        )}

        <FormInput
          label="Test Type"
          name="test_type"
          required
          defaultValue={record?.test_type ?? ''}
          placeholder="e.g. Insulation Resistance, Contact Resistance"
        />

        <FormInput
          label="Test Date"
          name="test_date"
          type="date"
          required
          defaultValue={record?.test_date ?? new Date().toISOString().split('T')[0]}
        />

        {/* Tested By */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Tested By</label>
          <select
            name="tested_by"
            defaultValue={record?.tested_by ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Not assigned</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name ?? t.email}
              </option>
            ))}
          </select>
        </div>

        {/* Result */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Result</label>
          <select
            name="result"
            defaultValue={record?.result ?? 'pending'}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="pending">Pending</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="defect">Defect</option>
          </select>
        </div>

        <FormInput
          label="Next Test Due"
          name="next_test_due"
          type="date"
          defaultValue={record?.next_test_due ?? ''}
        />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Notes</label>
          <textarea
            name="notes"
            defaultValue={record?.notes ?? ''}
            rows={3}
            placeholder="Optional notes..."
            className="px-4 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20 resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Saved successfully.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" loading={loading}>
            {isEdit ? 'Update Record' : 'Create Record'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
        </div>
      </form>
    </SlidePanel>
  )
}
