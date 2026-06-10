import { createClient } from '@/lib/supabase/server'
import { ShieldCheck, ShieldAlert, Info } from 'lucide-react'

interface ContractScopeBannerProps {
  /** Site this check is at — used to scope the lookup. */
  siteId: string | null
  /** Customer that owns the site — also used to scope. */
  customerId?: string | null
  /** Optional asset pin — if set, prefer asset-level scope rows. */
  assetId?: string | null
  /** Optional job-plan pin — for family-level matches. */
  jobPlanId?: string | null
  /** Hides the banner if there are no scope rows at all (avoids empty noise). */
  hideWhenEmpty?: boolean
}

interface ScopeRow {
  scope_item: string
  is_included: boolean
  notes: string | null
  asset_id: string | null
  job_plan_id: string | null
  site_id: string | null
}

/**
 * Server component that fetches and renders the contract scope rows
 * relevant to the current maintenance check context. Phase-2 of Royce's
 * 26-Apr review: scope info pushed to where the work happens, instead of
 * waiting for the tech to navigate to /contract-scope.
 *
 * Match precedence (most specific first):
 *   1. asset_id matches → exact-asset scope row.
 *   2. job_plan_id matches → family-level (e.g. all E1.25 ACBs).
 *   3. site_id matches → site-wide scope.
 *   4. customer-level (no asset/site/jp pins) → fallback.
 *
 * Rows are FY-filtered to the current Australian financial year.
 *
 * Rendering: green (in-scope) and amber (out-of-scope) chips, capped at
 * the most-relevant 6 items. Out-of-scope wins display priority — that's
 * the hazard the tech most needs to see.
 */
export async function ContractScopeBanner({
  siteId,
  customerId = null,
  assetId = null,
  jobPlanId = null,
  hideWhenEmpty = true,
}: ContractScopeBannerProps) {
  if (!siteId && !customerId) return null

  const supabase = await createClient()

  // Resolve customer_id from site if not passed in. Cheaper than nesting joins.
  let resolvedCustomerId = customerId
  if (!resolvedCustomerId && siteId) {
    const { data } = await supabase
      .from('sites')
      .select('customer_id')
      .eq('id', siteId)
      .maybeSingle()
    resolvedCustomerId = (data?.customer_id as string | null) ?? null
  }
  if (!resolvedCustomerId) return null

  // Current AU FY string — matches what /contract-scope creates rows under.
  const now = new Date()
  const fyStartYear = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1
  const fy = `FY${String(fyStartYear).slice(-2)}/${String(fyStartYear + 1).slice(-2)}`

  // Pull every scope row for this customer + FY in one query, then filter
  // in-memory by precedence. Dataset is small (typically <50 per FY).
  let query = supabase
    .from('contract_scopes')
    .select('scope_item, is_included, notes, asset_id, job_plan_id, site_id')
    .eq('customer_id', resolvedCustomerId)
    .eq('financial_year', fy)

  // Limit to scope items that could plausibly apply to this asset/site:
  // - Their site_id matches (or is null = applies to all sites).
  // - Their asset_id matches (or is null = applies to all assets).
  if (siteId) {
    query = query.or(`site_id.eq.${siteId},site_id.is.null`)
  }

  const { data: rows } = await query

  if (!rows || rows.length === 0) {
    if (hideWhenEmpty) return null
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-eq-grey flex items-start gap-3">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>No contract scope rows on file for this customer ({fy}). Add some on /contract-scope to surface here.</span>
      </div>
    )
  }

  // Score each row: 4 = exact asset, 3 = job-plan, 2 = site, 1 = customer.
  function score(r: ScopeRow): number {
    if (assetId && r.asset_id === assetId) return 4
    if (jobPlanId && r.job_plan_id === jobPlanId) return 3
    if (siteId && r.site_id === siteId) return 2
    return 1
  }

  const scored = (rows as unknown as ScopeRow[])
    .map((r) => ({ ...r, _score: score(r) }))
    // Out-of-scope first (the warning), then by precedence specificity.
    .sort((a, b) => {
      if (a.is_included !== b.is_included) return a.is_included ? 1 : -1
      return b._score - a._score
    })
    .slice(0, 6)

  if (scored.length === 0 && hideWhenEmpty) return null

  const includedCount = scored.filter((s) => s.is_included).length
  const excludedCount = scored.filter((s) => !s.is_included).length

  return (
    <div className="rounded-lg border border-eq-sky/30 bg-eq-ice/40 px-4 py-3">
      <div className="flex items-start gap-3">
        {excludedCount > 0 ? (
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        ) : (
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-eq-deep" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-eq-ink mb-1.5">
            Contract scope ({fy})
            <span className="text-eq-grey font-normal ml-1">
              · {includedCount} included
              {excludedCount > 0 && <>, <span className="text-amber-700 font-semibold">{excludedCount} excluded</span></>}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {scored.map((s, idx) => (
              <span
                key={idx}
                title={s.notes ?? undefined}
                className={
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ' +
                  (s.is_included
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200')
                }
              >
                {s.is_included ? '✓' : '✕'} {s.scope_item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
