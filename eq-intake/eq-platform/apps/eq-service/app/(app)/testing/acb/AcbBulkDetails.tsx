'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { updateAcbDetailsAction } from '@/app/(app)/testing/acb/actions'
import type { AcbTest, Asset } from '@/lib/types'

interface AcbBulkDetailsProps {
  assets: (Asset & { acb_test?: AcbTest })[]
  onUpdate: () => void
}

export function AcbBulkDetails({ assets, onUpdate }: AcbBulkDetailsProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleEditClick = (assetId: string, test?: AcbTest) => {
    setEditingId(assetId)
    setFormData({
      [assetId]: {
        cb_make: test?.cb_make || '',
        cb_model: test?.cb_model || '',
        cb_serial: test?.cb_serial || '',
        cb_rating: test?.cb_rating || '',
        cb_poles: test?.cb_poles || '',
        trip_unit: test?.trip_unit || '',
      },
    })
    setError(null)
    setSuccess(false)
  }

  const handleChange = (assetId: string, field: string, value: string) => {
    setFormData({
      ...formData,
      [assetId]: {
        ...formData[assetId],
        [field]: value,
      },
    })
  }

  const handleSave = async (assetId: string, test?: AcbTest) => {
    if (!test) {
      setError('No test record found for this asset')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(false)

    const result = await updateAcbDetailsAction(test.id, {
      cb_make: formData[assetId]?.cb_make || null,
      cb_model: formData[assetId]?.cb_model || null,
      cb_serial: formData[assetId]?.cb_serial || null,
      cb_rating: formData[assetId]?.cb_rating || null,
      cb_poles: formData[assetId]?.cb_poles || null,
      trip_unit: formData[assetId]?.trip_unit || null,
    })

    setLoading(false)
    if (result.success) {
      setSuccess(true)
      setEditingId(null)
      onUpdate()
      setTimeout(() => setSuccess(false), 2000)
    } else {
      setError(result.error || 'Failed to save')
    }
  }

  const handleCancel = () => {
    setEditingId(null)
    setError(null)
    setSuccess(false)
  }

  return (
    <Card className="p-6">
      <h3 className="text-lg font-medium text-eq-ink mb-4">Bulk Edit Circuit Breaker Details</h3>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">
          Saved successfully
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-3 font-medium text-eq-grey">Asset</th>
              <th className="text-left py-2 px-3 font-medium text-eq-grey">Make</th>
              <th className="text-left py-2 px-3 font-medium text-eq-grey">Model</th>
              <th className="text-left py-2 px-3 font-medium text-eq-grey">Serial</th>
              <th className="text-left py-2 px-3 font-medium text-eq-grey">Rating</th>
              <th className="text-left py-2 px-3 font-medium text-eq-grey">Poles</th>
              <th className="text-left py-2 px-3 font-medium text-eq-grey">Trip Unit</th>
              <th className="text-left py-2 px-3 font-medium text-eq-grey">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const isEditing = editingId === asset.id
              const test = asset.acb_test
              const data = formData[asset.id] || {
                cb_make: test?.cb_make || '',
                cb_model: test?.cb_model || '',
                cb_serial: test?.cb_serial || '',
                cb_rating: test?.cb_rating || '',
                cb_poles: test?.cb_poles || '',
                trip_unit: test?.trip_unit || '',
              }

              return (
                <tr key={asset.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-3">
                    <div>
                      <p className="font-medium text-eq-ink">{asset.name}</p>
                      {asset.maximo_id && (
                        <p className="text-xs text-eq-grey">{asset.maximo_id}</p>
                      )}
                    </div>
                  </td>
                  {(['cb_make', 'cb_model', 'cb_serial', 'cb_rating', 'cb_poles', 'trip_unit'] as const).map((field) => (
                    <td key={field} className="py-3 px-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={data[field] || ''}
                          onChange={(e) => handleChange(asset.id, field, e.target.value)}
                          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:border-eq-sky focus:ring-1 focus:ring-eq-sky/20"
                          placeholder={`Enter ${field.replace('cb_', '').replace(/_/g, ' ')}`}
                        />
                      ) : (
                        <span className="text-eq-grey">{test?.[field as keyof AcbTest] || '—'}</span>
                      )}
                    </td>
                  ))}
                  <td className="py-3 px-3">
                    {isEditing ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          onClick={() => handleSave(asset.id, test)}
                          disabled={loading}
                          className="text-xs"
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={handleCancel}
                          disabled={loading}
                          className="text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleEditClick(asset.id, test)}
                        className="text-xs"
                      >
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {assets.length === 0 && (
        <div className="py-8 text-center text-eq-grey text-sm">
          No assets found for this site
        </div>
      )}
    </Card>
  )
}
