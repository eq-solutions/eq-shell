'use client'

import { useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { createCheckAction, previewCheckAssetsAction } from './actions'
import type { JobPlan, Site } from '@/lib/types'
import { formatSiteLabel } from '@/lib/utils/format'
import { CheckCircle2, XCircle, Scale } from 'lucide-react'
import { events as analyticsEvents } from '@/lib/analytics'
import { ScopeContextChip } from '@/components/ui/ScopeContextChip'

// Tradie-friendly role labels for the assignee dropdown — keeps the
// role chip readable without leaking DB role strings.
const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  supervisor: 'Supervisor',
  technician: 'Technician',
  read_only: 'Read only',
}

const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-Annual' },
  { value: 'annual', label: 'Annual' },
  { value: '2yr', label: '2 Year' },
  { value: '3yr', label: '3 Year' },
  { value: '5yr', label: '5 Year' },
  { value: '8yr', label: '8 Year' },
  { value: '10yr', label: '10 Year' },
] as const

interface PreviewAsset {
  id: string
  name: string
  maximo_id: string | null
  location: string | null
  job_plan_name: string | null
  task_count: number
  /**
   * RCD overlay only — count of circuits on the most recent prior rcd_test
   * for this asset. Tells the user how many circuits will be pre-populated
   * onto the new check (timing values blank, ready to fill onsite).
   * Undefined for non-RCD checks.
   */
  prior_circuit_count?: number
}

interface ScopeItem {
  id: string
  customer_id: string
  site_id: string | null
  scope_item: string
  is_included: boolean
  notes: string | null
  financial_year: string
}

interface CreateCheckFormProps {
  open: boolean
  onClose: () => void
  jobPlans: (Pick<JobPlan, 'id' | 'name' | 'code'> & {
    /** site_id + customer_id come from job_plans.scope tier — used for the
     * fall-back "scope-based" filter when no asset-linked plans exist
     * at the chosen site. */
    site_id?: string | null
    customer_id?: string | null
  })[]
  sites: (Pick<Site, 'id' | 'name' | 'customer_id'> & {
    code?: string | null
    customers?: { name?: string | null } | { name?: string | null }[] | null
  })[]
  customers: { id: string; name: string }[]
  /**
   * Flat list of (site_id, job_plan_id) pairs from every active asset
   * with a job_plan_id set. Drives the "Maintenance Plans filtered by
   * site assets" behaviour (Royce 2026-05-19).
   */
  siteAssetPlans: { site_id: string; job_plan_id: string }[]
  /**
   * Tenant members for the assignee dropdown. Includes role + is_active
   * so we can show role chips, sort by hierarchy, and clarify why the
   * list is short (no admins / no supervisors / etc).
   */
  technicians: {
    id: string
    email: string
    full_name: string | null
    role: string | null
    is_active: boolean
  }[]
  scopeItems: ScopeItem[]
}

export function CreateCheckForm({ open, onClose, jobPlans, sites, customers, siteAssetPlans, technicians, scopeItems }: CreateCheckFormProps) {
  const [error, setError] = useState<string | null>(null)
  // Per-field validation errors (form polish bundle — PR H pattern).
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  // Form state
  // Pick customer first → site list filters to that customer (Royce
  // 2026-05-19 — easier to digest a long site list).
  // Empty customerId = "All customers" (legacy behaviour).
  const [customerId, setCustomerId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [frequency, setFrequency] = useState('')
  const [isDarkSite, setIsDarkSite] = useState(false)
  // Multi-plan filter (Simon 2026-04 feedback item 9 — "ability to add
  // multiple JCs"). Empty set means "all plans". One id ≡ legacy single
  // dropdown. Two or more hits the new .in('job_plan_id', …) path in
  // previewCheckAssetsAction + createCheckAction.
  const [jobPlanIds, setJobPlanIds] = useState<Set<string>>(new Set())
  const [manualMode, setManualMode] = useState(false)
  const [manualMaximoIds, setManualMaximoIds] = useState('')

  // Filter the site dropdown by selected customer (empty = all customers).
  const filteredSites = useMemo(() => {
    if (!customerId) return sites
    return sites.filter((s) => s.customer_id === customerId)
  }, [sites, customerId])

  // Filter the Maintenance Plans list to plans actually attached to
  // active assets at the chosen site (Royce 2026-05-19 — "only for
  // active assets for that site"). Fallback: if no asset-linked plans
  // exist at the site (greenfield site, plans not yet wired to assets),
  // surface the scope-based set (global + customer-scoped + site-scoped)
  // so the admin isn't blocked.
  const filteredJobPlans = useMemo(() => {
    if (!siteId) return jobPlans
    const linkedIds = new Set(
      siteAssetPlans.filter((p) => p.site_id === siteId).map((p) => p.job_plan_id)
    )
    const assetLinked = jobPlans.filter((jp) => linkedIds.has(jp.id))
    if (assetLinked.length > 0) return assetLinked
    // Fallback: scope-based filter (global + customer-scoped + site-scoped).
    const site = sites.find((s) => s.id === siteId)
    return jobPlans.filter((jp) => {
      if (jp.site_id === siteId) return true
      if (jp.customer_id && jp.customer_id === site?.customer_id) return true
      // Global plans (both null).
      if (jp.site_id == null && jp.customer_id == null) return true
      return false
    })
  }, [jobPlans, siteAssetPlans, siteId, sites])
  // Track whether we fell back to scope-based filtering (no asset-linked
  // plans at the site) — surface that as a hint so the admin knows why
  // they see a wider list.
  const planFilterUsedFallback = useMemo(() => {
    if (!siteId) return false
    const hasAssetLinked = siteAssetPlans.some((p) => p.site_id === siteId)
    return !hasAssetLinked
  }, [siteId, siteAssetPlans])

  // Preview state
  const [previewAssets, setPreviewAssets] = useState<PreviewAsset[]>([])
  const [previewTotal, setPreviewTotal] = useState(0)
  const [hasPreview, setHasPreview] = useState(false)

  // Scope items filtered by selected site's customer
  const relevantScope = useMemo(() => {
    if (!siteId) return []
    const site = sites.find((s) => s.id === siteId)
    if (!site?.customer_id) return []
    return scopeItems.filter(
      (s) => s.customer_id === site.customer_id && (s.site_id === null || s.site_id === siteId)
    )
  }, [siteId, sites, scopeItems])

  const includedScope = relevantScope.filter((s) => s.is_included)
  const excludedScope = relevantScope.filter((s) => !s.is_included)

  const resetForm = useCallback(() => {
    setCustomerId('')
    setSiteId('')
    setFrequency('')
    setIsDarkSite(false)
    setJobPlanIds(new Set())
    setManualMode(false)
    setManualMaximoIds('')
    setPreviewAssets([])
    setPreviewTotal(0)
    setHasPreview(false)
    setError(null)
    setSuccess(false)
  }, [])

  function toggleJobPlan(id: string) {
    setJobPlanIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setHasPreview(false)
  }

  async function handlePreview() {
    if (!siteId || !frequency) return
    setPreviewing(true)
    setError(null)

    const result = await previewCheckAssetsAction(
      siteId,
      frequency,
      isDarkSite,
      Array.from(jobPlanIds),
    )
    setPreviewing(false)

    if (result.success) {
      setPreviewAssets(result.assets as PreviewAsset[])
      setPreviewTotal(result.totalTasks)
      setHasPreview(true)
    } else {
      setError(result.error ?? 'Failed to preview assets.')
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setErrors({})
    setSuccess(false)
    setLoading(true)

    const form = e.currentTarget
    const formData = new FormData(form)
    formData.set('is_dark_site', isDarkSite ? 'true' : 'false')
    // Serialise the multi-plan filter as JSON. The server action reads
    // `job_plan_ids`, falling back to the legacy `job_plan_id` input if
    // absent (see actions.ts handling).
    formData.set('job_plan_ids', JSON.stringify(Array.from(jobPlanIds)))

    // If manual mode, we need to resolve Maximo IDs to asset UUIDs on the server
    // For now, pass the preview asset IDs
    if (!manualMode && previewAssets.length > 0) {
      // Path A: pass the previewed asset IDs
      formData.set('manual_asset_ids', JSON.stringify(previewAssets.map((a) => a.id)))
    }

    const result = await createCheckAction(formData)
    setLoading(false)

    if (result.success) {
      analyticsEvents.checkCreated({
        check_type: (formData.get('kind') as string) || 'general',
        asset_type: (formData.get('job_plan_id') as string) || 'unknown',
      })
      setSuccess(true)
      const baseMsg = `Check created: ${result.assetCount ?? 0} assets, ${result.taskCount ?? 0} tasks`
      const rcdSuffix =
        (result.rcdTestsCreated ?? 0) > 0
          ? ` · ${result.rcdTestsCreated} RCD test${result.rcdTestsCreated === 1 ? '' : 's'} pre-populated (${result.circuitsCopied ?? 0} circuit${result.circuitsCopied === 1 ? '' : 's'} from last visit)`
          : ''
      const msg = baseMsg + rcdSuffix
      setTimeout(() => { onClose(); resetForm() }, 1500)
      setError(null)
      // Show success with counts
      setSuccess(true)
      setPreviewTotal(0)
      setPreviewAssets([])
      // Override success message
      const el = document.getElementById('create-check-success')
      if (el) el.textContent = msg
    } else {
      const r = result as { error?: string; errors?: Record<string, string> }
      setError(r.error ?? 'Something went wrong.')
      // Per-field error mapping + scroll-to-first (form polish bundle).
      const fieldErrors = r.errors ?? {}
      setErrors(fieldErrors)
      const firstKey = Object.keys(fieldErrors)[0]
      if (firstKey) {
        const el = form.querySelector(`[name="${firstKey}"]`) as HTMLElement | null
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        ;(el as HTMLInputElement | null)?.focus?.()
      }
    }
  }

  function handleClose() {
    onClose()
    resetForm()
  }

  return (
    <SlidePanel open={open} onClose={handleClose} title="New Maintenance Check">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Customer — pick first, narrows the Site list (Royce 2026-05-19). */}
        {customers.length > 1 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Customer</label>
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value)
                // Clear downstream selections if the picked site no longer
                // belongs to the new customer.
                const picked = sites.find((s) => s.id === siteId)
                if (e.target.value && picked && picked.customer_id !== e.target.value) {
                  setSiteId('')
                  setJobPlanIds(new Set())
                }
                setHasPreview(false)
              }}
              className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
            >
              <option value="">All customers</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-eq-grey">Pick a customer to narrow the site list below.</p>
          </div>
        )}

        {/* Site — filtered by customer if picked. */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site *</label>
          <select
            name="site_id"
            required
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value)
              // Clearing site also clears the plan multi-select so the
              // filtered-plan list re-renders cleanly.
              setJobPlanIds(new Set())
              setHasPreview(false)
            }}
            className={`h-10 px-4 border rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:ring-2 ${errors.site_id ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : 'border-gray-200 focus:border-eq-deep focus:ring-eq-sky/20'}`}
          >
            <option value="">Select site...</option>
            {filteredSites.map((s) => (
              <option key={s.id} value={s.id}>{formatSiteLabel(s)}</option>
            ))}
          </select>
          {errors.site_id && <p className="text-xs text-red-500 mt-1">{errors.site_id}</p>}
          {customerId && filteredSites.length === 0 && (
            <p className="text-[11px] text-amber-700">This customer has no active sites yet.</p>
          )}
        </div>

        {/* Frequency */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Maintenance Frequency *</label>
          <select
            name="frequency"
            required
            value={frequency}
            onChange={(e) => { setFrequency(e.target.value); setHasPreview(false) }}
            className={`h-10 px-4 border rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:ring-2 ${errors.frequency ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : 'border-gray-200 focus:border-eq-deep focus:ring-eq-sky/20'}`}
          >
            <option value="">Select frequency...</option>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          {errors.frequency && <p className="text-xs text-red-500 mt-1">{errors.frequency}</p>}
        </div>

        {/* Dark Site Toggle */}
        <label className="flex items-center gap-2 text-sm text-eq-ink">
          <input
            type="checkbox"
            checked={isDarkSite}
            onChange={(e) => { setIsDarkSite(e.target.checked); setHasPreview(false) }}
            className="rounded border-gray-300 text-eq-sky focus:ring-eq-sky"
          />
          Dark Site Test
        </label>

        {/* Contract Scope Info */}
        {siteId && relevantScope.length > 0 && (
          <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            <div className="px-3 py-2 bg-eq-ice/50 border-b border-gray-200 flex items-center gap-2">
              <Scale className="w-3.5 h-3.5 text-eq-deep" />
              <span className="text-xs font-bold text-eq-deep uppercase tracking-wide">
                Contract Scope — {relevantScope[0]?.financial_year}
              </span>
            </div>
            <div className="max-h-36 overflow-y-auto divide-y divide-gray-50">
              {includedScope.map((s) => (
                <div key={s.id} className="flex items-start gap-2 px-3 py-1.5 text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600 mt-0.5 shrink-0" />
                  <span className="text-eq-ink">{s.scope_item}</span>
                </div>
              ))}
              {excludedScope.map((s) => (
                <div key={s.id} className="flex items-start gap-2 px-3 py-1.5 text-xs">
                  <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                  <span className="text-eq-grey">{s.scope_item}</span>
                </div>
              ))}
            </div>
            <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100 text-[10px] text-eq-grey">
              {includedScope.length} included · {excludedScope.length} excluded
            </div>
          </div>
        )}

        {/* Maintenance Plan Filter — filtered to plans linked to active
            assets at the selected site (Royce 2026-05-19). When no site
            is picked yet, every plan in the tenant is shown so the user
            sees the catalogue. */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">
              Maintenance Plans (optional filter)
            </label>
            <div className="flex items-center gap-2 text-[11px]">
              {siteId && (
                <span className="text-eq-grey">
                  {filteredJobPlans.length} for this site
                </span>
              )}
              {jobPlanIds.size > 0 && (
                <>
                  <span className="text-eq-grey">· {jobPlanIds.size} selected</span>
                  <button
                    type="button"
                    onClick={() => { setJobPlanIds(new Set()); setHasPreview(false) }}
                    className="text-eq-sky hover:text-eq-deep font-medium"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>
          {filteredJobPlans.length === 0 ? (
            <p className="text-xs text-eq-grey italic px-2 py-1.5">
              {siteId
                ? 'No maintenance plans linked to assets at this site. Add a maintenance_plan to an asset in /assets or create a global plan in /job-plans.'
                : 'No maintenance plans available for this tenant.'}
            </p>
          ) : (
            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-md bg-white divide-y divide-gray-50">
              {filteredJobPlans.map((jp) => {
                const checked = jobPlanIds.has(jp.id)
                return (
                  <label
                    key={jp.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-eq-ink hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleJobPlan(jp.id)}
                      className="rounded border-gray-300 text-eq-sky focus:ring-eq-sky"
                    />
                    <span className="flex-1">
                      {jp.name}
                      {jp.code ? <span className="text-eq-grey ml-1">({jp.code})</span> : null}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
          <p className="text-[11px] text-eq-grey mt-1">
            {siteId
              ? planFilterUsedFallback
                ? 'No assets at this site have a maintenance plan attached yet — showing every plan scoped to this site / customer. Attach plans to assets via /assets to narrow this list.'
                : 'Showing plans attached to active assets at this site. Leave all unchecked to include every shown plan.'
              : 'Pick a site above to filter this list to plans actually used at that site.'}
          </p>
        </div>

        {/* Scope-context chip — only when exactly one JP is selected so we
            can do an unambiguous lookup. Multi-plan checks skip this; the
            site-level ContractScopeBanner on /maintenance/[id] still shows
            the bigger picture once the check is created. */}
        {siteId && jobPlanIds.size === 1 && (() => {
          const site = sites.find((s) => s.id === siteId)
          const onlyJp = Array.from(jobPlanIds)[0]
          if (!site?.customer_id || !onlyJp) return null
          return (
            <ScopeContextChip
              customerId={site.customer_id}
              siteId={siteId}
              jobPlanId={onlyJp}
              surfaceOverrideField
            />
          )
        })()}

        {/* Preview Button */}
        {siteId && frequency && !manualMode && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handlePreview}
            disabled={previewing}
          >
            {previewing ? 'Loading...' : hasPreview ? 'Refresh Preview' : 'Preview Assets'}
          </Button>
        )}

        {/* Preview Results */}
        {hasPreview && (
          <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            <div className="px-3 py-2 bg-eq-ice/50 border-b border-gray-200 flex justify-between">
              <span className="text-xs font-bold text-eq-grey uppercase">
                {previewAssets.length} Assets · {previewTotal} Tasks
              </span>
            </div>
            {previewAssets.length === 0 ? (
              <p className="text-sm text-eq-grey p-3">No assets found matching criteria.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                {previewAssets.map((a) => {
                  const isRcd = a.prior_circuit_count !== undefined
                  return (
                    <div key={a.id} className="px-3 py-2 text-xs">
                      <div className="flex justify-between">
                        <span className="font-medium text-eq-ink">{a.maximo_id ?? a.name}</span>
                        <span className="text-eq-grey">{a.task_count} tasks</span>
                      </div>
                      <div className="text-eq-grey truncate">
                        {a.maximo_id ? a.name : (a.location ?? '')}
                      </div>
                      {isRcd && (
                        <div className="mt-0.5 text-[11px]">
                          {a.prior_circuit_count && a.prior_circuit_count > 0 ? (
                            <span className="text-eq-deep">
                              ✨ {a.prior_circuit_count} circuit{a.prior_circuit_count === 1 ? '' : 's'} will be pre-populated from last visit
                            </span>
                          ) : (
                            <span className="text-amber-700">
                              ⚠ no previous test — circuits will need to be entered onsite
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Manual Mode Toggle */}
        <label className="flex items-center gap-2 text-sm text-eq-ink">
          <input
            type="checkbox"
            checked={manualMode}
            onChange={(e) => { setManualMode(e.target.checked); setHasPreview(false) }}
            className="rounded border-gray-300 text-eq-sky focus:ring-eq-sky"
          />
          Manual Assets (paste Maximo IDs)
        </label>

        {manualMode && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Maximo Asset IDs (one per line)</label>
            <textarea
              value={manualMaximoIds}
              onChange={(e) => setManualMaximoIds(e.target.value)}
              rows={4}
              placeholder="Paste Maximo IDs, one per line..."
              className="px-4 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20 font-mono"
            />
          </div>
        )}

        <hr className="border-gray-200" />

        {/* Custom Name */}
        <FormInput label="Custom Name" name="custom_name" placeholder="Optional name for this check" error={errors.custom_name} />

        {/* Dates — sensible defaults so the admin doesn't have to type
            today and today+30 from scratch on every check (UX audit
            PR #149 §A.10 / §3.7 — date defaults beat empty-required).
            ISO yyyy-MM-dd format is what <input type="date"> expects. */}
        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Start Date *"
            name="start_date"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            error={errors.start_date}
          />
          <FormInput
            label="Due Date *"
            name="due_date"
            type="date"
            required
            defaultValue={new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
            error={errors.due_date}
          />
        </div>

        {/* Assign to — every active tenant member is selectable. Each
            option carries the role label so the admin can see at a glance
            who is who (Royce 2026-05-19: the previous "Owner" dropdown
            didn't surface role; in a tenant where most members are super-
            admins it looked filtered to one role). */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Assign to</label>
          <select
            name="assigned_to"
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">— Unassigned —</option>
            {technicians.map((t) => {
              const name = t.full_name ?? t.email
              const role = t.role ? ROLE_LABELS[t.role] ?? t.role : null
              return (
                <option key={t.id} value={t.id}>
                  {name}{role ? ` — ${role}` : ''}
                </option>
              )
            })}
          </select>
          {technicians.length === 0 ? (
            <p className="text-[11px] text-amber-700">
              No active members in this workspace yet.{' '}
              <Link href="/admin/users" className="text-eq-sky hover:text-eq-deep font-medium underline">
                Invite teammates
              </Link>
              .
            </p>
          ) : technicians.length < 3 ? (
            <p className="text-[11px] text-eq-grey">
              Only {technicians.length} active member{technicians.length === 1 ? '' : 's'}.{' '}
              <Link href="/admin/users" className="text-eq-sky hover:text-eq-deep font-medium underline">
                Invite more
              </Link>
              {' '}to populate this list.
            </p>
          ) : null}
        </div>

        {/* Maximo References */}
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Maximo WO #" name="maximo_wo_number" placeholder="Work order number" />
          <FormInput label="Maximo PM #" name="maximo_pm_number" placeholder="PM number" />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Notes</label>
          <textarea
            name="notes"
            rows={2}
            placeholder="Optional notes"
            className="px-4 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p id="create-check-success" className="text-sm text-green-600">Check created successfully.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" loading={loading} disabled={!siteId || !frequency}>
            Create Check
          </Button>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
        </div>
      </form>
    </SlidePanel>
  )
}
