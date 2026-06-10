/**
 * Server-side query for scope context. Pulls candidate contract_scopes
 * rows for the (customer, site, year) tuple, filters by acceptable FY
 * format, scores by specificity, returns the top-ranked status.
 *
 * NOT marked 'use server' — this is a helper called by server actions and
 * server components. The server-action wrapper (callable from client
 * components) lives at app/(app)/maintenance/scope-context-action.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  candidateFinancialYears,
  resolveScopeStatus,
  scoreScopeRow,
  type ScopeContextResult,
  type ScopeRow,
} from './lookup'

/**
 * Resolve scope context for the given context. Caller must pass a Supabase
 * client (server-side). Tenant scoping happens via RLS — the caller's
 * tenant membership is enforced through the policies on contract_scopes.
 */
export async function getScopeContext(
  supabase: SupabaseClient,
  opts: {
    customerId: string
    siteId: string | null
    assetId?: string | null
    jobPlanId?: string | null
    /** Calendar year to target. Defaults to current. */
    year?: number
  },
): Promise<ScopeContextResult> {
  const targetYear = opts.year ?? new Date().getFullYear()
  const fyCandidates = candidateFinancialYears(targetYear)

  // One round-trip — fetch all scope rows for this customer in any of
  // the candidate years, then narrow in-memory by site/jp/asset.
  const { data: rowsRaw, error } = await supabase
    .from('contract_scopes')
    .select(`
      id, scope_item, jp_code, is_included, billing_basis,
      year_totals, intervals_text, financial_year,
      asset_id, job_plan_id, site_id, customer_id
    `)
    .eq('customer_id', opts.customerId)
    .in('financial_year', fyCandidates)

  if (error) {
    return {
      status: 'out_of_scope',
      label: 'Scope unknown',
      detail: `Lookup failed: ${error.message}`,
      scope_id: null,
      matched_year: null,
      amount_for_year: null,
    }
  }

  const rows = (rowsRaw ?? []) as unknown as ScopeRow[]

  // Filter to rows that could plausibly apply: site_id matches OR null,
  // asset_id matches OR null. Reject hard mismatches.
  const candidates = rows.filter((r) => {
    if (opts.siteId && r.site_id && r.site_id !== opts.siteId) return false
    if (opts.assetId && r.asset_id && r.asset_id !== opts.assetId) return false
    if (opts.jobPlanId && r.job_plan_id && r.job_plan_id !== opts.jobPlanId) return false
    return true
  })

  // Sort: most specific first; included before excluded so an in-scope
  // row wins over a less-specific exclusion row.
  const sorted = candidates
    .map((r) => ({
      row: r,
      score: scoreScopeRow(r, {
        siteId: opts.siteId ?? null,
        assetId: opts.assetId ?? null,
        jobPlanId: opts.jobPlanId ?? null,
      }),
    }))
    .sort((a, b) => {
      // Specificity first, then included-before-excluded
      if (a.score !== b.score) return b.score - a.score
      if (a.row.is_included !== b.row.is_included) return a.row.is_included ? -1 : 1
      return 0
    })
    .map((s) => s.row)

  return resolveScopeStatus(sorted, targetYear)
}
