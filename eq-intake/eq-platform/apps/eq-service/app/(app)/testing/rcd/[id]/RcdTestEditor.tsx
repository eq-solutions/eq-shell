'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { AlertTriangle, Pencil, X, Check } from 'lucide-react'
import { saveRcdTestCompleteAction } from './actions'

export interface RcdTestEditorCircuit {
  id: string
  section_label: string | null
  circuit_no: string
  normal_trip_current_ma: number
  x1_no_trip_0_ms: string | null
  x1_no_trip_180_ms: string | null
  x1_trip_0_ms: string | null
  x1_trip_180_ms: string | null
  x5_fast_0_ms: string | null
  x5_fast_180_ms: string | null
  trip_test_button_ok: boolean
  jemena_circuit_asset_id: string | null
  action_taken: string | null
  is_critical_load: boolean
}

export interface RcdTestEditorHeader {
  id: string
  test_date: string
  status: 'draft' | 'complete' | 'archived' | string
  technician_name_snapshot: string | null
  technician_initials: string | null
  site_rep_name: string | null
  equipment_used: string | null
  notes: string | null
  check_id: string | null
}

interface Props {
  test: RcdTestEditorHeader
  initialCircuits: RcdTestEditorCircuit[]
  canEdit: boolean
  siteName: string | null
  assetName: string | null
}

type CircuitDraft = RcdTestEditorCircuit & {
  /** When true, critical-load lock has been overridden in this session */
  override?: boolean
}

function statusToTone(status: string): 'active' | 'inactive' | 'in-progress' {
  if (status === 'complete') return 'active'
  if (status === 'archived') return 'inactive'
  return 'in-progress'
}

const TIMING_FIELDS = [
  ['x1_no_trip_0_ms', 'X1 No-Trip 0°'],
  ['x1_no_trip_180_ms', 'X1 No-Trip 180°'],
  ['x1_trip_0_ms', 'X1 Trip 0°'],
  ['x1_trip_180_ms', 'X1 Trip 180°'],
  ['x5_fast_0_ms', 'X5 Fast 0°'],
  ['x5_fast_180_ms', 'X5 Fast 180°'],
] as const

export function RcdTestEditor({
  test,
  initialCircuits,
  canEdit,
  siteName,
  assetName,
}: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Local drafts. Header fields are individual state slots so React doesn't
  // have to reconcile a giant blob on every keystroke.
  const [header, setHeader] = useState({
    technician_name_snapshot: test.technician_name_snapshot ?? '',
    technician_initials: test.technician_initials ?? '',
    site_rep_name: test.site_rep_name ?? '',
    equipment_used: test.equipment_used ?? '',
    notes: test.notes ?? '',
  })

  const [circuits, setCircuits] = useState<CircuitDraft[]>(
    initialCircuits.map((c) => ({ ...c })),
  )

  const sections = useMemo(() => {
    const map = new Map<string, CircuitDraft[]>()
    for (const c of circuits) {
      const key = c.section_label ?? '__default__'
      const arr = map.get(key) ?? []
      arr.push(c)
      map.set(key, arr)
    }
    return map
  }, [circuits])

  const isComplete = test.status === 'complete'
  const showEditUi = canEdit && editing && !isComplete

  function updateCircuit(id: string, patch: Partial<CircuitDraft>) {
    setCircuits((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function startEdit() {
    setEditing(true)
    setError(null)
    setSuccess(null)
  }

  function cancelEdit() {
    setEditing(false)
    setError(null)
    setSuccess(null)
    // Reset drafts to server state.
    setHeader({
      technician_name_snapshot: test.technician_name_snapshot ?? '',
      technician_initials: test.technician_initials ?? '',
      site_rep_name: test.site_rep_name ?? '',
      equipment_used: test.equipment_used ?? '',
      notes: test.notes ?? '',
    })
    setCircuits(initialCircuits.map((c) => ({ ...c })))
  }

  function persist({ markComplete }: { markComplete: boolean }) {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      // Audit #103: header + circuits go through a single transactional
      // action now. Previously these were two sequential server-action
      // round-trips; if the header write failed after circuits had
      // committed, the test was left half-applied (circuits saved,
      // status still draft) — broke AS/NZS 3760 compliance integrity.
      const circuitPayload = circuits.map((c) => ({
        id: c.id,
        x1_no_trip_0_ms: emptyToNull(c.x1_no_trip_0_ms),
        x1_no_trip_180_ms: emptyToNull(c.x1_no_trip_180_ms),
        x1_trip_0_ms: emptyToNull(c.x1_trip_0_ms),
        x1_trip_180_ms: emptyToNull(c.x1_trip_180_ms),
        x5_fast_0_ms: emptyToNull(c.x5_fast_0_ms),
        x5_fast_180_ms: emptyToNull(c.x5_fast_180_ms),
        trip_test_button_ok: c.trip_test_button_ok,
        action_taken: emptyToNull(c.action_taken),
        is_critical_load: c.is_critical_load,
      }))

      const headerPayload = {
        technician_name_snapshot: emptyToNull(header.technician_name_snapshot),
        technician_initials: emptyToNull(header.technician_initials),
        site_rep_name: emptyToNull(header.site_rep_name),
        equipment_used: emptyToNull(header.equipment_used),
        notes: emptyToNull(header.notes),
      }

      const res = await saveRcdTestCompleteAction(test.id, {
        header: headerPayload,
        circuits: circuitPayload,
        markComplete,
      })
      if (!res.success) {
        setError(res.error)
        return
      }

      setSuccess(
        markComplete
          ? 'Saved and marked complete. The linked maintenance check has been updated.'
          : `Saved ${res.updated ?? circuits.length} circuit value(s).`,
      )
      setEditing(false)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="border border-gray-200 rounded-lg bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-eq-deep uppercase tracking-wide">
            Test Header
          </h2>
          {canEdit && !isComplete && !editing && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={startEdit}
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              Edit values
            </Button>
          )}
          {isComplete && (
            <span className="text-xs text-eq-grey italic">
              Complete — re-open the linked check to make further changes.
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Date" value={test.test_date} />
          <Field label="Site" value={siteName ?? '—'} />
          <Field label="Board" value={assetName ?? '—'} />
          <Field label="Status" value={<StatusBadge status={statusToTone(test.status)} />} />
          {showEditUi ? (
            <>
              <EditField
                label="Technician"
                value={header.technician_name_snapshot}
                onChange={(v) => setHeader((p) => ({ ...p, technician_name_snapshot: v }))}
              />
              <EditField
                label="Initials"
                value={header.technician_initials}
                onChange={(v) => setHeader((p) => ({ ...p, technician_initials: v }))}
                mono
              />
              <EditField
                label="Site rep"
                value={header.site_rep_name}
                onChange={(v) => setHeader((p) => ({ ...p, site_rep_name: v }))}
              />
              <div /> {/* spacer to keep grid aligned */}
              <div className="col-span-2 md:col-span-4">
                <EditField
                  label="Equipment used"
                  value={header.equipment_used}
                  onChange={(v) => setHeader((p) => ({ ...p, equipment_used: v }))}
                />
              </div>
              <div className="col-span-2 md:col-span-4">
                <EditField
                  label="Notes"
                  value={header.notes}
                  onChange={(v) => setHeader((p) => ({ ...p, notes: v }))}
                  multiline
                />
              </div>
            </>
          ) : (
            <>
              <Field label="Technician" value={test.technician_name_snapshot ?? '—'} />
              <Field label="Initials" value={test.technician_initials ?? '—'} mono />
              <Field label="Site rep" value={test.site_rep_name ?? '—'} />
              <div />
              {test.equipment_used && (
                <div className="col-span-2 md:col-span-4">
                  <Field label="Equipment used" value={test.equipment_used} />
                </div>
              )}
              {test.notes && (
                <div className="col-span-2 md:col-span-4">
                  <Field label="Notes" value={test.notes} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Status messages */}
      {error && (
        <div className="border border-red-200 bg-red-50 rounded-lg px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      {success && (
        <div className="border border-green-200 bg-green-50 rounded-lg px-3 py-2 text-sm text-green-800">
          {success}
        </div>
      )}

      {/* Circuit table */}
      <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 bg-eq-ice flex items-center justify-between">
          <h2 className="text-sm font-bold text-eq-deep uppercase tracking-wide">
            Circuits ({circuits.length})
          </h2>
          <span className="text-xs text-eq-grey">
            All times in ms · &gt;310 = no trip · blank = not tested
          </span>
        </div>

        {circuits.length === 0 ? (
          <div className="p-6 text-center text-sm text-eq-grey">
            No circuit data recorded for this test yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-eq-grey">
                <tr>
                  <Th>Circuit #</Th>
                  <Th>Trip mA</Th>
                  <Th colSpan={2} className="text-center border-l border-gray-200">
                    X1 No-Trip
                  </Th>
                  <Th colSpan={2} className="text-center border-l border-gray-200">
                    X1 Trip
                  </Th>
                  <Th colSpan={2} className="text-center border-l border-gray-200">
                    X5 Fast
                  </Th>
                  <Th className="text-center border-l border-gray-200">Btn</Th>
                  <Th className="border-l border-gray-200">Asset ID</Th>
                  <Th className="border-l border-gray-200">Action</Th>
                </tr>
                <tr className="text-[10px]">
                  <Th></Th>
                  <Th></Th>
                  <Th className="text-center border-l border-gray-200">0°</Th>
                  <Th className="text-center">180°</Th>
                  <Th className="text-center border-l border-gray-200">0°</Th>
                  <Th className="text-center">180°</Th>
                  <Th className="text-center border-l border-gray-200">0°</Th>
                  <Th className="text-center">180°</Th>
                  <Th className="text-center border-l border-gray-200"></Th>
                  <Th className="border-l border-gray-200"></Th>
                  <Th className="border-l border-gray-200"></Th>
                </tr>
              </thead>
              <tbody>
                {Array.from(sections.entries()).map(([key, rows]) => (
                  <SectionGroup
                    key={key}
                    label={key === '__default__' ? null : key}
                    rows={rows}
                    editing={showEditUi}
                    onChange={updateCircuit}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action bar */}
      {showEditUi && (
        <div className="sticky bottom-0 bg-white border border-gray-200 rounded-lg p-3 shadow-sm flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={cancelEdit}
            disabled={pending}
          >
            <X className="w-4 h-4 mr-1.5" /> Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => persist({ markComplete: false })}
            loading={pending}
          >
            Save draft
          </Button>
          <Button
            type="button"
            onClick={() => persist({ markComplete: true })}
            loading={pending}
          >
            <Check className="w-4 h-4 mr-1.5" />
            Save &amp; mark complete
          </Button>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div>
      <div className="text-[10px] font-bold text-eq-grey uppercase tracking-wide mb-0.5">
        {label}
      </div>
      <div className={`text-sm text-eq-ink ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

function EditField({
  label,
  value,
  onChange,
  mono = false,
  multiline = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
  multiline?: boolean
}) {
  const cls = `w-full px-2 py-1 border border-gray-300 rounded text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-1 focus:ring-eq-sky/30 ${mono ? 'font-mono' : ''}`
  return (
    <div>
      <div className="text-[10px] font-bold text-eq-grey uppercase tracking-wide mb-0.5">
        {label}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className={cls}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      )}
    </div>
  )
}

function Th({
  children,
  colSpan,
  className = '',
}: {
  children?: React.ReactNode
  colSpan?: number
  className?: string
}) {
  return (
    <th colSpan={colSpan} className={`px-2 py-1.5 font-semibold text-left ${className}`}>
      {children}
    </th>
  )
}

function SectionGroup({
  label,
  rows,
  editing,
  onChange,
}: {
  label: string | null
  rows: CircuitDraft[]
  editing: boolean
  onChange: (id: string, patch: Partial<CircuitDraft>) => void
}) {
  return (
    <>
      {label && (
        <tr className="bg-eq-ice">
          <td
            colSpan={11}
            className="px-3 py-1.5 text-xs font-bold text-eq-deep uppercase tracking-wide"
          >
            {label}
          </td>
        </tr>
      )}
      {rows.map((c) => {
        const locked = c.is_critical_load && !c.override
        return (
          <tr
            key={c.id}
            className={`border-t border-gray-100 ${c.is_critical_load ? 'bg-amber-50' : ''}`}
          >
            <td className="px-2 py-1.5 font-mono text-eq-ink">{c.circuit_no}</td>
            <td className="px-2 py-1.5">{c.normal_trip_current_ma}</td>
            {TIMING_FIELDS.map(([key]) => (
              <td
                key={key}
                className="px-1 py-1 font-mono text-right border-l border-gray-100"
              >
                {editing ? (
                  locked ? (
                    <span className="text-amber-600 text-[10px] italic">locked</span>
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={(c[key] as string | null) ?? ''}
                      onChange={(e) => onChange(c.id, { [key]: e.target.value } as Partial<CircuitDraft>)}
                      className="w-14 px-1 py-0.5 border border-gray-300 rounded text-right text-xs font-mono focus:outline-none focus:border-eq-deep"
                    />
                  )
                ) : (
                  ((c[key] as string | null) ?? '—')
                )}
              </td>
            ))}
            <td className="px-2 py-1.5 text-center border-l border-gray-100">
              {editing ? (
                locked ? (
                  '—'
                ) : (
                  <input
                    type="checkbox"
                    checked={c.trip_test_button_ok}
                    onChange={(e) => onChange(c.id, { trip_test_button_ok: e.target.checked })}
                    className="rounded border-gray-300 text-eq-sky focus:ring-eq-sky"
                  />
                )
              ) : c.trip_test_button_ok ? (
                '✓'
              ) : (
                '—'
              )}
            </td>
            <td className="px-2 py-1.5 font-mono text-eq-grey border-l border-gray-100">
              {c.jemena_circuit_asset_id ?? '—'}
            </td>
            <td className="px-2 py-1.5 border-l border-gray-100">
              {c.is_critical_load && (
                <span className="inline-block mr-1.5 text-[10px] font-bold text-amber-700 uppercase tracking-wide">
                  CRITICAL
                </span>
              )}
              {editing ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={c.action_taken ?? ''}
                    onChange={(e) => onChange(c.id, { action_taken: e.target.value })}
                    placeholder={c.is_critical_load ? 'e.g. Tested with customer present' : 'Optional notes'}
                    className="flex-1 px-1.5 py-0.5 border border-gray-300 rounded text-xs focus:outline-none focus:border-eq-deep"
                  />
                  {c.is_critical_load && (
                    <label className="flex items-center gap-1 text-[10px] text-amber-700 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={c.override ?? false}
                        onChange={(e) => onChange(c.id, { override: e.target.checked })}
                        className="rounded border-amber-400 text-amber-600 focus:ring-amber-400"
                      />
                      Override
                    </label>
                  )}
                </div>
              ) : (
                c.action_taken ?? '—'
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const trimmed = v.trim()
  return trimmed === '' ? null : trimmed
}
