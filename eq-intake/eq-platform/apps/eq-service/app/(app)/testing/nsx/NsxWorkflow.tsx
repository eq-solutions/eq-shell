'use client'

/**
 * NSX Workflow — 3-step workflow mirroring ACB.
 *
 * Step 1: Asset Collection (NSX breaker identification + protection settings).
 * Step 2: Visual & Functional — 23 items across 5 sections, mirrors ACB.
 * Step 3: Electrical Testing — contact resistance, IR closed/open,
 *         secondary injection, maintenance completion. Mirrors ACB.
 *
 * Note on field parity: this is a deliberate verbatim port of the ACB checklists
 * (per Royce: "the scaffold says mirror ACB — mirror it"). A handful of items
 * (arc chutes, spring-charging mechanism, operations counter) are more
 * characteristic of air circuit breakers than moulded-case breakers and can be
 * marked N/A in the field. A follow-up pass with a field tech can trim the list
 * to NSX-specific items without touching the schema.
 */

import { useState, useMemo, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import {
  CheckCircle2,
  Clock,
  ClipboardList,
  Wrench,
  Zap,
  AlertCircle,
  Save,
  Eye,
} from 'lucide-react'
import type { NsxTest, NsxTestReading } from '@/lib/types'
import {
  updateNsxDetailsAction,
  saveNsxVisualCheckAction,
  saveNsxElectricalReadingAction,
  raiseNsxTestDefectAction,
} from '@/app/(app)/testing/nsx/actions'

type StepKey = 'step1' | 'step2' | 'step3'
type StepStatus = 'pending' | 'in_progress' | 'complete'

interface NsxWorkflowProps {
  test: NsxTest
  readings?: NsxTestReading[]
  onUpdate: () => void | Promise<void>
}

/* ─── Visual & Functional item definitions (mirrors ACB) ─── */
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

/* ─── Electrical test item definitions (mirrors ACB) ─── */
const CONTACT_RESISTANCE_PHASES = ['Red', 'White', 'Blue', 'Neutral'] as const
const IR_CLOSED_COMBOS = [
  'R-W', 'R-B', 'W-B',
  'R-E', 'W-E', 'B-E',
  'R-N', 'W-N', 'B-N',
] as const
const IR_OPEN_COMBOS = ['R-R', 'W-W', 'B-B', 'N-N'] as const

const STEPS: { key: StepKey; label: string; icon: typeof ClipboardList }[] = [
  { key: 'step1', label: 'Asset Collection', icon: ClipboardList },
  { key: 'step2', label: 'Visual & Functional', icon: Eye },
  { key: 'step3', label: 'Electrical Testing', icon: Zap },
]

function stepStatus(test: NsxTest, step: StepKey): StepStatus {
  return test[`${step}_status`] as StepStatus
}

function StatusPill({ status }: { status: StepStatus }) {
  if (status === 'complete') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
        <CheckCircle2 className="w-3 h-3" /> Complete
      </span>
    )
  }
  if (status === 'in_progress') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
        <Clock className="w-3 h-3" /> In Progress
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
      Not Started
    </span>
  )
}

/* ─── Small local primitives (kept local so this file is self-contained) ─── */
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
export function NsxWorkflow({ test, readings = [], onUpdate }: NsxWorkflowProps) {
  // Default to Visual & Functional (mirrors ACB)
  const [activeStep, setActiveStep] = useState<StepKey>('step2')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showDefectPrompt, setShowDefectPrompt] = useState(false)
  const [defectTitle, setDefectTitle] = useState('')
  const [loading, setLoading] = useState(false)

  function save(data: Parameters<typeof updateNsxDetailsAction>[1]) {
    setError(null)
    startTransition(async () => {
      const res = await updateNsxDetailsAction(test.id, data)
      if (!res.success) setError(res.error ?? 'Save failed.')
      else await onUpdate()
    })
  }

  function markStepComplete(step: StepKey) {
    save({ [`${step}_status`]: 'complete' } as Parameters<typeof updateNsxDetailsAction>[1])
  }

  return (
    <div className="space-y-6">
      {/* Step selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {STEPS.map((s) => {
          const status = stepStatus(test, s.key)
          const active = activeStep === s.key
          const Icon = s.icon
          return (
            <button
              key={s.key}
              onClick={() => setActiveStep(s.key)}
              className={`text-left p-4 rounded-lg border transition-all ${
                active
                  ? 'border-eq-sky bg-eq-ice/40 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-eq-sky/50'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${active ? 'text-eq-sky' : 'text-eq-grey'}`} />
                  <span className={`text-sm font-semibold ${active ? 'text-eq-sky' : 'text-eq-ink'}`}>
                    {s.label}
                  </span>
                </div>
                <StatusPill status={status} />
              </div>
              <p className="text-xs text-eq-grey">Step {s.key.slice(-1)}</p>
            </button>
          )
        })}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Step bodies */}
      {activeStep === 'step1' && (
        <Step1AssetCollection
          test={test}
          onSave={save}
          onMarkComplete={() => markStepComplete('step1')}
          pending={pending}
        />
      )}
      {activeStep === 'step2' && (
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
      {activeStep === 'step3' && (
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

      {/* Defect prompt */}
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
              placeholder="e.g. NSX failed visual inspection — auxiliary contact worn"
              className="w-full h-9 px-3 text-sm border border-red-300 rounded-md bg-white placeholder-red-400"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  if (!defectTitle.trim()) { setError('Enter a defect title'); return }
                  setLoading(true)
                  const result = await raiseNsxTestDefectAction({
                    asset_id: test.asset_id,
                    site_id: test.site_id,
                    title: defectTitle,
                    severity: 'high',
                  })
                  setLoading(false)
                  if (result.success) {
                    setShowDefectPrompt(false)
                    setDefectTitle('')
                    await onUpdate()
                  } else {
                    setError(result.error ?? 'Failed to create defect')
                  }
                }}
                disabled={loading}
              >
                Create Defect
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { setShowDefectPrompt(false); setDefectTitle('') }}
              >
                Skip
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ────────── Step 1: Asset Collection ────────── */
function Step1AssetCollection({
  test,
  onSave,
  onMarkComplete,
  pending,
}: {
  test: NsxTest
  onSave: (data: Parameters<typeof updateNsxDetailsAction>[1]) => void
  onMarkComplete: () => void
  pending: boolean
}) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    onSave({
      brand: (fd.get('brand') as string) || null,
      breaker_type: (fd.get('breaker_type') as string) || null,
      name_location: (fd.get('name_location') as string) || null,
      cb_serial: (fd.get('cb_serial') as string) || null,
      current_in: (fd.get('current_in') as string) || null,
      trip_unit_model: (fd.get('trip_unit_model') as string) || null,
      cb_poles: (fd.get('cb_poles') as string) || null,
      fixed_withdrawable: ((fd.get('fixed_withdrawable') as string) || null) as 'fixed' | 'withdrawable' | 'plug_in' | null,
      long_time_ir: (fd.get('long_time_ir') as string) || null,
      long_time_delay_tr: (fd.get('long_time_delay_tr') as string) || null,
      short_time_pickup_isd: (fd.get('short_time_pickup_isd') as string) || null,
      short_time_delay_tsd: (fd.get('short_time_delay_tsd') as string) || null,
      instantaneous_pickup: (fd.get('instantaneous_pickup') as string) || null,
      earth_fault_pickup: (fd.get('earth_fault_pickup') as string) || null,
      earth_fault_delay: (fd.get('earth_fault_delay') as string) || null,
      step1_status: 'in_progress',
    })
  }

  return (
    <Card className="p-6">
      <h3 className="text-sm font-bold text-eq-ink mb-4">Asset Collection — NSX Breaker Identification</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <FormInput label="Brand" name="brand" defaultValue={test.brand ?? ''} placeholder="e.g. Schneider" />
          <FormInput label="Breaker Type" name="breaker_type" defaultValue={test.breaker_type ?? ''} placeholder="e.g. NSX250" />
          <FormInput label="Name / Location" name="name_location" defaultValue={test.name_location ?? ''} />
          <FormInput label="Serial Number" name="cb_serial" defaultValue={test.cb_serial ?? ''} />
          <FormInput label="Current In (A)" name="current_in" defaultValue={test.current_in ?? ''} />
          <FormInput label="Trip Unit Model" name="trip_unit_model" defaultValue={test.trip_unit_model ?? ''} />
          <FormInput label="Poles" name="cb_poles" defaultValue={test.cb_poles ?? ''} placeholder="e.g. 3P" />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase">Mounting</label>
            <select
              name="fixed_withdrawable"
              defaultValue={test.fixed_withdrawable ?? ''}
              className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
            >
              <option value="">—</option>
              <option value="fixed">Fixed</option>
              <option value="withdrawable">Withdrawable</option>
              <option value="plug_in">Plug-in</option>
            </select>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-bold text-eq-grey uppercase mt-2 mb-2">Protection Settings</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FormInput label="Long Time Ir" name="long_time_ir" defaultValue={test.long_time_ir ?? ''} />
            <FormInput label="Long Time tr" name="long_time_delay_tr" defaultValue={test.long_time_delay_tr ?? ''} />
            <FormInput label="Short Time Isd" name="short_time_pickup_isd" defaultValue={test.short_time_pickup_isd ?? ''} />
            <FormInput label="Short Time tsd" name="short_time_delay_tsd" defaultValue={test.short_time_delay_tsd ?? ''} />
            <FormInput label="Instantaneous" name="instantaneous_pickup" defaultValue={test.instantaneous_pickup ?? ''} />
            <FormInput label="Earth Fault Pickup" name="earth_fault_pickup" defaultValue={test.earth_fault_pickup ?? ''} />
            <FormInput label="Earth Fault Delay" name="earth_fault_delay" defaultValue={test.earth_fault_delay ?? ''} />
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <Button type="submit" loading={pending}>
            Save Collection
          </Button>
          <Button type="button" variant="secondary" onClick={onMarkComplete} loading={pending}>
            Mark Step Complete
          </Button>
        </div>
      </form>
    </Card>
  )
}

/* ═══════════════════════════════════════════════
   Step 2: Visual & Functional (23 items — mirrors ACB)
   ═══════════════════════════════════════════════ */
function Step2VisualFunctional({ test, readings, loading, setLoading, setError, onUpdate, onFailDetected }: {
  test: NsxTest
  readings: NsxTestReading[]
  loading: boolean
  setLoading: (b: boolean) => void
  setError: (e: string | null) => void
  onUpdate: () => void | Promise<void>
  onFailDetected: () => void
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
    const result = await saveNsxVisualCheckAction(test.id, saveItems)
    setLoading(false)
    if (result.success) {
      if (items.some(i => i.result === 'fail')) onFailDetected()
      await onUpdate()
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
   Step 3: Electrical Testing (mirrors ACB)
   ═══════════════════════════════════════════════ */
function Step3Electrical({ test, readings, loading, setLoading, setError, onUpdate, onFailDetected }: {
  test: NsxTest
  readings: NsxTestReading[]
  loading: boolean
  setLoading: (b: boolean) => void
  setError: (e: string | null) => void
  onUpdate: () => void | Promise<void>
  onFailDetected: () => void
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

    const result = await saveNsxElectricalReadingAction(test.id, allReadings)
    setLoading(false)
    if (result.success) {
      const hasFails = allReadings.some(r => r.is_pass === false)
      if (hasFails) onFailDetected()
      await onUpdate()
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
            <p className="text-xs text-amber-700">
              Contact resistance readings vary by more than 30% — investigate before proceeding.
            </p>
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
