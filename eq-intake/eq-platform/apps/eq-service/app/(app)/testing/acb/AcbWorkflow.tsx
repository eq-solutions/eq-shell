'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import {
  updateAcbDetailsAction,
  saveAcbVisualCheckAction,
  saveAcbElectricalReadingAction,
  raiseTestDefectAction,
} from '@/app/(app)/testing/acb/actions'
import { CheckCircle2, AlertCircle, Zap, Save, ClipboardList, Eye } from 'lucide-react'
import type { AcbTest, AcbTestReading } from '@/lib/types'

/* ─── Props ─── */
interface AcbWorkflowProps {
  test: AcbTest
  readings: AcbTestReading[]
  onUpdate: () => void
}

type TabType = 'step1' | 'step2' | 'step3'

/* ─── Constants ─── */
const VOLTAGE_OPTIONS = ['Not installed', '24V', '48V', '110V', '120V', '240V', 'Other'] as const
const PERFORMANCE_LEVELS = ['N1', 'H1', 'H2', 'H3', 'L1'] as const
const POLES_OPTIONS = ['3', '4', 'Other'] as const

/* ─── Visual & Functional item definitions ─── */
const VISUAL_ITEMS = [
  // Visual Inspection (4)
  { label: 'General condition / cleanliness', section: 'Visual Inspection' },
  { label: 'Arc chute condition', section: 'Visual Inspection' },
  { label: 'Main contact condition', section: 'Visual Inspection' },
  { label: 'Auxiliary contact condition', section: 'Visual Inspection' },
  // Service Operations (3)
  { label: 'Mechanism lubrication', section: 'Service Operations' },
  { label: 'Racking mechanism operation', section: 'Service Operations' },
  { label: 'Spring charging mechanism', section: 'Service Operations' },
  // Functional Tests — Chassis (3)
  { label: 'Chassis earthing contact', section: 'Functional Tests Chassis' },
  { label: 'Shutter operation', section: 'Functional Tests Chassis' },
  { label: 'Operations counter reading', section: 'Functional Tests Chassis', numeric: true },
  // Functional Tests — Device (11)
  { label: 'Manual close', section: 'Functional Tests Device' },
  { label: 'Manual open (trip free)', section: 'Functional Tests Device' },
  { label: 'Electrical close', section: 'Functional Tests Device' },
  { label: 'Electrical open', section: 'Functional Tests Device' },
  { label: 'Spring charge motor operation', section: 'Functional Tests Device' },
  { label: 'Anti-pump function', section: 'Functional Tests Device' },
  { label: 'Undervoltage release operation', section: 'Functional Tests Device' },
  { label: 'Shunt trip operation', section: 'Functional Tests Device' },
  { label: 'Closing solenoid operation', section: 'Functional Tests Device' },
  { label: 'Position indication (open/closed)', section: 'Functional Tests Device' },
  { label: 'Auxiliary switch operation', section: 'Functional Tests Device' },
  // Auxiliaries (2)
  { label: 'Motor charge spring function', section: 'Auxiliaries' },
  { label: 'Communication module check', section: 'Auxiliaries' },
]

/* ─── Electrical test item definitions ─── */
const CONTACT_RESISTANCE_PHASES = ['Red', 'White', 'Blue', 'Neutral'] as const
const IR_CLOSED_COMBOS = [
  'R-W', 'R-B', 'W-B',
  'R-E', 'W-E', 'B-E',
  'R-N', 'W-N', 'B-N',
] as const
const IR_OPEN_COMBOS = ['R-R', 'W-W', 'B-B', 'N-N'] as const

/* ─── Helper components ─── */
function InputField({ label, value, onChange, placeholder, className, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; className?: string; type?: string
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-eq-grey mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 px-3 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
      />
    </div>
  )
}

function SelectField({ label, value, onChange, options, className }: {
  label: string; value: string; onChange: (v: string) => void
  options: readonly string[]; className?: string
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

function TriStateButton({ value, onChange }: {
  value: 'pass' | 'fail' | 'na'
  onChange: (v: 'pass' | 'fail' | 'na') => void
}) {
  // 44px minimum tap target — techs work in gloves on tablets/phones in plant
  // rooms. Combined with touch-manipulation (kills iOS ~300ms tap delay) and
  // active:scale (immediate tactile feedback for Simon's "takes a long time
  // to show as pressed" comment).
  return (
    <div className="flex gap-1">
      {(['pass', 'fail', 'na'] as const).map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`min-h-[44px] px-4 py-2 text-sm rounded font-medium select-none touch-manipulation active:scale-95 ${
            value === opt
              ? opt === 'pass'
                ? 'bg-green-600 text-white'
                : opt === 'fail'
                ? 'bg-red-600 text-white'
                : 'bg-gray-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {opt === 'pass' ? 'OK' : opt === 'fail' ? 'Not OK' : 'N/A'}
        </button>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   Main Workflow Component
   ═══════════════════════════════════════════════ */
export function AcbWorkflow({ test, readings, onUpdate }: AcbWorkflowProps) {
  // Default to step2 (Visual & Functional)
  const [activeTab, setActiveTab] = useState<TabType>('step2')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDefectPrompt, setShowDefectPrompt] = useState(false)
  const [defectTitle, setDefectTitle] = useState('')

  const getTabStatus = (tab: TabType) => {
    const status = test[`${tab}_status` as keyof AcbTest] as string
    if (status === 'complete') return 'complete'
    if (status === 'in_progress') return 'in-progress'
    return 'not-started'
  }

  const tabDefs = [
    { id: 'step1' as TabType, label: 'Asset Collection', icon: ClipboardList, status: getTabStatus('step1') },
    { id: 'step2' as TabType, label: 'Visual & Functional', icon: Eye, status: getTabStatus('step2') },
    { id: 'step3' as TabType, label: 'Electrical Testing', icon: Zap, status: getTabStatus('step3') },
  ]

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabDefs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-eq-sky text-eq-sky'
                  : 'border-transparent text-eq-grey hover:text-eq-ink'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {tab.status === 'complete' && <CheckCircle2 className="w-4 h-4 text-green-600" />}
              {tab.status === 'in-progress' && <div className="w-2 h-2 bg-amber-500 rounded-full" />}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{error}</div>
      )}

      {/* Tab Content */}
      {activeTab === 'step1' && (
        <Step1AssetCollection test={test} loading={loading} setLoading={setLoading} setError={setError} onUpdate={onUpdate} />
      )}
      {activeTab === 'step2' && (
        <Step2VisualFunctional
          test={test}
          readings={readings.filter(r => r.label?.includes('Visual Check:'))}
          loading={loading}
          setLoading={setLoading}
          setError={setError}
          onUpdate={onUpdate}
          onFailDetected={() => setShowDefectPrompt(true)}
        />
      )}
      {activeTab === 'step3' && (
        <Step3Electrical
          test={test}
          readings={readings.filter(r => r.label?.includes('Electrical:'))}
          loading={loading}
          setLoading={setLoading}
          setError={setError}
          onUpdate={onUpdate}
          onFailDetected={() => setShowDefectPrompt(true)}
        />
      )}

      {/* Defect Prompt */}
      {showDefectPrompt && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-900">Failures detected</p>
              <p className="text-xs text-red-700 mt-1">Raise a rectification item (defect)?</p>
            </div>
          </div>
          <div className="space-y-2">
            <input
              type="text"
              value={defectTitle}
              onChange={e => setDefectTitle(e.target.value)}
              placeholder="e.g. Failed visual inspection - arc chutes damaged"
              className="w-full h-9 px-3 text-sm border border-red-300 rounded-md bg-white placeholder-red-400"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  if (!defectTitle.trim()) { setError('Enter a defect title'); return }
                  setLoading(true)
                  const result = await raiseTestDefectAction({
                    asset_id: test.asset_id,
                    site_id: test.site_id,
                    title: defectTitle,
                    severity: 'high',
                  })
                  setLoading(false)
                  if (result.success) {
                    setShowDefectPrompt(false)
                    setDefectTitle('')
                    onUpdate()
                  } else {
                    setError(result.error ?? 'Failed to create defect')
                  }
                }}
                disabled={loading}
              >
                Create Defect
              </Button>
              <Button size="sm" variant="secondary" onClick={() => { setShowDefectPrompt(false); setDefectTitle('') }}>
                Skip
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   Tab 1: Asset Collection (per-asset)
   ═══════════════════════════════════════════════ */
function Step1AssetCollection({ test, loading, setLoading, setError, onUpdate }: {
  test: AcbTest; loading: boolean
  setLoading: (b: boolean) => void; setError: (e: string | null) => void; onUpdate: () => void
}) {
  const [form, setForm] = useState({
    brand: test.brand || '',
    breaker_type: test.breaker_type || '',
    name_location: test.name_location || '',
    cb_serial: test.cb_serial || '',
    performance_level: test.performance_level || '',
    protection_unit_fitted: test.protection_unit_fitted,
    trip_unit_model: test.trip_unit_model || '',
    cb_poles: test.cb_poles || '',
    current_in: test.current_in || '',
    fixed_withdrawable: test.fixed_withdrawable || '',
    long_time_ir: test.long_time_ir || '',
    long_time_delay_tr: test.long_time_delay_tr || '',
    short_time_pickup_isd: test.short_time_pickup_isd || '',
    short_time_delay_tsd: test.short_time_delay_tsd || '',
    instantaneous_pickup: test.instantaneous_pickup || '',
    earth_fault_pickup: test.earth_fault_pickup || '',
    earth_fault_delay: test.earth_fault_delay || '',
    earth_leakage_pickup: test.earth_leakage_pickup || '',
    earth_leakage_delay: test.earth_leakage_delay || '',
    motor_charge: test.motor_charge || 'Not installed',
    shunt_trip_mx1: test.shunt_trip_mx1 || 'Not installed',
    shunt_close_xf: test.shunt_close_xf || 'Not installed',
    undervoltage_mn: test.undervoltage_mn || 'Not installed',
    second_shunt_trip: test.second_shunt_trip || 'Not installed',
  })

  const update = (field: string, value: string | boolean | null) => setForm(prev => ({ ...prev, [field]: value }))

  async function handleSave() {
    setError(null)
    setLoading(true)
    const result = await updateAcbDetailsAction(test.id, {
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
    setLoading(false)
    if (result.success) onUpdate()
    else setError(result.error ?? 'Failed to save')
  }

  return (
    <Card className="p-6 space-y-6">
      {/* Breaker Identification */}
      <div>
        <h3 className="font-medium text-eq-ink mb-3">Breaker Identification</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <InputField label="Brand" value={form.brand} onChange={v => update('brand', v)} placeholder="e.g. ABB, Schneider" />
          <InputField label="Breaker Type" value={form.breaker_type} onChange={v => update('breaker_type', v)} placeholder="e.g. ACB" />
          <InputField label="Name / Location" value={form.name_location} onChange={v => update('name_location', v)} placeholder="e.g. MSB-ACB-01" />
          <InputField label="Serial Number" value={form.cb_serial} onChange={v => update('cb_serial', v)} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <SelectField label="Performance Level" value={form.performance_level} onChange={v => update('performance_level', v)} options={PERFORMANCE_LEVELS} />
          <div>
            <label className="block text-xs font-medium text-eq-grey mb-1">Protection Unit Fitted</label>
            <div className="flex gap-2 mt-1">
              {[{ label: 'Yes', val: true }, { label: 'No', val: false }].map(opt => (
                <button
                  key={opt.label}
                  onClick={() => update('protection_unit_fitted', opt.val)}
                  className={`flex-1 h-9 text-sm rounded-md font-medium transition-colors ${
                    form.protection_unit_fitted === opt.val ? 'bg-eq-sky text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
      <div className="border-t pt-4">
        <h3 className="font-medium text-eq-ink mb-3">Trip Unit &amp; Ratings</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <InputField label="Trip Unit Model" value={form.trip_unit_model} onChange={v => update('trip_unit_model', v)} placeholder="e.g. Ekip Hi-Touch" />
          <SelectField label="Poles" value={form.cb_poles} onChange={v => update('cb_poles', v)} options={POLES_OPTIONS} />
          <InputField label="Rating IN (A)" value={form.current_in} onChange={v => update('current_in', v)} placeholder="e.g. 2000" />
          <SelectField label="Fixed / Withdrawable" value={form.fixed_withdrawable} onChange={v => update('fixed_withdrawable', v)} options={['Fixed', 'Withdrawable']} />
        </div>
      </div>

      {/* Protection Settings */}
      {form.protection_unit_fitted === true && (
        <div className="border-t pt-4">
          <h3 className="font-medium text-eq-ink mb-3">Protection Settings</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <InputField label="Long Time Ir" value={form.long_time_ir} onChange={v => update('long_time_ir', v)} />
            <InputField label="Long Time Delay tr" value={form.long_time_delay_tr} onChange={v => update('long_time_delay_tr', v)} />
            <InputField label="Short Time Isd" value={form.short_time_pickup_isd} onChange={v => update('short_time_pickup_isd', v)} />
            <InputField label="Short Time Delay tsd" value={form.short_time_delay_tsd} onChange={v => update('short_time_delay_tsd', v)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <InputField label="Instantaneous Pickup" value={form.instantaneous_pickup} onChange={v => update('instantaneous_pickup', v)} />
            <InputField label="Earth Fault Pickup" value={form.earth_fault_pickup} onChange={v => update('earth_fault_pickup', v)} />
            <InputField label="Earth Fault Delay" value={form.earth_fault_delay} onChange={v => update('earth_fault_delay', v)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <InputField label="Earth Leakage Pickup" value={form.earth_leakage_pickup} onChange={v => update('earth_leakage_pickup', v)} />
            <InputField label="Earth Leakage Delay" value={form.earth_leakage_delay} onChange={v => update('earth_leakage_delay', v)} />
          </div>
        </div>
      )}

      {/* Accessories */}
      <div className="border-t pt-4">
        <h3 className="font-medium text-eq-ink mb-3">Accessories</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SelectField label="Motor Charge" value={form.motor_charge} onChange={v => update('motor_charge', v)} options={VOLTAGE_OPTIONS} />
          <SelectField label="Shunt Trip MX1" value={form.shunt_trip_mx1} onChange={v => update('shunt_trip_mx1', v)} options={VOLTAGE_OPTIONS} />
          <SelectField label="Shunt Close XF" value={form.shunt_close_xf} onChange={v => update('shunt_close_xf', v)} options={VOLTAGE_OPTIONS} />
          <SelectField label="Undervoltage MN" value={form.undervoltage_mn} onChange={v => update('undervoltage_mn', v)} options={VOLTAGE_OPTIONS} />
          <SelectField label="2nd Shunt MX2" value={form.second_shunt_trip} onChange={v => update('second_shunt_trip', v)} options={VOLTAGE_OPTIONS} />
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} loading={loading}>
          <Save className="w-4 h-4 mr-1" />
          Complete Asset Collection
        </Button>
      </div>
    </Card>
  )
}

/* ═══════════════════════════════════════════════
   Tab 2: Visual & Functional (23 items)
   ═══════════════════════════════════════════════ */
function Step2VisualFunctional({ test, readings, loading, setLoading, setError, onUpdate, onFailDetected }: {
  test: AcbTest; readings: AcbTestReading[]; loading: boolean
  setLoading: (b: boolean) => void; setError: (e: string | null) => void
  onUpdate: () => void; onFailDetected: () => void
}) {
  const [items, setItems] = useState<Array<{
    label: string; section: string; result: 'pass' | 'fail' | 'na'; comment: string; numeric?: boolean
  }>>(() => {
    if (readings.length > 0) {
      return VISUAL_ITEMS.map(vi => {
        const r = readings.find(rd => rd.label === `Visual Check: ${vi.label}`)
        return {
          ...vi,
          result: r ? (r.is_pass === true ? 'pass' : r.is_pass === false ? 'fail' : 'na') : 'pass',
          comment: r?.value || '',
        }
      })
    }
    return VISUAL_ITEMS.map(vi => ({ ...vi, result: 'pass' as const, comment: '' }))
  })

  const sections = useMemo(() => {
    const map = new Map<string, number[]>()
    items.forEach((item, idx) => {
      if (!map.has(item.section)) map.set(item.section, [])
      map.get(item.section)!.push(idx)
    })
    return map
  }, [items])

  async function handleSave() {
    setError(null)
    setLoading(true)
    const saveItems = items.map(i => ({
      label: i.label,
      result: i.result,
      comment: i.comment || undefined,
    }))
    const result = await saveAcbVisualCheckAction(test.id, saveItems)
    setLoading(false)
    if (result.success) {
      if (items.some(i => i.result === 'fail')) onFailDetected()
      onUpdate()
    } else {
      setError(result.error ?? 'Failed to save')
    }
  }

  const hasFails = items.some(i => i.result === 'fail')

  return (
    <Card className="p-6 space-y-6">
      {Array.from(sections.entries()).map(([sectionName, indices]) => (
        <div key={sectionName}>
          <h3 className="font-medium text-eq-ink mb-3 text-sm uppercase tracking-wide">{sectionName}</h3>
          <div className="space-y-2">
            {indices.map(idx => {
              const item = items[idx]
              return (
                <div key={idx} className="p-3 border border-gray-200 rounded-md space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-sm font-medium text-eq-ink flex-1">{item.label}</label>
                    {item.numeric ? (
                      <input
                        type="text"
                        value={item.comment}
                        onChange={e => {
                          const newItems = [...items]
                          newItems[idx].comment = e.target.value
                          setItems(newItems)
                        }}
                        placeholder="Counter reading"
                        className="w-32 h-8 px-2 text-sm border border-gray-200 rounded text-center"
                      />
                    ) : (
                      <TriStateButton
                        value={item.result}
                        onChange={v => {
                          const newItems = [...items]
                          newItems[idx].result = v
                          setItems(newItems)
                        }}
                      />
                    )}
                  </div>
                  {item.result === 'fail' && !item.numeric && (
                    <input
                      type="text"
                      value={item.comment}
                      onChange={e => {
                        const newItems = [...items]
                        newItems[idx].comment = e.target.value
                        setItems(newItems)
                      }}
                      placeholder="Comment on failure..."
                      className="w-full px-2 py-1 text-xs border border-red-300 rounded bg-red-50 placeholder-red-400"
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {hasFails && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
          <p className="text-xs text-red-700">Failures detected — a defect can be raised on save.</p>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} loading={loading}>
          <Save className="w-4 h-4 mr-1" />
          Complete Visual & Functional
        </Button>
      </div>
    </Card>
  )
}

/* ═══════════════════════════════════════════════
   Tab 3: Electrical Testing
   ═══════════════════════════════════════════════ */
function Step3Electrical({ test, readings, loading, setLoading, setError, onUpdate, onFailDetected }: {
  test: AcbTest; readings: AcbTestReading[]; loading: boolean
  setLoading: (b: boolean) => void; setError: (e: string | null) => void
  onUpdate: () => void; onFailDetected: () => void
}) {
  // Contact resistance
  const [contactRes, setContactRes] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const phase of CONTACT_RESISTANCE_PHASES) {
      const r = readings.find(rd => rd.label === `Electrical: Contact Resistance ${phase}`)
      map[phase] = r?.value || ''
    }
    return map
  })

  // IR Closed
  const [irClosed, setIrClosed] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const combo of IR_CLOSED_COMBOS) {
      const r = readings.find(rd => rd.label === `Electrical: IR Closed ${combo}`)
      map[combo] = r?.value || ''
    }
    return map
  })

  // IR Open
  const [irOpen, setIrOpen] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const combo of IR_OPEN_COMBOS) {
      const r = readings.find(rd => rd.label === `Electrical: IR Open ${combo}`)
      map[combo] = r?.value || ''
    }
    return map
  })

  // Secondary injection
  const [secondaryInjection, setSecondaryInjection] = useState<'pass' | 'fail' | 'na'>(() => {
    const r = readings.find(rd => rd.label === 'Electrical: Secondary Injection')
    if (!r) return 'pass'
    return r.is_pass === true ? 'pass' : r.is_pass === false ? 'fail' : 'na'
  })

  // Maintenance completion
  const [greasing, setGreasing] = useState<'pass' | 'fail' | 'na'>(() => {
    const r = readings.find(rd => rd.label === 'Electrical: Greasing')
    if (!r) return 'pass'
    return r.is_pass === true ? 'pass' : r.is_pass === false ? 'fail' : 'na'
  })
  const [opCounter, setOpCounter] = useState(() => {
    const r = readings.find(rd => rd.label === 'Electrical: Op Counter')
    return r?.value || ''
  })
  const [racking, setRacking] = useState<'pass' | 'fail' | 'na'>(() => {
    const r = readings.find(rd => rd.label === 'Electrical: Racking')
    if (!r) return 'pass'
    return r.is_pass === true ? 'pass' : r.is_pass === false ? 'fail' : 'na'
  })

  // 30% variance warning for contact resistance — phases only (exclude Neutral)
  const contactValues = (['Red', 'White', 'Blue'] as const)
    .map(p => parseFloat(contactRes[p] ?? ''))
    .filter(v => !isNaN(v))
  const contactVarianceWarning = useMemo(() => {
    if (contactValues.length < 2) return false
    const avg = contactValues.reduce((a, b) => a + b, 0) / contactValues.length
    if (avg === 0) return false
    return contactValues.some(v => Math.abs(v - avg) / avg > 0.3)
  }, [contactRes])

  async function handleSave() {
    setError(null)
    setLoading(true)

    const allReadings: Array<{ label: string; value: string; unit: string; is_pass?: boolean }> = []

    // Contact Resistance
    for (const phase of CONTACT_RESISTANCE_PHASES) {
      if (contactRes[phase]) {
        allReadings.push({ label: `Contact Resistance ${phase}`, value: contactRes[phase], unit: 'µΩ' })
      }
    }

    // IR Closed
    for (const combo of IR_CLOSED_COMBOS) {
      if (irClosed[combo]) {
        allReadings.push({ label: `IR Closed ${combo}`, value: irClosed[combo], unit: 'MΩ' })
      }
    }

    // IR Open
    for (const combo of IR_OPEN_COMBOS) {
      if (irOpen[combo]) {
        allReadings.push({ label: `IR Open ${combo}`, value: irOpen[combo], unit: 'MΩ' })
      }
    }

    // Secondary injection
    allReadings.push({
      label: 'Secondary Injection',
      value: secondaryInjection.toUpperCase(),
      unit: '',
      is_pass: secondaryInjection === 'pass' ? true : secondaryInjection === 'fail' ? false : undefined,
    })

    // Maintenance completion
    allReadings.push({
      label: 'Greasing',
      value: greasing.toUpperCase(),
      unit: '',
      is_pass: greasing === 'pass' ? true : greasing === 'fail' ? false : undefined,
    })
    if (opCounter) {
      allReadings.push({ label: 'Op Counter', value: opCounter, unit: '' })
    }
    allReadings.push({
      label: 'Racking',
      value: racking.toUpperCase(),
      unit: '',
      is_pass: racking === 'pass' ? true : racking === 'fail' ? false : undefined,
    })

    const result = await saveAcbElectricalReadingAction(test.id, allReadings)
    setLoading(false)
    if (result.success) {
      const hasFails = allReadings.some(r => r.is_pass === false)
      if (hasFails) onFailDetected()
      onUpdate()
    } else {
      setError(result.error ?? 'Failed to save')
    }
  }

  return (
    <Card className="p-6 space-y-6">
      {/* Contact Resistance */}
      <div>
        <h3 className="font-medium text-eq-ink mb-3">Contact Resistance (µΩ)</h3>
        <div className="grid grid-cols-4 gap-3">
          {CONTACT_RESISTANCE_PHASES.map(phase => (
            <InputField
              key={phase}
              label={phase}
              value={contactRes[phase]}
              onChange={v => setContactRes(prev => ({ ...prev, [phase]: v }))}
              placeholder="µΩ"
              type="number"
            />
          ))}
        </div>
        {contactVarianceWarning && (
          <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-md flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700">Contact resistance readings vary by more than 30% — investigate before proceeding.</p>
          </div>
        )}
      </div>

      {/* IR Closed */}
      <div className="border-t pt-4">
        <h3 className="font-medium text-eq-ink mb-3">Insulation Resistance — Closed (MΩ)</h3>
        <div className="grid grid-cols-3 gap-3">
          {IR_CLOSED_COMBOS.map(combo => (
            <InputField
              key={combo}
              label={combo}
              value={irClosed[combo]}
              onChange={v => setIrClosed(prev => ({ ...prev, [combo]: v }))}
              placeholder="MΩ"
              type="number"
            />
          ))}
        </div>
      </div>

      {/* IR Open */}
      <div className="border-t pt-4">
        <h3 className="font-medium text-eq-ink mb-3">Insulation Resistance — Open (MΩ)</h3>
        <div className="grid grid-cols-4 gap-3">
          {IR_OPEN_COMBOS.map(combo => (
            <InputField
              key={combo}
              label={combo}
              value={irOpen[combo]}
              onChange={v => setIrOpen(prev => ({ ...prev, [combo]: v }))}
              placeholder="MΩ"
              type="number"
            />
          ))}
        </div>
      </div>

      {/* Secondary Injection */}
      <div className="border-t pt-4">
        <h3 className="font-medium text-eq-ink mb-3">Secondary Injection Check</h3>
        <TriStateButton value={secondaryInjection} onChange={setSecondaryInjection} />
      </div>

      {/* Maintenance Completion */}
      <div className="border-t pt-4">
        <h3 className="font-medium text-eq-ink mb-3">Maintenance Completion</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 border border-gray-200 rounded-md">
            <label className="text-sm font-medium text-eq-ink">Greasing completed</label>
            <TriStateButton value={greasing} onChange={setGreasing} />
          </div>
          <div className="flex items-center justify-between p-3 border border-gray-200 rounded-md gap-4">
            <label className="text-sm font-medium text-eq-ink">Operations counter</label>
            <input
              type="text"
              value={opCounter}
              onChange={e => setOpCounter(e.target.value)}
              placeholder="Counter reading"
              className="w-32 h-8 px-2 text-sm border border-gray-200 rounded text-center"
            />
          </div>
          <div className="flex items-center justify-between p-3 border border-gray-200 rounded-md">
            <label className="text-sm font-medium text-eq-ink">Racking in/out completed</label>
            <TriStateButton value={racking} onChange={setRacking} />
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} loading={loading}>
          <Zap className="w-4 h-4 mr-1" />
          Complete Electrical Testing
        </Button>
      </div>
    </Card>
  )
}
