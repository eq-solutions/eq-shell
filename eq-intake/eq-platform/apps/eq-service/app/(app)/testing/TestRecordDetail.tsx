'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { FormInput } from '@/components/ui/FormInput'
import {
  updateTestRecordAction,
  toggleTestRecordActiveAction,
  createReadingAction,
  deleteReadingAction,
} from './actions'
import { AttachmentList } from '@/components/ui/AttachmentList'
import { formatDate, formatTestResult } from '@/lib/utils/format'
import type { TestRecord, TestRecordReading, TestResult, Asset, Site, Profile, Attachment } from '@/lib/types'
import { Plus, Trash2, CheckCircle, XCircle } from 'lucide-react'

type RecordRow = TestRecord & {
  assets?: { name: string; asset_type: string } | null
  sites?: { name: string } | null
  tester_name?: string | null
}

interface TestRecordDetailProps {
  open: boolean
  onClose: () => void
  record: RecordRow
  readings: TestRecordReading[]
  attachments: Attachment[]
  assets: Pick<Asset, 'id' | 'name' | 'asset_type' | 'site_id'>[]
  sites: Pick<Site, 'id' | 'name'>[]
  technicians: Pick<Profile, 'id' | 'email' | 'full_name'>[]
  isAdmin: boolean
  canWrite: boolean
  onEdit: () => void
}

function resultToBadge(result: TestResult): 'not-started' | 'complete' | 'blocked' | 'in-progress' {
  const map: Record<TestResult, 'not-started' | 'complete' | 'blocked' | 'in-progress'> = {
    pending: 'not-started',
    pass: 'complete',
    fail: 'blocked',
    defect: 'blocked',
  }
  return map[result]
}

export function TestRecordDetail({
  open, onClose, record, readings, attachments, assets, sites, technicians,
  isAdmin, canWrite: canWriteRole, onEdit,
}: TestRecordDetailProps) {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showAddReading, setShowAddReading] = useState(false)

  const assetName = record.assets?.name ?? '—'
  const assetType = record.assets?.asset_type ?? ''
  const siteName = record.sites?.name ?? '—'

  async function handleToggleActive() {
    setLoading(true)
    const result = await toggleTestRecordActiveAction(record.id, !record.is_active)
    setLoading(false)
    if (result.success) {
      onClose()
    } else {
      setError(result.error ?? 'Failed to update.')
    }
  }

  async function handleAddReading(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    formData.set('sort_order', String(readings.length))
    const result = await createReadingAction(record.id, formData)
    setLoading(false)
    if (result.success) {
      setShowAddReading(false)
    } else {
      setError(result.error ?? 'Failed to add reading.')
    }
  }

  async function handleDeleteReading(readingId: string) {
    const result = await deleteReadingAction(readingId)
    if (!result.success) {
      setError(result.error ?? 'Failed to delete reading.')
    }
  }

  return (
    <SlidePanel open={open} onClose={onClose} title={`${assetName} — ${record.test_type}`}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <StatusBadge status={resultToBadge(record.result)} label={formatTestResult(record.result)} />
          <div className="flex items-center gap-2">
            <StatusBadge status={record.is_active ? 'active' : 'inactive'} />
            {canWriteRole && (
              <Button size="sm" onClick={onEdit}>Edit</Button>
            )}
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs font-bold text-eq-grey uppercase">Asset</dt>
            <dd className="text-eq-ink mt-1">{assetName} {assetType && <span className="text-eq-grey text-xs">({assetType})</span>}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-eq-grey uppercase">Site</dt>
            <dd className="text-eq-ink mt-1">{siteName}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-eq-grey uppercase">Test Date</dt>
            <dd className="text-eq-ink mt-1">{formatDate(record.test_date)}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-eq-grey uppercase">Tested By</dt>
            <dd className="text-eq-ink mt-1">{record.tester_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-eq-grey uppercase">Next Test Due</dt>
            <dd className="text-eq-ink mt-1">{record.next_test_due ? formatDate(record.next_test_due) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-eq-grey uppercase">Result</dt>
            <dd className="text-eq-ink mt-1">{formatTestResult(record.result)}</dd>
          </div>
        </div>

        {record.notes && (
          <div className="text-sm text-eq-grey bg-gray-50 rounded-md p-3">{record.notes}</div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        {/* Readings section */}
        <div className="pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide">Readings</h3>
            {canWriteRole && (
              <button
                onClick={() => setShowAddReading(!showAddReading)}
                className="flex items-center gap-1 text-xs text-eq-sky hover:text-eq-deep transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Reading
              </button>
            )}
          </div>

          {showAddReading && (
            <form onSubmit={handleAddReading} className="mb-4 p-3 border border-gray-200 rounded-md space-y-3 bg-gray-50">
              <FormInput label="Label" name="label" required placeholder="e.g. Phase A-B" />
              <div className="grid grid-cols-2 gap-3">
                <FormInput label="Value" name="value" placeholder="e.g. 500" />
                <FormInput label="Unit" name="unit" placeholder="e.g. MΩ" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Pass/Fail</label>
                <select
                  name="pass"
                  defaultValue=""
                  className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
                >
                  <option value="">Not assessed</option>
                  <option value="true">Pass</option>
                  <option value="false">Fail</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" loading={loading}>
                  Add
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setShowAddReading(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {readings.length === 0 && !showAddReading ? (
            <p className="text-sm text-eq-grey">No readings recorded.</p>
          ) : (
            <div className="space-y-2">
              {readings.map((rdg) => (
                <div key={rdg.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-md">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-eq-ink">{rdg.label}</p>
                    <p className="text-xs text-eq-grey mt-0.5">
                      {rdg.value ?? '—'}{rdg.unit ? ` ${rdg.unit}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {rdg.pass === true && <CheckCircle className="w-4 h-4 text-green-600" />}
                    {rdg.pass === false && <XCircle className="w-4 h-4 text-red-600" />}
                    {rdg.pass === null && <span className="text-xs text-gray-300">—</span>}
                    {canWriteRole && (
                      <button
                        onClick={() => handleDeleteReading(rdg.id)}
                        className="p-1 rounded text-gray-300 hover:text-red-500 transition-colors"
                        title="Delete reading"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Attachments */}
        <AttachmentList
          entityType="test_record"
          entityId={record.id}
          attachments={attachments}
          canWrite={canWriteRole}
          isAdmin={isAdmin}
        />

        {/* Admin actions */}
        {isAdmin && (
          <div className="pt-4 border-t border-gray-200">
            <Button
              size="sm"
              variant={record.is_active ? 'danger' : 'primary'}
              onClick={handleToggleActive}
              disabled={loading}
            >
              {record.is_active ? 'Deactivate Record' : 'Reactivate Record'}
            </Button>
          </div>
        )}
      </div>
    </SlidePanel>
  )
}
