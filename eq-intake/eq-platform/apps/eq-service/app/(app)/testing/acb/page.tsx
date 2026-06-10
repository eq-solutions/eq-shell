'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AcbWorkflow } from './AcbWorkflow'
import { AcbSiteCollection } from './AcbSiteCollection'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { CheckCircle2, Clock, ClipboardList, Play, ChevronRight, Download, Upload, Plus } from 'lucide-react'
import type { AcbTest, AcbTestReading, Asset } from '@/lib/types'
import { createAcbTestAction, updateAcbDetailsAction, importAcbCollectionAction } from '@/app/(app)/testing/acb/actions'
import {
  exportAcbCollectionXlsx,
  parseAcbCollectionXlsx,
  buildAcbImportErrorCsv,
  type AcbImportRowResult,
  type AcbParseRowError,
} from '@/lib/utils/acb-excel'
import { createTestingCheckAction } from '@/app/(app)/testing/check-actions'
import { formatSiteLabel } from '@/lib/utils/format'

type SitePick = {
  id: string
  name: string
  code?: string | null
  customers?: { name?: string | null } | { name?: string | null }[] | null
}

const FREQUENCIES = ['Annual', 'Semi-Annual', 'Quarterly', 'Monthly'] as const
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export default function AcbTestingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlSiteId = searchParams.get('site_id') ?? ''
  const urlAssetId = searchParams.get('asset_id') ?? ''

  const [sites, setSites] = useState<SitePick[]>([])
  const [selectedSite, setSelectedSite] = useState<string>(urlSiteId)
  const [assets, setAssets] = useState<(Asset & { acb_test?: AcbTest })[]>([])
  const [readings, setReadings] = useState<Record<string, AcbTestReading[]>>({})
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [showSiteCollection, setShowSiteCollection] = useState(false)
  const [showCreateCheck, setShowCreateCheck] = useState(false)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  const [noAssets, setNoAssets] = useState(false)
  const [importing, setImporting] = useState(false)
  type ImportResultDetail = {
    updated: number
    failed: number
    parseErrors: AcbParseRowError[]
    rowResults: AcbImportRowResult[]
    siteName: string
  }
  const [importResult, setImportResult] = useState<ImportResultDetail | null>(null)
  // Create Check form state
  const [checkFrequency, setCheckFrequency] = useState<string>('Annual')
  const [checkMonth, setCheckMonth] = useState<number>(new Date().getMonth() + 1)
  const [checkYear, setCheckYear] = useState<number>(new Date().getFullYear())
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
  const [creatingCheck, setCreatingCheck] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [jobPlanId, setJobPlanId] = useState<string | null>(null)

  const supabase = createClient()

  // Load sites
  useEffect(() => {
    async function loadSites() {
      const { data } = await supabase
        .from('sites')
        .select('id, name, code, customers(name)')
        .eq('is_active', true)
        .order('name')

      setSites((data ?? []) as SitePick[])
    }
    loadSites()
  }, [])

  // Load E1.25 assets when site changes
  const loadSiteData = useCallback(async () => {
    if (!selectedSite) {
      setAssets([])
      setReadings({})
      setSelectedAsset(null)
      setNoAssets(false)
      return
    }

    setLoading(true)

    // Find the E1.25 / LVACB maintenance plan (global — site_id may be null)
    const { data: jobPlans } = await supabase
      .from('job_plans')
      .select('id, name, code')
      .eq('is_active', true)

    const e125Plan = (jobPlans ?? []).find(
      (jp) => jp.name === 'E1.25' || jp.code === 'LVACB'
    )

    if (!e125Plan) {
      setNoAssets(true)
      setAssets([])
      setReadings({})
      setJobPlanId(null)
      setLoading(false)
      return
    }

    setJobPlanId(e125Plan.id)

    // Fetch assets for this site assigned to E1.25
    const { data: assetsData } = await supabase
      .from('assets')
      .select('*')
      .eq('site_id', selectedSite)
      .eq('job_plan_id', e125Plan.id)
      .eq('is_active', true)
      .order('name')

    if (!assetsData || assetsData.length === 0) {
      setNoAssets(true)
      setAssets([])
      setReadings({})
      setLoading(false)
      return
    }

    setNoAssets(false)
    const assetIds = assetsData.map(a => a.id)
    const testsWithAssets: (Asset & { acb_test?: AcbTest })[] = []

    // Fetch tests newest-first so the per-asset Map holds the latest test per
    // breaker — previous versions picked an arbitrary row, which caused the
    // main list to stutter between historical and current tests after an
    // asset had been run more than once.
    const { data: testsData } = await supabase
      .from('acb_tests')
      .select('*')
      .in('asset_id', assetIds)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    const testMap = new Map<string, AcbTest>()
    for (const t of (testsData ?? []) as AcbTest[]) {
      // First occurrence wins thanks to desc order — keeps the latest test.
      if (!testMap.has(t.asset_id)) testMap.set(t.asset_id, t)
    }

    for (const asset of assetsData) {
      testsWithAssets.push({
        ...asset,
        acb_test: testMap.get(asset.id),
      })
    }

    // Fetch readings
    const testIds = (testsData ?? []).map(t => t.id)
    if (testIds.length > 0) {
      const { data: readingsData } = await supabase
        .from('acb_test_readings')
        .select('*')
        .in('acb_test_id', testIds)
        .order('sort_order')

      const readingsMap: Record<string, AcbTestReading[]> = {}
      for (const rdg of readingsData ?? []) {
        const key = rdg.acb_test_id as string
        if (!readingsMap[key]) readingsMap[key] = []
        readingsMap[key].push(rdg as AcbTestReading)
      }
      setReadings(readingsMap)
    } else {
      setReadings({})
    }

    setAssets(testsWithAssets)
    setLoading(false)
  }, [selectedSite, supabase])

  useEffect(() => {
    loadSiteData()
  }, [selectedSite])

  // Deep-link support: if the URL has ?asset_id=… and it matches a loaded
  // asset, auto-select it so the Open button from /testing/summary lands
  // directly inside the ACB workflow for that breaker. Only runs once per
  // URL param, hence the guard on selectedAsset.
  useEffect(() => {
    if (!urlAssetId || selectedAsset || assets.length === 0) return
    if (assets.some(a => a.id === urlAssetId)) {
      setSelectedAsset(urlAssetId)
    }
  }, [urlAssetId, assets, selectedAsset])

  // If URL has ?asset_id=… but no site_id, resolve the site from the asset
  // and populate selectedSite so loadSiteData picks up the right list.
  useEffect(() => {
    if (!urlAssetId || selectedSite) return
    (async () => {
      const { data } = await supabase
        .from('assets')
        .select('site_id')
        .eq('id', urlAssetId)
        .single()
      if (data?.site_id) setSelectedSite(data.site_id as string)
    })()
  }, [urlAssetId, selectedSite, supabase])

  // Create test and open workflow
  async function handleStartTest(asset: Asset) {
    setCreating(asset.id)
    const fd = new FormData()
    fd.set('asset_id', asset.id)
    fd.set('site_id', selectedSite)
    fd.set('test_date', new Date().toISOString().slice(0, 10))
    fd.set('test_type', 'Routine')

    const result = await createAcbTestAction(fd)
    setCreating(null)
    if (result.success) {
      await loadSiteData()
      setSelectedAsset(asset.id)
    }
  }

  // Excel export
  function handleExport() {
    const siteName = sites.find(s => s.id === selectedSite)?.name ?? 'Site'
    exportAcbCollectionXlsx(siteName, assets)
  }

  // Excel import — parse client-side, push the whole batch to the server
  // action which validates, runs as a single audited mutation, and returns
  // per-row results so the UI can show exactly which rows failed and why.
  async function handleImport(file: File) {
    setImporting(true)
    setImportResult(null)
    const siteName = sites.find((s) => s.id === selectedSite)?.name ?? 'Site'
    try {
      // Defence-in-depth file-size guard — the server can't introspect the
      // raw file size cheaply once it has the parsed rows, so we catch the
      // pathological case (50MB+ xlsx) at the browser before parsing.
      if (file.size > 10 * 1024 * 1024) {
        setImportResult({
          updated: 0,
          failed: 0,
          parseErrors: [{ rowNumber: 0, reason: 'File is over 10MB — split the workbook into smaller files.' }],
          rowResults: [],
          siteName,
        })
        return
      }

      const { rows: parsedRows, errors: parseErrors } = await parseAcbCollectionXlsx(file)

      // Assemble the payload with row numbers + asset names from the parse
      // so the server can echo them back in its row results.
      const assetIndex = new Map(assets.map((a) => [a.id, a.name]))
      const payloadRows = parsedRows.map((r, idx) => ({
        ...r,
        // Excel rows are 1-based with row 1 = header; parser returned them
        // in workbook order, but doesn't currently expose the row number.
        // We approximate: header (1) + index + 1. Parse errors carry the
        // true row number from the parser.
        rowNumber: idx + 2,
        assetName: assetIndex.get(r.asset_id) ?? null,
      }))

      const result = await importAcbCollectionAction({
        rows: payloadRows,
        mutationId: typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : null,
      })

      if (!result.success) {
        setImportResult({
          updated: 0,
          failed: parsedRows.length,
          parseErrors,
          rowResults: payloadRows.map((r) => ({
            test_id: r.test_id,
            rowNumber: r.rowNumber,
            assetName: r.assetName ?? undefined,
            ok: false,
            reason: result.error,
          })),
          siteName,
        })
      } else {
        const data = result.data ?? { updated: 0, failed: 0, rowResults: [] }
        setImportResult({
          updated: data.updated,
          failed: data.failed + parseErrors.length,
          parseErrors,
          rowResults: data.rowResults,
          siteName,
        })
      }
      await loadSiteData()
    } catch (e) {
      setImportResult({
        updated: 0,
        failed: 1,
        parseErrors: [{ rowNumber: 0, reason: e instanceof Error ? e.message : 'Unexpected error reading the file.' }],
        rowResults: [],
        siteName,
      })
    }
    setImporting(false)
  }

  function downloadAcbImportErrorReport() {
    if (!importResult) return
    const csv = buildAcbImportErrorCsv(importResult.parseErrors, importResult.rowResults)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${importResult.siteName.replace(/[^a-zA-Z0-9_-]/g, '_')}_ACB_Import_Errors.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Create Check handler — on success, route straight to the Testing Summary
  // with the new check auto-expanded. Previously we silently closed the form
  // and reloaded the asset list, which looked to Simon like "nothing happened".
  async function handleCreateCheck() {
    setCreatingCheck(true)
    setCheckError(null)
    try {
      const result = await createTestingCheckAction({
        site_id: selectedSite,
        job_plan_id: jobPlanId,
        check_type: 'acb',
        frequency: checkFrequency,
        month: checkMonth,
        year: checkYear,
        asset_ids: Array.from(selectedAssetIds),
      })
      if (result.success && result.data?.checkId) {
        setShowCreateCheck(false)
        setSelectedAssetIds(new Set())
        router.push(`/testing/summary?created=${result.data.checkId}`)
        return
      }
      setCheckError(result.success ? 'Failed to create check.' : result.error)
    } catch {
      setCheckError('An unexpected error occurred.')
    }
    setCreatingCheck(false)
  }

  // Toggle asset selection for check
  function toggleAssetSelection(assetId: string) {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  // An asset is "available" for a new check when it has no active test or
  // its latest test is fully complete — completed tests are historical and
  // shouldn't block re-running the breaker in a fresh maintenance event.
  // Only an actively in-progress test blocks selection to avoid duplicate WIP.
  function isTestComplete(t: AcbTest | undefined): boolean {
    if (!t) return false
    return (
      t.step1_status === 'complete' &&
      t.step2_status === 'complete' &&
      t.step3_status === 'complete'
    )
  }

  function isAssetAvailable(a: Asset & { acb_test?: AcbTest }): boolean {
    return !a.acb_test || isTestComplete(a.acb_test)
  }

  function selectAllAssets() {
    // Select every available asset — no active test or last test is complete.
    const available = assets.filter(isAssetAvailable).map(a => a.id)
    setSelectedAssetIds(new Set(available))
  }

  function deselectAllAssets() {
    setSelectedAssetIds(new Set())
  }

  const selectedAssetData = selectedAsset ? assets.find(a => a.id === selectedAsset) : null
  const selectedTest = selectedAssetData?.acb_test

  // Progress helpers
  const getStepStatus = (test: AcbTest | undefined, step: 'step1' | 'step2' | 'step3') => {
    if (!test) return 'not-started'
    const status = test[`${step}_status` as keyof AcbTest] as string
    return status === 'complete' ? 'complete' : status === 'in_progress' ? 'in-progress' : 'not-started'
  }

  const getOverallProgress = (test: AcbTest | undefined) => {
    if (!test) return 0
    let done = 0
    if (test.step1_status === 'complete') done++
    if (test.step2_status === 'complete') done++
    if (test.step3_status === 'complete') done++
    return Math.round((done / 3) * 100)
  }

  const statusBadge = (label: string, status: string) => {
    const colors =
      status === 'complete'
        ? 'bg-green-100 text-green-700'
        : status === 'in-progress'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-gray-100 text-gray-500'
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colors}`}>
        {status === 'complete' ? (
          <CheckCircle2 className="w-3 h-3" />
        ) : status === 'in-progress' ? (
          <Clock className="w-3 h-3" />
        ) : (
          <div className="w-2 h-2 border border-current rounded-full" />
        )}
        {label}
      </span>
    )
  }

  // ── Site Collection view ──
  if (showSiteCollection && selectedSite) {
    return (
      <div className="space-y-6">
        <div>
          <Breadcrumb
            items={[
              { label: 'Home', href: '/dashboard' },
              { label: 'ACB Testing', href: '#' },
              { label: 'Asset Collection' },
            ]}
          />
          <h2 className="text-3xl font-bold text-eq-sky mt-2">ACB Asset Collection</h2>
          <p className="text-eq-grey text-sm mt-1">Site-level breaker identification and settings</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setShowSiteCollection(false)}>
          Back to Asset List
        </Button>
        <AcbSiteCollection
          assets={assets}
          onUpdate={loadSiteData}
        />
      </div>
    )
  }

  // ── Workflow view (per-asset) ──
  if (selectedAsset && selectedTest) {
    return (
      <div className="space-y-6">
        <div>
          <Breadcrumb
            items={[
              { label: 'Home', href: '/dashboard' },
              { label: 'ACB Testing', href: '#' },
              { label: selectedAssetData?.name ?? 'Asset' },
            ]}
          />
          <h2 className="text-3xl font-bold text-eq-sky mt-2">{selectedAssetData?.name}</h2>
          <p className="text-eq-grey text-sm mt-1">3-step testing workflow</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            // Clear local selection AND strip asset_id from the URL. Without
            // the URL clear the deep-link useEffect re-selects the asset the
            // moment selectedAsset flips to null, so Back does nothing.
            setSelectedAsset(null)
            const qs = selectedSite ? `?site_id=${selectedSite}` : ''
            router.replace(`/testing/acb${qs}`)
          }}
        >
          Back to Asset List
        </Button>
        <AcbWorkflow
          test={selectedTest}
          readings={readings[selectedTest.id] ?? []}
          onUpdate={loadSiteData}
        />
      </div>
    )
  }

  // ── Create Check view ──
  if (showCreateCheck && selectedSite) {
    const availableAssets = assets.filter(isAssetAvailable)
    const inProgressAssets = assets.filter(a => !isAssetAvailable(a))
    const siteName = sites.find(s => s.id === selectedSite)?.name ?? 'Site'

    return (
      <div className="space-y-6">
        <div>
          <Breadcrumb
            items={[
              { label: 'Home', href: '/dashboard' },
              { label: 'ACB Testing', href: '#' },
              { label: 'Create Check' },
            ]}
          />
          <h2 className="text-3xl font-bold text-eq-sky mt-2">Create ACB Check</h2>
          <p className="text-eq-grey text-sm mt-1">Group assets under a named maintenance check for {siteName}</p>
        </div>

        {/* Sticky action bar — Royce 2026-04-28: long asset lists meant the
            Create button at the bottom forced scrolling all the way down to
            confirm. This bar stays visible while you scroll through assets. */}
        <div className="sticky top-0 z-10 -mx-4 lg:-mx-8 px-4 lg:px-8 py-2.5 bg-white/95 backdrop-blur-sm border-b border-gray-200 flex items-center justify-between gap-3">
          <Button
            onClick={handleCreateCheck}
            disabled={creatingCheck || selectedAssetIds.size === 0}
          >
            {creatingCheck ? 'Creating...' : `Create Check (${selectedAssetIds.size} assets)`}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowCreateCheck(false)}>
            Back to Asset List
          </Button>
        </div>

        {/* Check Details */}
        <Card>
          <h3 className="text-sm font-bold text-eq-ink mb-4">Check Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-eq-grey uppercase mb-1">Frequency</label>
              <select
                value={checkFrequency}
                onChange={(e) => setCheckFrequency(e.target.value)}
                className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
              >
                {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-eq-grey uppercase mb-1">Month</label>
              <select
                value={checkMonth}
                onChange={(e) => setCheckMonth(Number(e.target.value))}
                className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
              >
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-eq-grey uppercase mb-1">Year</label>
              <select
                value={checkYear}
                onChange={(e) => setCheckYear(Number(e.target.value))}
                className="w-full h-10 px-3 border border-gray-200 rounded-md text-sm bg-white"
              >
                {[2024, 2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 p-3 bg-eq-ice rounded-md">
            <p className="text-xs text-eq-grey">Check name preview:</p>
            <p className="text-sm font-semibold text-eq-ink">
              {siteName} {checkFrequency} {jobPlanId ? 'E1.25' : ''} {MONTHS[checkMonth - 1]} {checkYear}
            </p>
          </div>
        </Card>

        {/* Asset Selection */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-eq-ink">Select Assets</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={selectAllAssets}>
                Select All Available
              </Button>
              <Button size="sm" variant="secondary" onClick={deselectAllAssets}>
                Deselect All
              </Button>
            </div>
          </div>
          {availableAssets.length === 0 && inProgressAssets.length > 0 && (
            <p className="text-sm text-eq-grey mb-3">All assets at this site have an in-progress test. Finish or archive them before starting a new check.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-2 px-3 w-10">
                    <input
                      type="checkbox"
                      checked={availableAssets.length > 0 && availableAssets.every(a => selectedAssetIds.has(a.id))}
                      onChange={(e) => e.target.checked ? selectAllAssets() : deselectAllAssets()}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-eq-grey uppercase">Asset</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-eq-grey uppercase">Serial</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-eq-grey uppercase">Type</th>
                  <th className="text-left py-2 px-3 text-xs font-bold text-eq-grey uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {availableAssets.map(asset => {
                  const hasComplete = isTestComplete(asset.acb_test)
                  return (
                    <tr
                      key={asset.id}
                      className={`border-b border-gray-100 cursor-pointer transition-colors ${selectedAssetIds.has(asset.id) ? 'bg-eq-ice' : 'hover:bg-gray-50'}`}
                      onClick={() => toggleAssetSelection(asset.id)}
                    >
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={selectedAssetIds.has(asset.id)}
                          onChange={() => toggleAssetSelection(asset.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="py-2 px-3 font-medium text-eq-ink">{asset.name}</td>
                      <td className="py-2 px-3 text-eq-grey text-xs">{asset.serial_number || '-'}</td>
                      <td className="py-2 px-3 text-eq-grey text-xs">{asset.asset_type}</td>
                      <td className="py-2 px-3">
                        {hasComplete ? (
                          <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-50 text-green-700">Previous: Complete</span>
                        ) : (
                          <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">Available</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {inProgressAssets.map(asset => (
                  <tr key={asset.id} className="border-b border-gray-100 opacity-50">
                    <td className="py-2 px-3">
                      <input type="checkbox" disabled className="rounded border-gray-300" />
                    </td>
                    <td className="py-2 px-3 font-medium text-eq-grey">{asset.name}</td>
                    <td className="py-2 px-3 text-eq-grey text-xs">{asset.serial_number || '-'}</td>
                    <td className="py-2 px-3 text-eq-grey text-xs">{asset.asset_type}</td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-amber-50 text-amber-600">In Progress</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Create Button */}
        {checkError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{checkError}</div>
        )}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleCreateCheck}
            disabled={creatingCheck || selectedAssetIds.size === 0}
          >
            {creatingCheck ? 'Creating...' : `Create Check (${selectedAssetIds.size} assets)`}
          </Button>
          <Button variant="secondary" onClick={() => setShowCreateCheck(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  // ── Main asset list view ──
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'ACB Testing' }]} />
        <h2 className="text-3xl font-bold text-eq-sky mt-2">ACB Testing Workflow</h2>
        <p className="text-eq-grey text-sm mt-1">Site-based circuit breaker testing — E1.25 (LVACB) assets</p>
      </div>

      {/* Site Selector */}
      <Card className="p-4">
        <label className="block text-xs font-bold text-eq-grey uppercase mb-2">Select Site</label>
        <div className="flex gap-2">
          <select
            value={selectedSite}
            onChange={(e) => {
              setSelectedSite(e.target.value)
              setSelectedAsset(null)
              setShowSiteCollection(false)
            }}
            className="flex-1 h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Choose a site...</option>
            {sites.map(s => (
              <option key={s.id} value={s.id}>{formatSiteLabel(s)}</option>
            ))}
          </select>
          {selectedSite && assets.length > 0 && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => document.getElementById('acb-import-file')?.click()}
                disabled={importing}
              >
                <Upload className="w-4 h-4 mr-1" />
                {importing ? 'Importing...' : 'Import'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleExport}
              >
                <Download className="w-4 h-4 mr-1" />
                Export
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowSiteCollection(true)}
              >
                <ClipboardList className="w-4 h-4 mr-1" />
                Breaker Details
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setShowCreateCheck(true)
                  setSelectedAssetIds(new Set())
                  setCheckError(null)
                }}
              >
                <Plus className="w-4 h-4 mr-1" />
                Create Check
              </Button>
              <input
                id="acb-import-file"
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                disabled={importing}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleImport(file)
                  e.target.value = ''
                }}
              />
            </>
          )}
        </div>
        {importResult && (
          <div className={`mt-2 p-3 rounded-md text-sm space-y-2 ${
            importResult.failed > 0
              ? 'bg-amber-50 border border-amber-200 text-amber-800'
              : 'bg-green-50 border border-green-200 text-green-700'
          }`}>
            <div className="font-semibold">
              Import complete: {importResult.updated} updated
              {importResult.failed > 0 ? `, ${importResult.failed} failed` : ''}
            </div>
            {importResult.failed > 0 && (
              <>
                <ul className="list-disc list-inside text-xs space-y-0.5 max-h-32 overflow-y-auto">
                  {importResult.parseErrors.slice(0, 5).map((e, i) => (
                    <li key={`pe-${i}`}>
                      Row {e.rowNumber}
                      {e.assetName ? ` (${e.assetName})` : ''}: {e.reason}
                    </li>
                  ))}
                  {importResult.rowResults
                    .filter((r) => !r.ok)
                    .slice(0, Math.max(0, 5 - importResult.parseErrors.length))
                    .map((r) => (
                      <li key={`rr-${r.test_id}-${r.rowNumber}`}>
                        Row {r.rowNumber}
                        {r.assetName ? ` (${r.assetName})` : ''}: {r.reason ?? 'Update failed'}
                      </li>
                    ))}
                </ul>
                {importResult.failed > 5 && (
                  <p className="text-xs italic">…and {importResult.failed - 5} more. Download the report for the full list.</p>
                )}
                <button
                  type="button"
                  className="text-xs font-semibold underline hover:no-underline"
                  onClick={downloadAcbImportErrorReport}
                >
                  Download error report (CSV)
                </button>
              </>
            )}
          </div>
        )}
      </Card>

      {/* No E1.25 assets message */}
      {selectedSite && !loading && noAssets && (
        <Card className="p-8 text-center">
          <p className="text-eq-grey">No E1.25 (LVACB) assets found for this site.</p>
          <p className="text-xs text-eq-grey mt-1">
            Ensure assets are assigned to the E1.25 maintenance plan.
          </p>
        </Card>
      )}

      {/* Asset Table */}
      {selectedSite && !noAssets && (
        <div className="space-y-2">
          {loading ? (
            <Card className="p-8 text-center text-eq-grey">Loading...</Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left py-3 px-4 font-medium text-eq-grey">Asset</th>
                      <th className="text-left py-3 px-4 font-medium text-eq-grey">Type</th>
                      <th className="text-center py-3 px-4 font-medium text-eq-grey">Asset Collection</th>
                      <th className="text-center py-3 px-4 font-medium text-eq-grey">Visual &amp; Functional</th>
                      <th className="text-center py-3 px-4 font-medium text-eq-grey">Electrical</th>
                      <th className="text-center py-3 px-4 font-medium text-eq-grey">Progress</th>
                      <th className="text-right py-3 px-4 font-medium text-eq-grey">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map(asset => {
                      const test = asset.acb_test
                      const progress = getOverallProgress(test)
                      return (
                        <tr
                          key={asset.id}
                          className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div>
                              <p className="font-medium text-eq-ink">{asset.name}</p>
                              {asset.serial_number && (
                                <p className="text-xs text-eq-grey">{asset.serial_number}</p>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-eq-grey text-xs">{asset.asset_type}</td>
                          <td className="py-3 px-4 text-center">
                            {statusBadge('Collection', getStepStatus(test, 'step1'))}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {statusBadge('V&F', getStepStatus(test, 'step2'))}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {statusBadge('Electrical', getStepStatus(test, 'step3'))}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    progress === 100
                                      ? 'bg-green-500'
                                      : progress > 0
                                      ? 'bg-eq-sky'
                                      : 'bg-gray-200'
                                  }`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                              <span className="text-xs text-eq-grey w-8 text-right">{progress}%</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            {test ? (
                              <Button
                                size="sm"
                                onClick={() => setSelectedAsset(asset.id)}
                              >
                                Continue
                                <ChevronRight className="w-3 h-3 ml-1" />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleStartTest(asset)}
                                disabled={creating === asset.id}
                              >
                                {creating === asset.id ? (
                                  'Creating...'
                                ) : (
                                  <>
                                    <Play className="w-3 h-3 mr-1" />
                                    Start Test
                                  </>
                                )}
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
