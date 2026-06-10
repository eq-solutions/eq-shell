/**
 * Scope-context lookup: find the contract_scopes row that covers a given
 * (customer, site, job_plan, year) tuple, regardless of which financial-year
 * format the customer uses.
 *
 * Customers using `fiscal_year_basis='calendar'` (Equinix per migration 0072)
 * file scope under `'2026'`. Customers on Aus FY (Jemena, the legacy
 * scope-item entries) file under `'2025-2026'` or `'FY25/26'`. The
 * lookup tries them all and returns the first match.
 *
 * Pure functions only (no DB access) — the server-side query helper lives
 * in getScopeContext.ts.
 */

export type ScopeStatus = 'contracted' | 'ad_hoc' | 'excluded' | 'out_of_scope'

export interface ScopeContextResult {
  /** What the operator should know about this work. */
  status: ScopeStatus
  /** Plain-English label for the chip (matches status). */
  label: string
  /** Detail line surfacing the matched scope's $ / cycle / etc. */
  detail: string | null
  /** The matched contract_scopes row id, when there is one. */
  scope_id: string | null
  /** The financial_year value that matched, for traceability. */
  matched_year: string | null
  /** Year-totals amount for the requested calendar year, when available. */
  amount_for_year: number | null
}

export interface ScopeRow {
  id: string
  scope_item: string
  jp_code: string | null
  is_included: boolean
  billing_basis: string | null
  year_totals: Record<string, number> | null
  intervals_text: string | null
  financial_year: string
  asset_id: string | null
  job_plan_id: string | null
  site_id: string | null
  customer_id: string
}

/**
 * Build the list of financial_year strings to try when looking up scope
 * for a given calendar year. Order: most likely format first.
 *
 * For year=2026 returns: ['2026', '2025-2026', '2026-2027', 'FY25/26', 'FY26/27']
 *
 * The reverse-lookup also expands so a scope filed under '2025-2026' is
 * reachable when the operator targets either the Jul-Jun-25/26 or the
 * Jul-Jun-26/27 year — most relationships are FY-aligned so a single
 * scope row covers two calendar years' worth of work.
 */
export function candidateFinancialYears(targetYear: number): string[] {
  const yPrev = targetYear - 1
  const yNext = targetYear + 1
  const fyShort = (a: number, b: number) => `FY${String(a).slice(-2)}/${String(b).slice(-2)}`
  return [
    String(targetYear),                  // calendar year — Equinix style
    `${yPrev}-${targetYear}`,            // Aus FY hyphenated, ending in target year
    `${targetYear}-${yNext}`,            // Aus FY hyphenated, starting in target year
    fyShort(yPrev, targetYear),          // FY24/25 short
    fyShort(targetYear, yNext),          // FY25/26 short
  ]
}

/**
 * Score a scope row's specificity against a (site, asset, job_plan) tuple.
 * Higher = more specific match. Used to pick the best when multiple rows
 * could plausibly apply.
 *
 *  4 — exact asset_id match
 *  3 — job_plan_id match (e.g. all E1.25 ACBs)
 *  2 — site_id match (or null = applies tenant-wide-for-this-customer)
 *  1 — customer-level only (no asset/site/jp pins)
 */
export function scoreScopeRow(
  row: ScopeRow,
  ctx: { siteId: string | null; assetId: string | null; jobPlanId: string | null },
): number {
  if (ctx.assetId && row.asset_id === ctx.assetId) return 4
  if (ctx.jobPlanId && row.job_plan_id === ctx.jobPlanId) return 3
  if (ctx.siteId && row.site_id === ctx.siteId) return 2
  return 1
}

/**
 * Resolve scope status from a ranked, year-filtered list of scope rows.
 * Returns 'out_of_scope' when nothing matches at all.
 */
export function resolveScopeStatus(
  rows: ScopeRow[],
  targetYear: number,
): ScopeContextResult {
  if (rows.length === 0) {
    return {
      status: 'out_of_scope',
      label: 'Out of scope',
      detail: 'No contract scope row covers this work for the target year.',
      scope_id: null,
      matched_year: null,
      amount_for_year: null,
    }
  }

  // Pick the first row (caller has already sorted by precedence).
  const top = rows[0]

  if (!top.is_included) {
    return {
      status: 'excluded',
      label: 'Excluded from scope',
      detail: top.intervals_text
        ? `Scope row marks this as excluded (${top.intervals_text}).`
        : 'Scope row marks this as excluded.',
      scope_id: top.id,
      matched_year: top.financial_year,
      amount_for_year: null,
    }
  }

  const yearAmount =
    top.year_totals && top.year_totals[String(targetYear)]
      ? Number(top.year_totals[String(targetYear)])
      : null

  if (top.billing_basis === 'ad_hoc') {
    return {
      status: 'ad_hoc',
      label: 'In scope · ad-hoc',
      detail: `Billed per visit. ${top.intervals_text ?? ''}`.trim(),
      scope_id: top.id,
      matched_year: top.financial_year,
      amount_for_year: yearAmount,
    }
  }

  // billing_basis = 'fixed' OR null/legacy → treat as contracted.
  const intervalBit = top.intervals_text ? ` · ${top.intervals_text}` : ''
  const amountBit = yearAmount && yearAmount > 0
    ? ` · ${yearAmount.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })} priced for ${targetYear}`
    : yearAmount === 0 && top.year_totals && Object.keys(top.year_totals).length > 0
      ? ` · no spend in ${targetYear} (cycle year elsewhere)`
      : ''

  return {
    status: 'contracted',
    label: 'In scope · contracted',
    detail: `${top.scope_item}${intervalBit}${amountBit}`.trim(),
    scope_id: top.id,
    matched_year: top.financial_year,
    amount_for_year: yearAmount,
  }
}
