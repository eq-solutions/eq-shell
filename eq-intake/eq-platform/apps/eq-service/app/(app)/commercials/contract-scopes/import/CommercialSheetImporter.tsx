'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, X, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import {
  previewCommercialSheetAction,
  previewExistingCountsAction,
  previewAssetCountsAction,
  commitImportAction,
  type CustomerOption,
  type SiteOption,
  type PreviewResult,
  type ExistingCounts,
  type CommitResult,
} from './actions'
import { checkImportFileSize } from '@/lib/utils/file-size-guard'
import { downloadImportErrorCsv } from '@/lib/utils/import-error-csv'

interface PreviewScope {
  jp_code: string | null
  scope_item: string
  asset_qty: number
  intervals_text: string
  cycle_costs: Record<string, number>
  year_totals: Record<string, number>
  due_years: Record<string, number>
  unit_rate_per_asset: number | null
  source_sheet: string
}

type Phase = 'idle' | 'parsing' | 'previewing' | 'committing' | 'done'

function fmtCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 })
}

function parseCurrencyInput(s: string): number | null {
  if (!s.trim()) return null
  const n = parseFloat(s.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function CommercialSheetImporter() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [counts, setCounts] = useState<ExistingCounts | null>(null)
  const [hasPriorImport, setHasPriorImport] = useState<boolean>(false)
  const [assetCountsByJp, setAssetCountsByJp] = useState<Record<string, number>>({})
  const [customerId, setCustomerId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [year, setYear] = useState('2026')
  const [wipeFirst, setWipeFirst] = useState(true)
  const [confirmName, setConfirmName] = useState('')
  const [expectedY1, setExpectedY1] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [dragOver, setDragOver] = useState(false)
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null)
  // Snapshot of which customer/site/year was committed — frozen on done so
  // the success card stays accurate even after we reset other state.
  const [doneContext, setDoneContext] = useState<{
    customerId: string
    customerName: string
    siteCode: string | null
    siteName: string
    year: string
    filename: string
  } | null>(null)

  const sitesForCustomer: SiteOption[] = useMemo(() => {
    if (!preview || !customerId) return []
    return preview.sites.filter((s) => s.customer_id === customerId)
  }, [preview, customerId])

  const selectedCustomer: CustomerOption | undefined = useMemo(
    () => preview?.customers.find((c) => c.id === customerId),
    [preview, customerId],
  )
  const selectedSite: SiteOption | undefined = useMemo(
    () => preview?.sites.find((s) => s.id === siteId),
    [preview, siteId],
  )

  const allScopes: PreviewScope[] = useMemo(() => {
    if (!preview) return []
    return [...preview.parsed.scopes, ...preview.parsed.additional_items]
  }, [preview])

  const yearTotal = useMemo(() => {
    if (!preview) return 0
    return preview.parsedYearTotals[year] ?? 0
  }, [preview, year])

  // ── Live validation surfaced in the wizard (mirrors server-side checks) ──
  const liveWarnings = useMemo(() => {
    const w: string[] = []
    if (!preview) return w
    if (preview.parsed.site_hint && selectedCustomer?.contract_template &&
        selectedCustomer.contract_template !== 'au_smca_v1') {
      w.push(
        `Customer template is '${selectedCustomer.contract_template}' but the filename ` +
        `(DELTA ELCOM_${preview.parsed.site_hint}) looks like an AU SMCA workbook.`,
      )
    }
    if (preview.parsed.site_hint && selectedSite?.code &&
        selectedSite.code.toUpperCase() !== preview.parsed.site_hint) {
      w.push(
        `Filename hint says '${preview.parsed.site_hint}' but you've picked site '${selectedSite.code}'.`,
      )
    }
    if (preview.workbookYears.length > 0 && /^\d{4}$/.test(year) &&
        !preview.workbookYears.includes(year)) {
      w.push(
        `Picked year ${year} doesn't appear in the workbook (covers ${preview.workbookYears.join(', ')}).`,
      )
    }
    if (!wipeFirst && hasPriorImport) {
      w.push(
        'This customer/year already has rows from a prior import. Wipe is OFF — committing would create duplicates.',
      )
    }
    return w
  }, [preview, selectedCustomer, selectedSite, year, wipeFirst, hasPriorImport])

  // Y1 tie-out diff (null if user didn't supply expected).
  const expectedY1Num = parseCurrencyInput(expectedY1)
  const tieOutDiff =
    expectedY1Num !== null && /^\d{4}$/.test(year)
      ? +(yearTotal - expectedY1Num).toFixed(2)
      : null
  const tieOutBlocked = tieOutDiff !== null && Math.abs(tieOutDiff) > 1

  const confirmMatch =
    !!selectedCustomer && confirmName.trim() === (selectedCustomer.name ?? '').trim()
  const canCommit =
    !!file &&
    !!customerId &&
    !!siteId &&
    /^\d{4}$/.test(year) &&
    confirmMatch &&
    !tieOutBlocked &&
    !pending &&
    // Hard-blocking warnings
    !(preview && preview.workbookYears.length > 0 && !preview.workbookYears.includes(year)) &&
    !(!wipeFirst && hasPriorImport)

  function resetAll() {
    setPhase('idle')
    setFile(null)
    setPreview(null)
    setCounts(null)
    setHasPriorImport(false)
    setAssetCountsByJp({})
    setCustomerId('')
    setSiteId('')
    setYear('2026')
    setWipeFirst(true)
    setConfirmName('')
    setExpectedY1('')
    setBanner(null)
    setDragOver(false)
    setCommitResult(null)
    setDoneContext(null)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleFile(f: File) {
    const sizeError = checkImportFileSize(f)
    if (sizeError) {
      setBanner({ kind: 'err', msg: sizeError })
      return
    }
    setFile(f)
    setPreview(null)
    setCustomerId('')
    setSiteId('')
    setConfirmName('')
    setExpectedY1('')
    setCounts(null)
    setHasPriorImport(false)
    setAssetCountsByJp({})
    setBanner(null)
    setPhase('parsing')
    const fd = new FormData()
    fd.set('file', f)
    startTransition(async () => {
      const res = await previewCommercialSheetAction(fd)
      if (!res.ok) {
        setBanner({ kind: 'err', msg: res.error })
        setPhase('idle')
        return
      }
      setPreview(res)
      setPhase('previewing')
      if (res.matchedSiteId) {
        const matchedSite = res.sites.find((s) => s.id === res.matchedSiteId)
        if (matchedSite) {
          setCustomerId(matchedSite.customer_id)
          setSiteId(matchedSite.id)
        }
      }
    })
  }

  // Refresh the existing-data counts. Site-scoped when site is picked
  // (matches the 0083 hotfix wipe scope), customer-wide otherwise.
  function refreshCounts(custId: string, yr: string, sId: string) {
    if (!custId || !/^\d{4}$/.test(yr)) {
      setCounts(null)
      setHasPriorImport(false)
      return
    }
    const fd = new FormData()
    fd.set('customer_id', custId)
    fd.set('financial_year', yr)
    if (sId) fd.set('site_id', sId)
    startTransition(async () => {
      const res = await previewExistingCountsAction(fd)
      if (res.ok) {
        setCounts(res.counts)
        setHasPriorImport(res.hasPriorImport)
      } else {
        setCounts(null)
        setHasPriorImport(false)
      }
    })
  }

  // Refresh per-JP DB asset counts whenever the site changes (or preview lands).
  useEffect(() => {
    if (!preview || !siteId) {
      setAssetCountsByJp({})
      return
    }
    const codes = preview.parsed.scopes
      .map((s) => s.jp_code)
      .filter((c): c is string => !!c)
    if (codes.length === 0) {
      setAssetCountsByJp({})
      return
    }
    const fd = new FormData()
    fd.set('site_id', siteId)
    fd.set('jp_codes', codes.join(','))
    startTransition(async () => {
      const res = await previewAssetCountsAction(fd)
      if (res.ok) setAssetCountsByJp(res.countsByJp)
    })
  }, [preview, siteId])

  function handleCustomerChange(id: string) {
    setCustomerId(id)
    setSiteId('')
    setConfirmName('')
    refreshCounts(id, year, '')
  }
  function handleYearChange(y: string) {
    setYear(y)
    refreshCounts(customerId, y, siteId)
  }
  function handleSiteChange(id: string) {
    setSiteId(id)
    refreshCounts(customerId, year, id)
  }

  function handleCommit() {
    if (!file || !customerId || !siteId || !selectedCustomer || !selectedSite) return
    setBanner(null)
    setPhase('committing')
    const fd = new FormData()
    fd.set('file', file)
    fd.set('customer_id', customerId)
    fd.set('site_id', siteId)
    fd.set('financial_year', year)
    fd.set('confirm_name', confirmName)
    fd.set('wipe_first', wipeFirst ? 'true' : 'false')
    if (expectedY1Num !== null) fd.set('expected_y1_total', String(expectedY1Num))
    // Freeze context now so the success card has stable values even after reset.
    const context = {
      customerId,
      customerName: selectedCustomer.name,
      siteCode: selectedSite.code,
      siteName: selectedSite.name,
      year,
      filename: file.name,
    }
    startTransition(async () => {
      const res = await commitImportAction(fd)
      if (!res.ok) {
        setBanner({ kind: 'err', msg: res.error })
        setPhase('previewing')
        return
      }
      setCommitResult(res)
      setDoneContext(context)
      setPhase('done')
      // Scroll to top so the success card is visible — the wizard tends to
      // leave the user scrolled near the bottom (commit button) and the
      // banner alone wasn't enough signal that the import landed.
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  // ── Drag-drop handlers ──────────────────────────────────────────────
  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }
  function onDragLeave() { setDragOver(false) }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f && f.name.toLowerCase().endsWith('.xlsx')) handleFile(f)
    else setBanner({ kind: 'err', msg: 'Drop a single .xlsx workbook.' })
  }

  // ── Success state — replaces the wizard. Big, unmissable card. ──
  if (phase === 'done' && commitResult && doneContext) {
    const { customerName, siteCode, siteName, year: doneYear, filename } = doneContext
    const w = commitResult.wiped
    const wipedAny = w.scopes + w.calendar + w.gaps > 0
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-green-200 bg-green-50 p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-7 h-7 text-white" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-bold text-green-900">Import successful</h2>
              <p className="text-sm text-green-800 mt-1">
                <span className="font-semibold">{customerName}</span> · {siteCode ?? siteName} · {doneYear}
              </p>
              <p className="text-xs text-green-700 mt-0.5 truncate" title={filename}>
                from <span className="font-mono">{filename}</span>
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-md border border-green-200 px-3 py-2">
              <p className="text-xs font-bold text-green-700 uppercase tracking-wide">Inserted</p>
              <p className="text-2xl font-bold text-eq-ink">
                {commitResult.inserted.scopes + commitResult.inserted.additional_items}
              </p>
              <p className="text-xs text-eq-grey">
                {commitResult.inserted.scopes} JP + {commitResult.inserted.additional_items} additional
              </p>
            </div>
            <div className="bg-white rounded-md border border-green-200 px-3 py-2">
              <p className="text-xs font-bold text-green-700 uppercase tracking-wide">Wiped scopes</p>
              <p className="text-2xl font-bold text-eq-ink">{w.scopes}</p>
              <p className="text-xs text-eq-grey">{wipedAny ? 'replaced' : 'no prior data'}</p>
            </div>
            <div className="bg-white rounded-md border border-green-200 px-3 py-2">
              <p className="text-xs font-bold text-green-700 uppercase tracking-wide">Wiped calendar</p>
              <p className="text-2xl font-bold text-eq-ink">{w.calendar}</p>
              <p className="text-xs text-eq-grey">SY3 {doneYear} entries</p>
            </div>
            <div className="bg-white rounded-md border border-green-200 px-3 py-2">
              <p className="text-xs font-bold text-green-700 uppercase tracking-wide">Wiped gaps</p>
              <p className="text-2xl font-bold text-eq-ink">{w.gaps}</p>
              <p className="text-xs text-eq-grey">coverage gaps</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-green-700">
              Trace ID:{' '}
              <span className="font-mono text-eq-ink select-all">{commitResult.source_import_id}</span>
            </span>
            <span className="text-green-700">·</span>
            <span className="text-green-700">
              Audit-logged with full pre-wipe snapshot for recovery
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button onClick={resetAll} size="sm">
              <Upload className="w-4 h-4 mr-1.5" />
              Import another file
            </Button>
            <Link
              href={`/customers/${doneContext.customerId}`}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-eq-deep text-eq-deep bg-white hover:bg-eq-ice"
            >
              View customer <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/contract-scope"
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-eq-deep text-eq-deep bg-white hover:bg-eq-ice"
            >
              View contract scopes <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/reports"
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-eq-deep text-eq-deep bg-white hover:bg-eq-ice"
            >
              View reports <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
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

      {/* 1. Fancy drop-zone uploader */}
      <Card>
        <h2 className="text-base font-semibold text-eq-ink">1. Upload commercial-sheet workbook</h2>
        <p className="text-xs text-eq-grey mt-1">
          One xlsx per site. Filename should follow the DELTA ELCOM pattern so the
          site auto-matches.
        </p>
        <div className="mt-3">
          {!file ? (
            <label
              htmlFor="cs-file-input"
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={
                'flex flex-col items-center justify-center gap-3 ' +
                'cursor-pointer rounded-lg border-2 border-dashed py-10 px-6 ' +
                'transition-colors duration-150 text-center ' +
                (dragOver
                  ? 'border-eq-sky bg-eq-ice'
                  : 'border-gray-300 bg-gray-50 hover:border-eq-sky hover:bg-eq-ice/40')
              }
            >
              <div className={
                'w-12 h-12 rounded-full flex items-center justify-center ' +
                (dragOver ? 'bg-eq-sky text-white' : 'bg-white border border-gray-200 text-eq-deep')
              }>
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-eq-ink">
                  Drop your DELTA ELCOM xlsx here
                </p>
                <p className="text-xs text-eq-grey mt-0.5">
                  or <span className="text-eq-deep underline">click to browse</span>
                </p>
              </div>
              <p className="text-[10px] text-eq-grey">
                e.g. <span className="font-mono">DELTA ELCOM_SY3 Elec Maintenance_Commercial Sheet JPs 24Nov&#39;2025.xlsx</span>
              </p>
              <input
                id="cs-file-input"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={pending}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                }}
                className="sr-only"
              />
            </label>
          ) : (
            <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-md border border-eq-sky/30 bg-eq-ice/40">
              <div className="flex items-center gap-3 min-w-0">
                <FileSpreadsheet className="w-5 h-5 text-eq-deep flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-eq-ink truncate" title={file.name}>{file.name}</p>
                  <p className="text-xs text-eq-grey">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={resetAll} disabled={pending}>
                <X className="w-3.5 h-3.5 mr-1" /> Reset
              </Button>
            </div>
          )}
        </div>

        {phase === 'parsing' && <p className="text-xs text-eq-grey mt-3">Parsing workbook…</p>}

        {preview && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Site hint</p>
              <p className="text-eq-ink">{preview.parsed.site_hint ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Priced JPs</p>
              <p className="text-eq-ink">{preview.parsed.scopes.length}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Additional items</p>
              <p className="text-eq-ink">{preview.parsed.additional_items.length}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Workbook years</p>
              <p className="text-eq-ink">{preview.workbookYears.join(', ') || '—'}</p>
            </div>
          </div>
        )}
        {preview && preview.parsed.warnings.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">
                {preview.parsed.warnings.length} warning{preview.parsed.warnings.length === 1 ? '' : 's'} from parser
              </p>
              <button
                type="button"
                className="text-xs font-semibold text-amber-800 underline hover:no-underline"
                onClick={() => {
                  const rows = preview.parsed.warnings.map((w, i) => ({
                    rowRef: `warning ${i + 1}`,
                    context: 'commercial sheet',
                    reason: w,
                  }))
                  const base = (file?.name ?? 'commercial-sheet').replace(/\.xlsx$/i, '')
                  downloadImportErrorCsv(rows, `${base}_warnings.csv`)
                }}
              >
                Download warnings (CSV)
              </button>
            </div>
            <ul className="text-xs text-amber-700 space-y-1">
              {preview.parsed.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
            </ul>
          </div>
        )}
      </Card>

      {/* 2. Customer + site + year + wipe + Y1 tie-out */}
      {preview && (
        <Card>
          <h2 className="text-base font-semibold text-eq-ink">2. Target customer + site + year</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Customer</label>
              <select
                value={customerId}
                onChange={(e) => handleCustomerChange(e.target.value)}
                disabled={pending}
                className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
              >
                <option value="">— Pick customer —</option>
                {preview.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.code ? ` (${c.code})` : ''}{c.contract_template ? ` · ${c.contract_template}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site</label>
              <select
                value={siteId}
                onChange={(e) => handleSiteChange(e.target.value)}
                disabled={pending || !customerId}
                className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20 disabled:bg-gray-50 disabled:text-eq-grey"
              >
                <option value="">— Pick site —</option>
                {sitesForCustomer.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code ? `${s.code} — ${s.name}` : s.name}
                  </option>
                ))}
              </select>
              {preview.matchedSiteId && siteId === preview.matchedSiteId && (
                <p className="text-xs text-green-600">Auto-matched from filename hint.</p>
              )}
            </div>
            <FormInput
              label="Financial Year"
              value={year}
              onChange={(e) => handleYearChange(e.target.value)}
              disabled={pending}
              placeholder="2026"
              maxLength={4}
              inputMode="numeric"
            />
          </div>

          {/* Live warnings — soft (yellow) */}
          {liveWarnings.length > 0 && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <ul className="space-y-1">
                {liveWarnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {/* Existing-data + wipe toggle */}
          {customerId && counts && (counts.scopes + counts.calendar + counts.gaps) > 0 && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900">
              <p className="font-semibold">Existing data for this customer in {year}:</p>
              <p className="mt-1">
                {counts.scopes} contract scope row{counts.scopes === 1 ? '' : 's'}, {' '}
                {counts.calendar} calendar entr{counts.calendar === 1 ? 'y' : 'ies'}, {' '}
                {counts.gaps} coverage gap{counts.gaps === 1 ? '' : 's'}.
              </p>
              <label className="mt-3 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wipeFirst}
                  onChange={(e) => setWipeFirst(e.target.checked)}
                  disabled={pending}
                />
                <span>
                  Wipe these before inserting. <span className="text-amber-700">(Recommended for re-import.)</span>
                </span>
              </label>
            </div>
          )}

          {/* Y1 tie-out gate */}
          <div className="mt-4 p-3 rounded-md bg-eq-ice/40 border border-eq-sky/20">
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Y1 tie-out (optional but recommended)</p>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1">
                <FormInput
                  label={`Expected ${year} total from contract PDF`}
                  value={expectedY1}
                  onChange={(e) => setExpectedY1(e.target.value)}
                  placeholder="e.g. 86677.00"
                  inputMode="decimal"
                />
              </div>
              <div className="flex-1 text-sm">
                <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-1">Parsed {year} total</p>
                <p className={
                  'font-semibold ' +
                  (tieOutBlocked ? 'text-red-600' : 'text-eq-deep')
                }>
                  {fmtCurrency(yearTotal)}
                </p>
                {tieOutDiff !== null && (
                  <p className={
                    'text-xs mt-0.5 flex items-center gap-1 ' +
                    (tieOutBlocked ? 'text-red-600' : 'text-green-600')
                  }>
                    {tieOutBlocked ? (
                      <><AlertTriangle className="w-3 h-3" /> Mismatch: {fmtCurrency(tieOutDiff)} (commit blocked)</>
                    ) : (
                      <><CheckCircle2 className="w-3 h-3" /> Tied within $1.00</>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 3. Preview parsed rows */}
      {preview && allScopes.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-eq-ink">3. Preview parsed rows</h2>
            <p className="text-sm font-semibold text-eq-deep">
              {year} total: {fmtCurrency(yearTotal)}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-eq-grey uppercase tracking-wide">
                <tr>
                  <th className="text-left px-2 py-2 font-bold">JP</th>
                  <th className="text-left px-2 py-2 font-bold">Scope</th>
                  <th className="text-right px-2 py-2 font-bold">Qty</th>
                  <th className="text-right px-2 py-2 font-bold" title="Active assets at this site already linked to this maintenance-plan code">Linked assets</th>
                  <th className="text-left px-2 py-2 font-bold">Intervals</th>
                  <th className="text-left px-2 py-2 font-bold">Cycle costs</th>
                  <th className="text-right px-2 py-2 font-bold">{year}</th>
                  <th className="text-left px-2 py-2 font-bold">Due years</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allScopes.map((s, i) => {
                  const cycleStr = Object.entries(s.cycle_costs)
                    .map(([k, v]) => `${k}: ${fmtCurrency(v)}`)
                    .join(', ')
                  const dueStr = Object.entries(s.due_years)
                    .map(([y, c]) => `${y}: ${c}`)
                    .join(', ')
                  const dbCount = s.jp_code ? assetCountsByJp[s.jp_code] : undefined
                  const isMatch =
                    s.jp_code !== null &&
                    dbCount !== undefined &&
                    siteId !== '' &&
                    dbCount > 0 &&
                    dbCount === s.asset_qty
                  const isMismatch =
                    s.jp_code !== null &&
                    dbCount !== undefined &&
                    siteId !== '' &&
                    dbCount > 0 &&
                    dbCount !== s.asset_qty
                  // No-link state: dbCount is 0. Treat as "nothing to compare yet" —
                  // grey, neutral, no asterisk. The asset register either hasn't been
                  // wired to job_plans, or this is a brand new site.
                  return (
                    <tr key={i}>
                      <td className="px-2 py-1.5 text-eq-deep font-mono">{s.jp_code ?? '—'}</td>
                      <td className="px-2 py-1.5 text-eq-ink">{s.scope_item}</td>
                      <td className="px-2 py-1.5 text-right text-eq-ink">
                        {s.asset_qty || (s.unit_rate_per_asset !== null ? '—' : '0')}
                      </td>
                      <td
                        className={
                          'px-2 py-1.5 text-right ' +
                          (s.jp_code === null || dbCount === undefined
                            ? 'text-eq-grey'
                            : isMismatch
                              ? 'text-amber-700 font-semibold'
                              : isMatch
                                ? 'text-green-700 font-semibold'
                                : 'text-eq-grey')
                        }
                        title={
                          isMismatch
                            ? `Parsed asset_qty = ${s.asset_qty}, but the asset register has ${dbCount} active assets linked to this maintenance plan at this site.`
                            : isMatch
                              ? 'Matches the xlsx asset count exactly.'
                              : dbCount === 0
                                ? 'No assets at this site are linked to this maintenance plan yet — nothing to compare against.'
                                : undefined
                        }
                      >
                        {s.jp_code === null
                          ? '—'
                          : dbCount === undefined
                            ? '?'
                            : isMatch
                              ? `✓ ${dbCount}`
                              : dbCount}
                      </td>
                      <td className="px-2 py-1.5 text-eq-grey">{s.intervals_text || '—'}</td>
                      <td className="px-2 py-1.5 text-eq-grey">
                        {cycleStr || (s.unit_rate_per_asset !== null ? `unit: ${fmtCurrency(s.unit_rate_per_asset)}` : '—')}
                      </td>
                      <td className="px-2 py-1.5 text-right text-eq-ink">{fmtCurrency(s.year_totals[year] ?? 0)}</td>
                      <td className="px-2 py-1.5 text-eq-grey">{dueStr || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-eq-grey">
            <span className="text-green-700 font-semibold">✓ green</span> = matches the xlsx · {' '}
            <span className="text-eq-grey">grey 0</span> = no assets linked to this maintenance plan yet · {' '}
            <span className="text-amber-700 font-semibold">amber</span> = mismatch (asset register out of sync with the xlsx).
          </p>
        </Card>
      )}

      {/* 4. Confirm + commit */}
      {preview && customerId && siteId && (
        <Card className="border-red-200">
          <h2 className="text-base font-semibold text-eq-ink">4. Confirm + commit</h2>
          <p className="text-xs text-eq-grey mt-1">
            Type <span className="font-mono font-semibold text-eq-ink">{selectedCustomer?.name}</span>{' '}
            to enable the commit button.
          </p>
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder="Type the customer name exactly"
            disabled={pending}
            className="mt-2 w-full h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
          />
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={resetAll} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCommit}
              disabled={!canCommit}
              className="!bg-red-600 hover:!bg-red-700 !text-white disabled:!bg-gray-300"
            >
              {pending && phase === 'committing'
                ? 'Importing…'
                : wipeFirst ? `Wipe ${year} & import` : `Import ${year}`}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
