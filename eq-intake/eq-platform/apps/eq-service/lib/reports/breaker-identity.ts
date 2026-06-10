/**
 * Breaker identity resolver — shared by Customer Report + Field Run-Sheet.
 *
 * Sprint 1 schema unification (Refs #101) has ACB / NSX tests carrying TWO
 * sets of breaker-identification columns:
 *
 *   - LEGACY (bulk-edit form):  cb_make, cb_model, cb_rating, trip_unit
 *   - NEW    (3-step workflow): brand, breaker_type, current_in, trip_unit_model
 *
 * Plus the shared columns `cb_serial`, `cb_poles`, `performance_level`,
 * `fixed_withdrawable` (single-source, no fallback needed).
 *
 * The report routes hand-wired `brand ?? cb_make` etc. in two places —
 * `/api/pm-asset-report/route.ts` (buildAcbDetail, buildNsxDetail, summary
 * map) and `/api/maintenance-checklist/route.ts` (test-kind synthesis). When
 * the column migration finishes and legacy columns get dropped, both routes
 * have to flip in sync. This helper centralises that fallback.
 *
 * Pass either an ACB or NSX test row — the helper accepts the union.
 */

export interface BreakerIdentityRow {
  // Legacy columns
  cb_make: string | null
  cb_model: string | null
  cb_rating: string | null
  trip_unit: string | null

  // New workflow columns
  brand: string | null
  breaker_type: string | null
  current_in: string | null
  trip_unit_model: string | null

  // Shared single-source columns
  cb_serial: string | null
  cb_poles: string | null
  fixed_withdrawable: string | null

  // ACB-only — NSX has no performance level
  performance_level?: string | null
}

/**
 * The normalised identity returned to report callers. Field names match
 * what the docx generator expects on AcbTestDetail / NsxTestDetail so the
 * helper output can be passed through directly.
 */
export interface ResolvedBreakerIdentity {
  cbMake: string | null
  cbModel: string | null
  cbSerial: string | null
  cbRating: string | null
  poles: string | null
  tripUnit: string | null
  performanceLevel: string | null
  fixedWithdrawable: string | null
}

/**
 * Resolve a test row's breaker identity, preferring NEW workflow columns
 * over LEGACY. When both are null/empty, returns null for that field —
 * callers handle the missing-data case in their layout.
 *
 * @param row     - The test row (ACB or NSX).
 * @param options - { includePerformanceLevel: false } drops the performance
 *                  level field for NSX tests (NSX has no performance level
 *                  in the data model).
 */
export function resolveBreakerIdentity(
  row: BreakerIdentityRow,
  options: { includePerformanceLevel?: boolean } = {},
): ResolvedBreakerIdentity {
  const { includePerformanceLevel = true } = options
  return {
    cbMake: row.brand ?? row.cb_make,
    cbModel: row.breaker_type ?? row.cb_model,
    cbSerial: row.cb_serial,
    cbRating: row.current_in ?? row.cb_rating,
    poles: row.cb_poles,
    tripUnit: row.trip_unit_model ?? row.trip_unit,
    performanceLevel: includePerformanceLevel ? (row.performance_level ?? null) : null,
    fixedWithdrawable: row.fixed_withdrawable,
  }
}

/**
 * Compact make/model string for summary lines (e.g. "Schneider Masterpact").
 * Returns '—' when both are null. Trims and joins with a space; collapses
 * empty parts so we don't emit dangling spaces.
 */
export function formatMakeModel(
  row: Pick<BreakerIdentityRow, 'brand' | 'cb_make' | 'breaker_type' | 'cb_model'>,
): string {
  const make = row.brand ?? row.cb_make ?? ''
  const model = row.breaker_type ?? row.cb_model ?? ''
  const combined = [make, model].filter(Boolean).join(' ').trim()
  return combined || '—'
}
