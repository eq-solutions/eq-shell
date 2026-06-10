/**
 * Breaker column mirroring — dual-write helper for acb_tests / nsx_tests.
 *
 * Sprint 1 of the 2026-05-13 audit (Refs #101): the canonical 3-step
 * workflow writes breaker identification to NEW columns
 *   brand / breaker_type / current_in / trip_unit_model
 * while the legacy bulk-edit form (AcbBulkDetails) writes the LEGACY
 *   cb_make / cb_model / cb_rating / trip_unit
 *
 * Both column sets carry the same data. Until a follow-up PR retires the
 * legacy set, every write site mirrors values across both sets so the
 * customer report renders identically regardless of which form created
 * the row. This helper takes an arbitrary partial update payload and
 * returns the same payload with the sibling column populated wherever
 * one side has a value and the other doesn't.
 *
 * Mirroring rules (only mirror when sibling is undefined or null/empty):
 *   brand           <-> cb_make
 *   breaker_type    <-> cb_model
 *   current_in      <-> cb_rating
 *   trip_unit_model <-> trip_unit
 *
 * cb_serial and cb_poles are shared (no NEW counterpart) — passed through.
 */

type BreakerLike = Record<string, unknown>

const PAIRS: Array<[newCol: string, legacyCol: string]> = [
  ['brand', 'cb_make'],
  ['breaker_type', 'cb_model'],
  ['current_in', 'cb_rating'],
  ['trip_unit_model', 'trip_unit'],
]

function isMeaningful(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string' && v.trim() === '') return false
  return true
}

/**
 * Return a shallow-cloned update payload with each breaker-identification
 * pair mirrored. If ONE side of a pair carries a meaningful value and the
 * OTHER side is missing/null/empty in the input, the sibling is filled in.
 * If BOTH sides are present, they're left alone — explicit caller wins.
 */
export function mirrorBreakerColumns<T extends BreakerLike>(input: T): T {
  const out: BreakerLike = { ...input }
  for (const [newCol, legacyCol] of PAIRS) {
    const newVal = out[newCol]
    const legacyVal = out[legacyCol]
    const newHas = newCol in out && isMeaningful(newVal)
    const legacyHas = legacyCol in out && isMeaningful(legacyVal)
    if (newHas && !legacyHas) {
      out[legacyCol] = newVal
    } else if (legacyHas && !newHas) {
      out[newCol] = legacyVal
    }
  }
  return out as T
}
