'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { CheckCircle2, AlertTriangle, ArrowRight, Wand2 } from 'lucide-react'
import Link from 'next/link'
import {
  listDeriveCandidatesAction,
  previewDerivedScopeAction,
  commitDerivedScopesAction,
  type DeriveCandidate,
  type DerivedScopeRow,
  type DerivePreviewResult,
} from './actions'

type Phase = 'idle' | 'previewing' | 'committing' | 'done'

function fmtCurrency(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })
}

function intervalLabel(s: string) {
  switch (s) {
    case 'M': return 'Monthly'
    case 'Q': return 'Quarterly'
    case 'S': return 'Semi-annual'
    case 'A': return 'Annual'
    case '2': return '2-yearly'
    case '5': return '5-yearly'
    case 'irregular': return 'Irregular'
    case 'unknown': return 'No history'
    default: return s
  }
}

export function DerivedScopeWizard() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [pending, startTransition] = useTransition()
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const [candidates, setCandidates] = useState<DeriveCandidate[] | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [preview, setPreview] = useState<DerivePreviewResult | null>(null)
  const [editedRows, setEditedRows] = useState<DerivedScopeRow[]>([])
  const [doneSummary, setDoneSummary] = useState<{
    customerId: string; customerName: string; inserted: number; year: string; importId: string
  } | null>(null)

  // Initial: load candidate list when admin lands.
  useEffect(() => {
    let cancelled = false
    startTransition(async () => {
      const res = await listDeriveCandidatesAction()
      if (!cancelled && res.ok) setCandidates(res.candidates)
      else if (!cancelled && !res.ok) setBanner({ kind: 'err', msg: res.error })
    })
    return () => { cancelled = true }
  }, [])

  const selectedCustomer = useMemo(
    () => candidates?.find((c) => c.customer_id === customerId) ?? null,
    [candidates, customerId],
  )

  function handleCustomerChange(id: string) {
    setCustomerId(id)
    setPreview(null)
    setEditedRows([])
    setBanner(null)
    if (!id) return
    setPhase('previewing')
    const fd = new FormData()
    fd.set('customer_id', id)
    startTransition(async () => {
      const res = await previewDerivedScopeAction(fd)
      if (!res.ok) {
        setBanner({ kind: 'err', msg: res.error })
        setPhase('idle')
        return
      }
      setPreview(res)
      setEditedRows(res.rows)
    })
  }

  function updateRow(idx: number, patch: Partial<DerivedScopeRow>) {
    setEditedRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  const totals = useMemo(() => {
    let cost = 0
    let hours = 0
    let assets = 0
    for (const r of editedRows) {
      cost += r.estimated_annual_cost ?? 0
      hours += r.estimated_annual_hours ?? 0
      assets += r.asset_count ?? 0
    }
    return { cost, hours, assets, rows: editedRows.length }
  }, [editedRows])

  function handleCommit() {
    if (!preview || !selectedCustomer) return
    setBanner(null)
    setPhase('committing')
    const fd = new FormData()
    fd.set('customer_id', preview.customer.id)
    fd.set('financial_year', year)
    fd.set(
      'rows',
      JSON.stringify(
        editedRows
          .filter((r) => r.jp_id !== null && r.asset_count > 0)
          .map((r) => ({
            site_id: r.site_id,
            jp_id: r.jp_id,
            jp_code: r.jp_code,
            jp_name: r.jp_name,
            asset_count: r.asset_count,
            derived_interval: r.derived_interval,
            estimated_annual_cost: r.estimated_annual_cost,
            estimated_annual_hours: r.estimated_annual_hours,
            notes: null,
          })),
      ),
    )
    startTransition(async () => {
      const res = await commitDerivedScopesAction(fd)
      if (!res.ok) {
        setBanner({ kind: 'err', msg: res.error })
        setPhase('previewing')
        return
      }
      setDoneSummary({
        customerId: preview.customer.id,
        customerName: preview.customer.name,
        inserted: res.inserted,
        year,
        importId: res.source_import_id,
      })
      setPhase('done')
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  function reset() {
    setPhase('idle')
    setBanner(null)
    setCustomerId('')
    setPreview(null)
    setEditedRows([])
    setDoneSummary(null)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Success view ──
  if (phase === 'done' && doneSummary) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-7 h-7 text-white" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold text-green-900">Draft scope created</h2>
            <p className="text-sm text-green-800 mt-1">
              <span className="font-semibold">{doneSummary.customerName}</span> · {doneSummary.year}
            </p>
            <p className="text-xs text-green-700 mt-0.5">
              {doneSummary.inserted} draft scope row{doneSummary.inserted === 1 ? '' : 's'} written.
              They live as <span className="font-mono">period_status='draft'</span> until you review and commit them.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-green-700">
          <span>Trace ID: <span className="font-mono text-eq-ink select-all">{doneSummary.importId}</span></span>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button onClick={reset} size="sm">
            <Wand2 className="w-4 h-4 mr-1.5" /> Build another customer's scope
          </Button>
          <Link
            href="/contract-scope"
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-eq-deep text-eq-deep bg-white hover:bg-eq-ice"
          >
            Review on /contract-scope <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            href={`/customers/${doneSummary.customerId}`}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-eq-deep text-eq-deep bg-white hover:bg-eq-ice"
          >
            View customer <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {banner && (
        <div className={
          'px-4 py-2 rounded-md border text-sm ' +
          (banner.kind === 'ok'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800')
        }>
          {banner.msg}
        </div>
      )}

      {/* 1. Customer picker */}
      <Card>
        <h2 className="text-base font-semibold text-eq-ink">1. Pick a customer</h2>
        <p className="text-xs text-eq-grey mt-1">
          Candidates with assets and check history but no contract scope are
          flagged. Customers that already have scope rows can still be processed
          (e.g. to compare what we've delivered against an existing contract).
        </p>
        {!candidates ? (
          <p className="text-xs text-eq-grey mt-4">Loading customers…</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Customer</label>
              <select
                value={customerId}
                onChange={(e) => handleCustomerChange(e.target.value)}
                disabled={pending && phase === 'previewing'}
                className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
              >
                <option value="">— Pick customer —</option>
                {candidates.map((c) => {
                  const isCandidate = c.assets > 0 && c.scope_rows === 0
                  return (
                    <option key={c.customer_id} value={c.customer_id}>
                      {isCandidate ? '★ ' : '  '}
                      {c.customer_name}
                      {c.customer_code ? ` (${c.customer_code})` : ''}
                      {' · '}
                      {c.assets} assets · {c.distinct_jps} JPs · {c.checks_total} checks
                      {c.scope_rows > 0 ? ` · ${c.scope_rows} existing scopes` : ''}
                    </option>
                  )
                })}
              </select>
              <p className="text-[10px] text-eq-grey">★ = candidate (assets + history exist, no contract scope yet)</p>
            </div>
            <FormInput
              label="Financial Year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2026"
              maxLength={4}
              inputMode="numeric"
            />
          </div>
        )}
      </Card>

      {/* 2. Preview + edit */}
      {phase === 'previewing' && pending && !preview && (
        <Card>
          <p className="text-xs text-eq-grey">Inferring scope from delivered work…</p>
        </Card>
      )}

      {preview && (
        <>
          <Card>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-base font-semibold text-eq-ink">
                2. Review draft scope · {preview.customer.name}
              </h2>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-eq-grey">{totals.rows} rows</span>
                <span className="text-eq-grey">{totals.assets} assets</span>
                <span className="text-eq-grey">{totals.hours.toFixed(1)} hrs/yr</span>
                <span className="font-semibold text-eq-deep">{fmtCurrency(totals.cost)}/yr</span>
              </div>
            </div>
            <p className="text-xs text-eq-grey mb-3">
              Hourly rate: <span className="font-mono">{fmtCurrency(preview.customer.hourly_rate_normal)}</span> ·
              {' '}intervals inferred from median gap between past maintenance checks ·
              {' '}hours estimated at 0.25 hrs/asset/visit (rough — edit per row).
            </p>

            {editedRows.length === 0 ? (
              <div className="px-4 py-6 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">No assets linked to maintenance plans for this customer.</p>
                  <p className="text-xs mt-1">
                    Make sure the customer has sites with assets, and that each asset has{' '}
                    <span className="font-mono">job_plan_id</span> set. Check via /assets.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-eq-grey uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-2 py-2 font-bold">Site</th>
                      <th className="text-left px-2 py-2 font-bold">JP</th>
                      <th className="text-left px-2 py-2 font-bold">Description</th>
                      <th className="text-right px-2 py-2 font-bold">Assets</th>
                      <th className="text-left px-2 py-2 font-bold">Frequency</th>
                      <th className="text-right px-2 py-2 font-bold">Checks</th>
                      <th className="text-right px-2 py-2 font-bold">Hours/yr</th>
                      <th className="text-right px-2 py-2 font-bold">Cost/yr</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {editedRows.map((r, i) => {
                      const isUnknown = r.derived_interval === 'unknown'
                      const isIrregular = r.derived_interval === 'irregular'
                      return (
                        <tr key={`${r.site_id}-${r.jp_id}`}>
                          <td className="px-2 py-1.5 text-eq-ink font-mono">
                            {r.site_code ?? r.site_name}
                          </td>
                          <td className="px-2 py-1.5 text-eq-deep font-mono">{r.jp_code ?? '—'}</td>
                          <td className="px-2 py-1.5 text-eq-ink truncate max-w-[200px]" title={r.jp_name ?? ''}>
                            {r.jp_name ?? '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              value={r.asset_count}
                              onChange={(e) => updateRow(i, { asset_count: parseInt(e.target.value || '0', 10) })}
                              className="w-16 h-7 px-2 text-right text-xs border border-gray-200 rounded"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              value={r.derived_interval}
                              onChange={(e) => updateRow(i, { derived_interval: e.target.value })}
                              className={
                                'h-7 px-1.5 text-xs border rounded ' +
                                (isUnknown ? 'border-amber-300 bg-amber-50 text-amber-900'
                                : isIrregular ? 'border-amber-300 bg-amber-50 text-amber-900'
                                : 'border-gray-200 text-eq-ink')
                              }
                              title={
                                r.median_gap_days
                                  ? `Median gap between checks: ${r.median_gap_days} days`
                                  : 'No history — set manually'
                              }
                            >
                              <option value="M">{intervalLabel('M')}</option>
                              <option value="Q">{intervalLabel('Q')}</option>
                              <option value="S">{intervalLabel('S')}</option>
                              <option value="A">{intervalLabel('A')}</option>
                              <option value="2">{intervalLabel('2')}</option>
                              <option value="5">{intervalLabel('5')}</option>
                              <option value="irregular">{intervalLabel('irregular')}</option>
                              <option value="unknown">{intervalLabel('unknown')}</option>
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-right text-eq-grey">
                            {r.check_count}
                            {r.last_check ? <span className="block text-[10px]">last {r.last_check}</span> : null}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={r.estimated_annual_hours}
                              onChange={(e) => updateRow(i, { estimated_annual_hours: parseFloat(e.target.value || '0') })}
                              className="w-20 h-7 px-2 text-right text-xs border border-gray-200 rounded"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              step={50}
                              value={r.estimated_annual_cost}
                              onChange={(e) => updateRow(i, { estimated_annual_cost: parseFloat(e.target.value || '0') })}
                              className="w-24 h-7 px-2 text-right text-xs border border-gray-200 rounded"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* 3. Commit */}
          {editedRows.length > 0 && (
            <Card className="border-eq-sky/30">
              <h2 className="text-base font-semibold text-eq-ink">3. Save as draft</h2>
              <p className="text-xs text-eq-grey mt-1">
                Writes <span className="font-semibold">{editedRows.filter((r) => r.asset_count > 0).length}</span> contract
                scope row{editedRows.length === 1 ? '' : 's'} with{' '}
                <span className="font-mono">period_status='draft'</span> and{' '}
                <span className="font-mono">status='staged'</span>. Review on{' '}
                <code>/contract-scope</code> (filter to {year}) and promote to{' '}
                <span className="font-mono">'committed'</span> once the operator
                is happy with the numbers.
              </p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={reset} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCommit}
                  disabled={pending || editedRows.filter((r) => r.asset_count > 0).length === 0}
                >
                  {pending && phase === 'committing'
                    ? 'Saving…'
                    : `Save ${editedRows.filter((r) => r.asset_count > 0).length} draft row${
                        editedRows.filter((r) => r.asset_count > 0).length === 1 ? '' : 's'
                      }`}
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
