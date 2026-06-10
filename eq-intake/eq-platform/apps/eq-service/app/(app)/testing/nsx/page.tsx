'use client'

/**
 * NSX Testing Workflow Page — site-based 3-step workflow mirroring ACB.
 * Framework scaffold: loads assets by site, allows creating an NSX test per
 * asset, and opens the 3-step NsxWorkflow component.
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { CheckCircle2, Clock, Play, ChevronRight, Plus } from 'lucide-react'
import type { Asset, NsxTest, NsxTestReading } from '@/lib/types'
import { createNsxTestAction } from '@/app/(app)/testing/nsx/actions'
import { createTestingCheckAction } from '@/app/(app)/testing/check-actions'
import { NsxWorkflow } from './NsxWorkflow'
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

export default function NsxTestingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlSiteId = searchParams.get('site_id') ?? ''
  const urlAssetId = searchParams.get('asset_id') ?? ''

  const [sites, setSites] = useState<SitePick[]>([])
  const [selectedSite, setSelectedSite] = useState<string>(urlSiteId)
  const [assets, setAssets] = useState<(Asset & { nsx_test?: NsxTest })[]>([])
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null)
  const [selectedTestReadings, setSelectedTestReadings] = useState<NsxTestReading[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  const [noAssets, setNoAssets] = useState(false)
  const [jobPlanId, setJobPlanId] = useState<string | null>(null)

  // Create Check state (mirrors /testing/acb)
  const [showCreateCheck, setShowCreateCheck] = useState(false)
  const [checkFrequency, setCheckFrequency] = useState<string>('Annual')
  const [checkMonth, setCheckMonth] = useState<number>(new Date().getMonth() + 1)
  const [checkYear, setCheckYear] = useState<number>(new Date().getFullYear())
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
  const [creatingCheck, setCreatingCheck] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

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

  // Load NSX-relevant assets for site
  const loadSiteData = useCallback(async () => {
    if (!selectedSite) {
      setAssets([])
      setSelectedAsset(null)
      setNoAssets(false)
      return
    }

    setLoading(true)

    // Find NSX-style maintenance plan — match on name containing 'NSX' or code 'LVNSX'
    const { data: jobPlans } = await supabase
      .from('job_plans')
      .select('id, name, code')
      .eq('is_active', true)

    const nsxPlan = (jobPlans ?? []).find(
      (jp) =>
        (jp.name && jp.name.toUpperCase().includes('NSX')) ||
        jp.code === 'LVNSX' ||
        jp.code === 'MCCB',
    )

    // If no NSX plan exists, fall back to showing all site assets
    let assetQuery = supabase
      .from('assets')
      .select('*')
      .eq('site_id', selectedSite)
      .eq('is_active', true)
      .order('name')

    if (nsxPlan) {
      assetQuery = assetQuery.eq('job_plan_id', nsxPlan.id)
      setJobPlanId(nsxPlan.id)
    } else {
      setJobPlanId(null)
    }

    const { data: assetsData } = await assetQuery

    if (!assetsData || assetsData.length === 0) {
      setNoAssets(true)
      setAssets([])
      setLoading(false)
      return
    }

    setNoAssets(false)
    const assetIds = assetsData.map((a) => a.id)

    // Fetch tests newest-first so the per-asset Map holds the latest test —
    // assets that have been tested multiple times now show their most recent
    // run instead of an arbitrary historical row.
    const { data: testsData } = await supabase
      .from('nsx_tests')
      .select('*')
      .in('asset_id', assetIds)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    const testMap = new Map<string, NsxTest>()
    for (const t of (testsData ?? []) as NsxTest[]) {
      // First occurrence wins thanks to desc order — keeps the latest test.
      if (!testMap.has(t.asset_id)) testMap.set(t.asset_id, t)
    }

    const combined: (Asset & { nsx_test?: NsxTest })[] = assetsData.map((asset) => ({
      ...(asset as Asset),
      nsx_test: testMap.get(asset.id),
    }))

    setAssets(combined)
    setLoading(false)
  }, [selectedSite, supabase])

  // Load readings for the currently-selected test whenever selection or
  // test data changes. Mirrors the ACB workflow page.
  useEffect(() => {
    async function loadReadings() {
      if (!selectedAsset) {
        setSelectedTestReadings([])
        return
      }
      const asset = assets.find((a) => a.id === selectedAsset)
      const testId = asset?.nsx_test?.id
      if (!testId) {
        setSelectedTestReadings([])
        return
      }
      const { data } = await supabase
        .from('nsx_test_readings')
        .select('*')
        .eq('nsx_test_id', testId)
        .order('sort_order')
      setSelectedTestReadings((data ?? []) as NsxTestReading[])
    }
    loadReadings()
  }, [selectedAsset, assets, supabase])

  useEffect(() => {
    loadSiteData()
  }, [selectedSite])

  // Deep-link support: auto-select asset when URL has ?asset_id=… so the
  // Open button from /testing/summary lands directly inside the workflow.
  useEffect(() => {
    if (!urlAssetId || selectedAsset || assets.length === 0) return
    if (assets.some(a => a.id === urlAssetId)) {
      setSelectedAsset(urlAssetId)
    }
  }, [urlAssetId, assets, selectedAsset])

  // If URL has ?asset_id=… but no site_id, resolve site from the asset.
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

  async function handleStartTest(asset: Asset) {
    setCreating(asset.id)
    const fd = new FormData()
    fd.set('asset_id', asset.id)
    fd.set('site_id', selectedSite)
    fd.set('test_date', new Date().toISOString().slice(0, 10))
    fd.set('test_type', 'Routine')

    const result = await createNsxTestAction(fd)
    setCreating(null)
    if (result.success) {
      await loadSiteData()
      setSelectedAsset(asset.id)
    }
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
        check_type: 'nsx',
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

  function toggleAssetSelection(assetId: string) {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId)
      else next.add(assetId)
      return next
    })
  }

  // An asset is "available" for a new check when it has no active test or
  // its latest test is fully complete. Only in-progress tests block
  // re-selection so users can re-run annual/semi-annual cycles on breakers
  // that have been tested previously.
  function isTestComplete(t: NsxTest | undefined): boolean {
    if (!t) return false
    return (
      t.step1_status === 'complete' &&
      t.step2_status === 'complete' &&
      t.step3_status === 'complete'
    )
  }

  function isAssetAvailable(a: Asset & { nsx_test?: NsxTest }): boolean {
    return !a.nsx_test || isTestComplete(a.nsx_test)
  }

  function selectAllAssets() {
    const available = assets.filter(isAssetAvailable).map((a) => a.id)
    setSelectedAssetIds(new Set(available))
  }

  function deselectAllAssets() {
    setSelectedAssetIds(new Set())
  }

  const selectedAssetData = selectedAsset ? assets.find((a) => a.id === selectedAsset) : null
  const selectedTest = selectedAssetData?.nsx_test

  const getStepStatus = (test: NsxTest | undefined, step: 'step1' | 'step2' | 'step3') => {
    if (!test) return 'not-started'
    const status = test[`${step}_status` as keyof NsxTest] as string | undefined
    return status === 'complete' ? 'complete' : status === 'in_progress' ? 'in-progress' : 'not-started'
  }

  const getOverallProgress = (test: NsxTest | undefined) => {
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

  // Workflow view
  if (selectedAsset && selectedTest) {
    return (
      <div className="space-y-6">
        <div>
          <Breadcrumb
            items={[
              { label: 'Home', href: '/dashboard' },
              { label: 'NSX Testing', href: '#' },
              { label: selectedAssetData?.name ?? 'Asset' },
            ]}
          />
          <h2 className="text-3xl font-bold text-eq-sky mt-2">{selectedAssetData?.name}</h2>
          <p className="text-eq-grey text-sm mt-1">3-step NSX testing workflow (framework)</p>
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
            router.replace(`/testing/nsx${qs}`)
          }}
        >
          Back to Asset List
        </Button>
        <NsxWorkflow test={selectedTest} readings={selectedTestReadings} onUpdate={loadSiteData} />
      </div>
    )
  }

  // ── Create Check view ──
  if (showCreateCheck && selectedSite) {
    const availableAssets = assets.filter(isAssetAvailable)
    const inProgressAssets = assets.filter((a) => !isAssetAvailable(a))
    const siteName = sites.find((s) => s.id === selectedSite)?.name ?? 'Site'

    return (
      <div className="space-y-6">
        <div>
          <Breadcrumb
            items={[
              { label: 'Home', href: '/dashboard' },
              { label: 'NSX Testing', href: '#' },
              { label: 'Create Check' },
            ]}
          />
          <h2 className="text-3xl font-bold text-eq-sky mt-2">Create NSX Check</h2>
          <p className="text-eq-grey text-sm mt-1">Group assets under a named maintenance check for {siteName}</p>
        </div>

        {/* Sticky action bar — Royce 2026-04-28: long asset lists meant the
            Create button at the bottom forced scrolling. This bar stays
            visible while you scroll through assets. */}
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
                {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
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
                {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 p-3 bg-eq-ice rounded-md">
            <p className="text-xs text-eq-grey">Check name preview:</p>
            <p className="text-sm font-semibold text-eq-ink">
              {siteName} {checkFrequency} NSX {MONTHS[checkMonth - 1]} {checkYear}
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
                      checked={availableAssets.length > 0 && availableAssets.every((a) => selectedAssetIds.has(a.id))}
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
                {availableAssets.map((asset) => {
                  const hasComplete = isTestComplete(asset.nsx_test)
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
                {inProgressAssets.map((asset) => (
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-eq-ink">NSX Testing Workflow</h2>
          <p className="text-eq-grey text-sm mt-1">Site-based NSX / MCCB testing — framework mirroring ACB.</p>
        </div>
        {selectedSite && !noAssets && (
          <Button size="sm" onClick={() => setShowCreateCheck(true)}>
            <Plus className="w-3 h-3 mr-1" />
            Create Check
          </Button>
        )}
      </div>

      {/* Site Selector */}
      <Card className="p-4">
        <label className="block text-xs font-bold text-eq-grey uppercase mb-2">Select Site</label>
        <select
          value={selectedSite}
          onChange={(e) => {
            setSelectedSite(e.target.value)
            setSelectedAsset(null)
          }}
          className="w-full h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
        >
          <option value="">Choose a site...</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{formatSiteLabel(s)}</option>
          ))}
        </select>
      </Card>

      {selectedSite && !loading && noAssets && (
        <Card className="p-8 text-center">
          <p className="text-eq-grey">No NSX assets found for this site.</p>
          <p className="text-xs text-eq-grey mt-1">Ensure assets are assigned to an NSX / MCCB maintenance plan.</p>
        </Card>
      )}

      {selectedSite && !noAssets && (
        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-eq-grey">Loading...</div>
          ) : (
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
                  {assets.map((asset) => {
                    const test = asset.nsx_test
                    const progress = getOverallProgress(test)
                    return (
                      <tr key={asset.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="py-3 px-4">
                          <p className="font-medium text-eq-ink">{asset.name}</p>
                          {asset.serial_number && (
                            <p className="text-xs text-eq-grey">{asset.serial_number}</p>
                          )}
                        </td>
                        <td className="py-3 px-4 text-eq-grey text-xs">{asset.asset_type}</td>
                        <td className="py-3 px-4 text-center">{statusBadge('Collection', getStepStatus(test, 'step1'))}</td>
                        <td className="py-3 px-4 text-center">{statusBadge('V&F', getStepStatus(test, 'step2'))}</td>
                        <td className="py-3 px-4 text-center">{statusBadge('Electrical', getStepStatus(test, 'step3'))}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  progress === 100 ? 'bg-green-500' : progress > 0 ? 'bg-eq-sky' : 'bg-gray-200'
                                }`}
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-xs text-eq-grey w-8 text-right">{progress}%</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {test ? (
                            <Button size="sm" onClick={() => setSelectedAsset(asset.id)}>
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
          )}
        </Card>
      )}
    </div>
  )
}
