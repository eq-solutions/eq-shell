'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CsvExportButton } from '@/components/ui/CsvExportButton'
import { ImportCSVModal } from '@/components/ui/ImportCSVModal'
import type { ImportCSVConfig } from '@/components/ui/ImportCSVModal'
import { FrequencyBadges, FREQUENCY_DEFS, type FrequencyKey } from '@/components/ui/FrequencyBadges'
import { updateJobPlanItemAction, importJobPlanItemsAction } from '../actions'
import type { JobPlanItem } from '@/lib/types'

type Row = JobPlanItem & {
  plan_id: string
  plan_name: string
  plan_code: string | null
  plan_type: string | null
  plan_active: boolean
  site_id: string | null
  site_name: string | null
}

interface Props {
  rows: Row[]
  sites: { id: string; name: string }[]
  canWrite: boolean
}

type SortKey = 'plan_code' | 'plan_name' | 'site_name' | 'sort_order' | 'description' | 'is_required'
type SortDir = 'asc' | 'desc'

const FREQUENCY_FILTERS: { key: FrequencyKey; label: string }[] = FREQUENCY_DEFS.map((f) => ({
  key: f.key,
  label: f.label,
}))

/**
 * Filterable / sortable / exportable master register of maintenance plan items.
 *
 * Filtering is fully client-side. The dataset is small enough that filtering
 * in memory feels instant and we get a free debounce on every keystroke.
 *
 * Inline frequency editing: clicking a frequency badge cell pops a checkbox
 * grid that calls the existing updateJobPlanItemAction with only the freq
 * fields set. The action's partial-update path makes this safe — we never
 * touch description / sort_order / is_required.
 */
export function JobPlanItemsRegister({ rows: initialRows, sites, canWrite }: Props) {
  const [rows, setRows] = useState<Row[]>(initialRows)
  const [search, setSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [freqFilter, setFreqFilter] = useState<FrequencyKey | ''>('')
  const [requiredFilter, setRequiredFilter] = useState<'' | 'yes' | 'no'>('')
  const [sortKey, setSortKey] = useState<SortKey>('plan_code')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  // Distinct plans for the plan dropdown — derived from current rows.
  // 2026-04-28 (Royce review): Equinix plans store the descriptive label in
  // `type` ("24v /48v Battery Charger") and use `name` for the version
  // identifier ("E1.29.2"). Jemena's plans put the description in `name`.
  // To show readable labels regardless of which convention a tenant uses,
  // we concatenate the human-readable parts (deduped) so the dropdown reads
  // as e.g. "24VBTCHGR — E1.29.2 · 24v /48v Battery Charger" for Equinix
  // and "JEMENA-RCD-TEST — Jemena RCD Testing" for Jemena.
  const planOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>()
    for (const r of initialRows) {
      const descriptors = [r.plan_name, r.plan_type]
        .filter((v): v is string => !!v)
        .filter((v, i, arr) => arr.indexOf(v) === i)  // dedupe
      const desc = descriptors.join(' · ')
      const label = r.plan_code ? `${r.plan_code} — ${desc || r.plan_name}` : desc || r.plan_name
      if (!map.has(r.plan_id)) map.set(r.plan_id, { id: r.plan_id, label })
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [initialRows])

  // CSV round-trip import config
  const yToBool = (v: string | undefined) => v?.trim().toUpperCase() === 'Y'
  const importConfig: ImportCSVConfig<{
    item_id: string | null
    plan_id: string | null
    description: string | null
    sort_order: number | null
    is_required: boolean
    dark_site: boolean
    freq_monthly: boolean
    freq_quarterly: boolean
    freq_semi_annual: boolean
    freq_annual: boolean
    freq_2yr: boolean
    freq_3yr: boolean
    freq_5yr: boolean
    freq_8yr: boolean
    freq_10yr: boolean
  }> = {
    entityName: 'Maintenance Plan Items',
    requiredColumns: ['description'],
    optionalColumns: [
      'item_id', 'plan_id', 'sort_order', 'required',
      'dark_site', 'monthly', 'quarterly', 'semi_annual', 'annual',
      'yr2', 'yr3', 'yr5', 'yr8', 'yr10',
    ],
    mapRow: (row, columnMap) => {
      const desc = row[columnMap['description']]?.trim()
      if (!desc) return null
      return {
        item_id: row[columnMap['item_id']]?.trim() || null,
        plan_id: row[columnMap['plan_id']]?.trim() || null,
        description: desc,
        sort_order: columnMap['sort_order'] ? parseInt(row[columnMap['sort_order']] ?? '0', 10) || 0 : null,
        is_required: (row[columnMap['required']]?.trim().toLowerCase() ?? 'yes') !== 'no',
        dark_site: yToBool(row[columnMap['dark_site']]),
        freq_monthly: yToBool(row[columnMap['monthly']]),
        freq_quarterly: yToBool(row[columnMap['quarterly']]),
        freq_semi_annual: yToBool(row[columnMap['semi_annual']]),
        freq_annual: yToBool(row[columnMap['annual']]),
        freq_2yr: yToBool(row[columnMap['yr2']]),
        freq_3yr: yToBool(row[columnMap['yr3']]),
        freq_5yr: yToBool(row[columnMap['yr5']]),
        freq_8yr: yToBool(row[columnMap['yr8']]),
        freq_10yr: yToBool(row[columnMap['yr10']]),
      }
    },
    importAction: importJobPlanItemsAction,
  }

  // Apply filters then sort.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    let out = rows.filter((r) => {
      if (siteFilter && r.site_id !== siteFilter) return false
      if (planFilter && r.plan_id !== planFilter) return false
      if (freqFilter && !r[freqFilter]) return false
      if (requiredFilter === 'yes' && !r.is_required) return false
      if (requiredFilter === 'no' && r.is_required) return false
      if (needle) {
        const hay = [r.description, r.plan_name, r.plan_code, r.plan_type, r.site_name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    out = [...out].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      let cmp = 0
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
      else cmp = String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return out
  }, [rows, search, siteFilter, planFilter, freqFilter, requiredFilter, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return <ArrowUpDown className="w-3 h-3 inline ml-1 opacity-40" />
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 inline ml-1" />
      : <ArrowDown className="w-3 h-3 inline ml-1" />
  }

  // Build CSV-friendly row shape. item_id and plan_id are included so the
  // round-trip import can match existing rows (update) or create new ones.
  const csvRows = useMemo(
    () => filtered.map((r) => ({
      item_id: r.id,
      plan_id: r.plan_id,
      job_code: r.plan_code ?? '',
      plan: r.plan_name,
      type: r.plan_type ?? '',
      site: r.site_name ?? '(global)',
      task_no: r.sort_order,
      description: r.description,
      required: r.is_required ? 'Yes' : 'No',
      dark_site: r.dark_site ? 'Y' : '',
      monthly: r.freq_monthly ? 'Y' : '',
      quarterly: r.freq_quarterly ? 'Y' : '',
      semi_annual: r.freq_semi_annual ? 'Y' : '',
      annual: r.freq_annual ? 'Y' : '',
      yr2: r.freq_2yr ? 'Y' : '',
      yr3: r.freq_3yr ? 'Y' : '',
      yr5: r.freq_5yr ? 'Y' : '',
      yr8: r.freq_8yr ? 'Y' : '',
      yr10: r.freq_10yr ? 'Y' : '',
    })),
    [filtered],
  )

  function handleSaveFrequencies(row: Row, next: Partial<Pick<Row, FrequencyKey | 'dark_site'>>) {
    setError(null)
    const updated = { ...row, ...next }
    // Optimistic local update
    setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)))
    startTransition(async () => {
      const fd = new FormData()
      fd.set('dark_site', String(updated.dark_site))
      for (const f of FREQUENCY_DEFS) fd.set(f.key, String(updated[f.key]))
      const result = await updateJobPlanItemAction(updated.plan_id, updated.id, fd)
      if (!result.success) {
        // Roll back on failure
        setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)))
        setError(result.error ?? 'Failed to save.')
      } else {
        setEditingId(null)
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-md border border-gray-200">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-eq-grey" />
          <input
            type="text"
            placeholder="Search description, plan, code, type, site…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          />
        </div>

        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
        >
          <option value="">All plans</option>
          {planOptions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>

        <select
          value={siteFilter}
          onChange={(e) => setSiteFilter(e.target.value)}
          className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
        >
          <option value="">All sites</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <select
          value={freqFilter}
          onChange={(e) => setFreqFilter(e.target.value as FrequencyKey | '')}
          className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
        >
          <option value="">Any frequency</option>
          {FREQUENCY_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>

        <select
          value={requiredFilter}
          onChange={(e) => setRequiredFilter(e.target.value as '' | 'yes' | 'no')}
          className="h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
        >
          <option value="">Required (any)</option>
          <option value="yes">Required only</option>
          <option value="no">Optional only</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-eq-grey">{filtered.length} of {rows.length}</span>
          {canWrite && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
          )}
          <CsvExportButton
            filename="job-plan-items.csv"
            rows={csvRows}
            headers={[
              { key: 'item_id',     label: 'Item ID' },
              { key: 'plan_id',     label: 'Plan ID' },
              { key: 'job_code',    label: 'Job Code' },
              { key: 'plan',        label: 'Plan' },
              { key: 'type',        label: 'Type' },
              { key: 'site',        label: 'Site' },
              { key: 'task_no',     label: '#' },
              { key: 'description', label: 'Description' },
              { key: 'required',    label: 'Required' },
              { key: 'dark_site',   label: 'Dark Site' },
              { key: 'monthly',     label: 'M' },
              { key: 'quarterly',   label: 'Q' },
              { key: 'semi_annual', label: '6M' },
              { key: 'annual',      label: 'A' },
              { key: 'yr2',         label: '2Y' },
              { key: 'yr3',         label: '3Y' },
              { key: 'yr5',         label: '5Y' },
              { key: 'yr8',         label: '8Y' },
              { key: 'yr10',        label: '10Y' },
            ]}
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 px-1">{error}</p>}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-bold text-eq-grey uppercase cursor-pointer w-32" onClick={() => toggleSort('plan_code')}>
                  Code{sortIcon('plan_code')}
                </th>
                <th className="px-3 py-2 text-left text-xs font-bold text-eq-grey uppercase cursor-pointer" onClick={() => toggleSort('plan_name')}>
                  Plan{sortIcon('plan_name')}
                </th>
                <th className="px-3 py-2 text-left text-xs font-bold text-eq-grey uppercase cursor-pointer w-48" onClick={() => toggleSort('site_name')}>
                  Site{sortIcon('site_name')}
                </th>
                <th className="px-3 py-2 text-left text-xs font-bold text-eq-grey uppercase cursor-pointer w-12" onClick={() => toggleSort('sort_order')}>
                  #{sortIcon('sort_order')}
                </th>
                <th className="px-3 py-2 text-left text-xs font-bold text-eq-grey uppercase cursor-pointer" onClick={() => toggleSort('description')}>
                  Task{sortIcon('description')}
                </th>
                <th className="px-3 py-2 text-left text-xs font-bold text-eq-grey uppercase w-72">Frequency</th>
                <th className="px-3 py-2 text-left text-xs font-bold text-eq-grey uppercase cursor-pointer w-20" onClick={() => toggleSort('is_required')}>
                  Req{sortIcon('is_required')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-12 text-center text-sm text-eq-grey">No items match the current filters.</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 align-top">
                  <td className="px-3 py-2 text-xs font-mono text-eq-deep">{r.plan_code ?? '—'}</td>
                  <td className="px-3 py-2 text-sm">
                    <Link href={`/job-plans?edit=${r.plan_id}`} className="text-eq-deep hover:text-eq-sky font-medium">
                      {r.plan_name}
                    </Link>
                    {r.plan_type && <div className="text-xs text-eq-grey">{r.plan_type}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-eq-ink">
                    {r.site_name ?? <span className="text-eq-grey italic">global</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-eq-grey font-mono">{r.sort_order}</td>
                  <td className="px-3 py-2 text-sm text-eq-ink">{r.description}</td>
                  <td className="px-3 py-2">
                    {editingId === r.id ? (
                      <FrequencyEditor
                        item={r}
                        pending={pending}
                        onCancel={() => setEditingId(null)}
                        onSave={(next) => handleSaveFrequencies(r, next)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => canWrite && setEditingId(r.id)}
                        className={canWrite ? 'text-left hover:bg-eq-ice/40 rounded px-1 py-0.5 -mx-1 -my-0.5 transition-colors' : 'text-left'}
                        title={canWrite ? 'Click to edit frequencies' : undefined}
                      >
                        <FrequencyBadges item={r} />
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.is_required
                      ? <span className="font-medium text-eq-sky">Yes</span>
                      : <span className="text-eq-grey">No</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canWrite && (
        <ImportCSVModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          config={importConfig}
        />
      )}
    </div>
  )
}

/* ----- Inline frequency editor ----------------------------------------- */

interface EditorProps {
  item: Pick<JobPlanItem, FrequencyKey | 'dark_site'>
  pending: boolean
  onSave: (next: Partial<Pick<JobPlanItem, FrequencyKey | 'dark_site'>>) => void
  onCancel: () => void
}

function FrequencyEditor({ item, pending, onSave, onCancel }: EditorProps) {
  const [draft, setDraft] = useState<Pick<JobPlanItem, FrequencyKey | 'dark_site'>>({
    dark_site: item.dark_site,
    freq_monthly: item.freq_monthly,
    freq_quarterly: item.freq_quarterly,
    freq_semi_annual: item.freq_semi_annual,
    freq_annual: item.freq_annual,
    freq_2yr: item.freq_2yr,
    freq_3yr: item.freq_3yr,
    freq_5yr: item.freq_5yr,
    freq_8yr: item.freq_8yr,
    freq_10yr: item.freq_10yr,
  })

  function toggle(key: FrequencyKey | 'dark_site') {
    setDraft((d) => ({ ...d, [key]: !d[key] }))
  }

  return (
    <div className="space-y-1.5 bg-eq-ice/40 p-2 rounded">
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        <label className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border border-gray-200 rounded cursor-pointer hover:border-eq-sky">
          <input type="checkbox" checked={draft.dark_site} onChange={() => toggle('dark_site')} className="w-3 h-3" />
          <span className="font-bold">DS</span>
        </label>
        {FREQUENCY_DEFS.map((f) => (
          <label key={f.key} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border border-gray-200 rounded cursor-pointer hover:border-eq-sky">
            <input type="checkbox" checked={draft[f.key]} onChange={() => toggle(f.key)} className="w-3 h-3" />
            <span className="font-semibold">{f.short}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={pending}
          className="px-2 py-0.5 text-[10px] font-semibold bg-eq-sky text-white rounded hover:bg-eq-deep disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="px-2 py-0.5 text-[10px] text-eq-grey hover:text-eq-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
