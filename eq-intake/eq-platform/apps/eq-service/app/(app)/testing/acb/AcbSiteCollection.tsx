'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateAcbDetailsAction } from '@/app/(app)/testing/acb/actions'
import { ChevronDown, ChevronUp, Save } from 'lucide-react'
import type { AcbTest, Asset } from '@/lib/types'

interface AcbSiteCollectionProps {
  assets: (Asset & { acb_test?: AcbTest })[]
  onUpdate: () => void
}

const VOLTAGE_OPTIONS = ['Not installed', '24V', '48V', '110V', '120V', '240V', 'Other'] as const
const PERFORMANCE_LEVELS = ['N1', 'H1', 'H2', 'H3', 'L1'] as const
const POLES_OPTIONS = ['3', '4', 'Other'] as const

type CollectionFormData = {
  brand: string
  breaker_type: string
  name_location: string
  cb_serial: string
  performance_level: string
  protection_unit_fitted: boolean | null
  trip_unit_model: string
  cb_poles: string
  current_in: string
  fixed_withdrawable: string
  long_time_ir: string
  long_time_delay_tr: string
  short_time_pickup_isd: string
  short_time_delay_tsd: string
  instantaneous_pickup: string
  earth_fault_pickup: string
  earth_fault_delay: string
  earth_leakage_pickup: string
  earth_leakage_delay: string
  motor_charge: string
  shunt_trip_mx1: string
  shunt_close_xf: string
  undervoltage_mn: string
  second_shunt_trip: string
}

function getFormDefaults(test?: AcbTest): CollectionFormData {
  return {
    brand: test?.brand || '',
    breaker_type: test?.breaker_type || '',
    name_location: test?.name_location || '',
    cb_serial: test?.cb_serial || '',
    performance_level: test?.performance_level || '',
    protection_unit_fitted: test?.protection_unit_fitted ?? null,
    trip_unit_model: test?.trip_unit_model || '',
    cb_poles: test?.cb_poles || '',
    current_in: test?.current_in || '',
    fixed_withdrawable: test?.fixed_withdrawable || '',
    long_time_ir: test?.long_time_ir || '',
    long_time_delay_tr: test?.long_time_delay_tr || '',
    short_time_pickup_isd: test?.short_time_pickup_isd || '',
    short_time_delay_tsd: test?.short_time_delay_tsd || '',
    instantaneous_pickup: test?.instantaneous_pickup || '',
    earth_fault_pickup: test?.earth_fault_pickup || '',
    earth_fault_delay: test?.earth_fault_delay || '',
    earth_leakage_pickup: test?.earth_leakage_pickup || '',
    earth_leakage_delay: test?.earth_leakage_delay || '',
    motor_charge: test?.motor_charge || 'Not installed',
    shunt_trip_mx1: test?.shunt_trip_mx1 || 'Not installed',
    shunt_close_xf: test?.shunt_close_xf || 'Not installed',
    undervoltage_mn: test?.undervoltage_mn || 'Not installed',
    second_shunt_trip: test?.second_shunt_trip || 'Not installed',
  }
}

function InputField({ label, value, onChange, placeholder, className }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-eq-grey mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 px-3 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
      />
    </div>
  )
}

function SelectField({ label, value, onChange, options, className }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: readonly string[]
  className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-eq-grey mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-9 px-3 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
      >
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function AssetCollectionCard({
  asset,
  onUpdate,
}: {
  asset: Asset & { acb_test?: AcbTest }
  onUpdate: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [form, setForm] = useState<CollectionFormData>(() => getFormDefaults(asset.acb_test))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (field: keyof CollectionFormData, value: string | boolean | null) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  async function handleSave() {
    if (!asset.acb_test) return
    setSaving(true)
    setError(null)

    const result = await updateAcbDetailsAction(asset.acb_test.id, {
      brand: form.brand || null,
      breaker_type: form.breaker_type || null,
      name_location: form.name_location || null,
      cb_serial: form.cb_serial || null,
      performance_level: form.performance_level || null,
      protection_unit_fitted: form.protection_unit_fitted,
      trip_unit_model: form.trip_unit_model || null,
      cb_poles: form.cb_poles || null,
      current_in: form.current_in || null,
      fixed_withdrawable: form.fixed_withdrawable || null,
      long_time_ir: form.long_time_ir || null,
      long_time_delay_tr: form.long_time_delay_tr || null,
      short_time_pickup_isd: form.short_time_pickup_isd || null,
      short_time_delay_tsd: form.short_time_delay_tsd || null,
      instantaneous_pickup: form.instantaneous_pickup || null,
      earth_fault_pickup: form.earth_fault_pickup || null,
      earth_fault_delay: form.earth_fault_delay || null,
      earth_leakage_pickup: form.earth_leakage_pickup || null,
      earth_leakage_delay: form.earth_leakage_delay || null,
      motor_charge: form.motor_charge || null,
      shunt_trip_mx1: form.shunt_trip_mx1 || null,
      shunt_close_xf: form.shunt_close_xf || null,
      undervoltage_mn: form.undervoltage_mn || null,
      second_shunt_trip: form.second_shunt_trip || null,
      step1_status: 'complete',
    })

    setSaving(false)
    if (result.success) {
      setSaved(true)
      onUpdate()
      setTimeout(() => setSaved(false), 2000)
    } else {
      setError(result.error ?? 'Failed to save')
    }
  }

  const hasTest = !!asset.acb_test

  return (
    <Card className="overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div>
          <p className="font-medium text-eq-ink">{asset.name}</p>
          <p className="text-xs text-eq-grey">
            {asset.serial_number || 'No serial'} · {asset.asset_type}
            {form.brand && ` · ${form.brand}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!hasTest && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">No test record</span>
          )}
          {saved && <span className="text-xs text-green-600">Saved</span>}
          {expanded ? <ChevronUp className="w-4 h-4 text-eq-grey" /> : <ChevronDown className="w-4 h-4 text-eq-grey" />}
        </div>
      </button>

      {/* Expanded form */}
      {expanded && (
        <div className="border-t border-gray-200 p-4 space-y-6">
          {!hasTest && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-700">
              Start a test for this asset first before filling in collection data.
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{error}</div>
          )}

          {/* Breaker Identification */}
          <div>
            <h4 className="text-sm font-semibold text-eq-ink mb-3">Breaker Identification</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <InputField label="Brand" value={form.brand} onChange={v => update('brand', v)} placeholder="e.g. ABB, Schneider" />
              <InputField label="Breaker Type" value={form.breaker_type} onChange={v => update('breaker_type', v)} placeholder="e.g. ACB" />
              <InputField label="Name / Location" value={form.name_location} onChange={v => update('name_location', v)} placeholder="e.g. MSB-ACB-01" />
              <InputField label="Serial Number" value={form.cb_serial} onChange={v => update('cb_serial', v)} placeholder="Serial" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <SelectField label="Performance Level" value={form.performance_level} onChange={v => update('performance_level', v)} options={PERFORMANCE_LEVELS} />
              <div>
                <label className="block text-xs font-medium text-eq-grey mb-1">Protection Unit Fitted</label>
                <div className="flex gap-2 mt-1">
                  {[
                    { label: 'Yes', val: true },
                    { label: 'No', val: false },
                  ].map(opt => (
                    <button
                      key={opt.label}
                      onClick={() => update('protection_unit_fitted', opt.val)}
                      className={`flex-1 h-9 text-sm rounded-md font-medium transition-colors ${
                        form.protection_unit_fitted === opt.val
                          ? 'bg-eq-sky text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Trip Unit & Ratings */}
          <div>
            <h4 className="text-sm font-semibold text-eq-ink mb-3">Trip Unit &amp; Ratings</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <InputField label="Trip Unit Model" value={form.trip_unit_model} onChange={v => update('trip_unit_model', v)} placeholder="e.g. Ekip Hi-Touch" />
              <SelectField label="Poles" value={form.cb_poles} onChange={v => update('cb_poles', v)} options={POLES_OPTIONS} />
              <InputField label="Rating IN (A)" value={form.current_in} onChange={v => update('current_in', v)} placeholder="e.g. 2000" />
              <SelectField label="Fixed / Withdrawable" value={form.fixed_withdrawable} onChange={v => update('fixed_withdrawable', v)} options={['Fixed', 'Withdrawable']} />
            </div>
          </div>

          {/* Protection Settings — conditional on protection unit fitted */}
          {form.protection_unit_fitted === true && (
            <div>
              <h4 className="text-sm font-semibold text-eq-ink mb-3">Protection Settings</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <InputField label="Long Time Ir" value={form.long_time_ir} onChange={v => update('long_time_ir', v)} placeholder="Ir setting" />
                <InputField label="Long Time Delay tr" value={form.long_time_delay_tr} onChange={v => update('long_time_delay_tr', v)} placeholder="tr setting" />
                <InputField label="Short Time Pickup Isd" value={form.short_time_pickup_isd} onChange={v => update('short_time_pickup_isd', v)} placeholder="Isd setting" />
                <InputField label="Short Time Delay tsd" value={form.short_time_delay_tsd} onChange={v => update('short_time_delay_tsd', v)} placeholder="tsd setting" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <InputField label="Instantaneous Pickup" value={form.instantaneous_pickup} onChange={v => update('instantaneous_pickup', v)} placeholder="Ii setting" />
                <InputField label="Earth Fault Pickup" value={form.earth_fault_pickup} onChange={v => update('earth_fault_pickup', v)} placeholder="Ig pickup" />
                <InputField label="Earth Fault Delay" value={form.earth_fault_delay} onChange={v => update('earth_fault_delay', v)} placeholder="Ig delay" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <InputField label="Earth Leakage Pickup" value={form.earth_leakage_pickup} onChange={v => update('earth_leakage_pickup', v)} placeholder="IΔn pickup" />
                <InputField label="Earth Leakage Delay" value={form.earth_leakage_delay} onChange={v => update('earth_leakage_delay', v)} placeholder="IΔn delay" />
              </div>
            </div>
          )}

          {/* Accessories */}
          <div>
            <h4 className="text-sm font-semibold text-eq-ink mb-3">Accessories</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <SelectField label="Motor Charge" value={form.motor_charge} onChange={v => update('motor_charge', v)} options={VOLTAGE_OPTIONS} />
              <SelectField label="Shunt Trip MX1" value={form.shunt_trip_mx1} onChange={v => update('shunt_trip_mx1', v)} options={VOLTAGE_OPTIONS} />
              <SelectField label="Shunt Close XF" value={form.shunt_close_xf} onChange={v => update('shunt_close_xf', v)} options={VOLTAGE_OPTIONS} />
              <SelectField label="Undervoltage MN" value={form.undervoltage_mn} onChange={v => update('undervoltage_mn', v)} options={VOLTAGE_OPTIONS} />
              <SelectField label="2nd Shunt Trip MX2" value={form.second_shunt_trip} onChange={v => update('second_shunt_trip', v)} options={VOLTAGE_OPTIONS} />
            </div>
          </div>

          {/* Save */}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !hasTest}>
              <Save className="w-4 h-4 mr-1" />
              {saving ? 'Saving...' : 'Save Collection Data'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

export function AcbSiteCollection({ assets, onUpdate }: AcbSiteCollectionProps) {
  if (assets.length === 0) {
    return (
      <Card className="p-8 text-center text-eq-grey">
        No E1.25 assets found for this site
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {assets.map(asset => (
        <AssetCollectionCard key={asset.id} asset={asset} onUpdate={onUpdate} />
      ))}
    </div>
  )
}
