// Quote money math — the single client-side source of truth for line-item
// pricing. These mirror the SQL in tenant-migration 0077 (eq__recompute_quote_totals)
// so the browser preview and the server-stored totals never diverge. Anything
// that changes a formula here MUST change it there too — the tests in
// quoteMath.test.ts lock the expected results.
//
// Money is in cents (bigint on the DB). Quantities are in thousandths (qty × 1000)
// so we never store fractional quantities as floats.

/**
 * Sell rate from a buy/cost rate plus a markup percentage.
 *   rate = cost × (1 + markup/100)
 * Returns NaN when cost is not a positive number, so callers can choose to keep
 * the manually-entered rate instead of overwriting it with a junk value.
 */
export function computeSellRate(costPerUnit: number, markupPct: number): number {
  if (!(costPerUnit > 0)) return NaN;
  const mk = isNaN(markupPct) ? 0 : markupPct;
  return costPerUnit * (1 + mk / 100);
}

/**
 * Markup percentage implied by a cost and a sell rate (the inverse of
 * computeSellRate). Used when opening the edit form to back-fill the markup
 * column from the stored cost/rate. Returns 0 when cost is not positive.
 */
export function computeMarkupPct(costPerUnit: number, sellRate: number): number {
  if (!(costPerUnit > 0)) return 0;
  return ((sellRate - costPerUnit) / costPerUnit) * 100;
}

/**
 * Line total in cents, matching the DB: (qty_thousandths × unit_rate_cents) / 1000
 * with integer (truncating) division, so the TS preview equals the stored value.
 */
export function lineTotalCents(qtyThousandths: number, unitRateCents: number): number {
  return Math.trunc((qtyThousandths * unitRateCents) / 1000);
}

/**
 * Quote margin percentage from sell vs cost totals (cents), rounded to 2dp.
 *   margin = (sell − cost) / sell × 100
 * Returns null when there is nothing to sell (sell <= 0), matching the DB which
 * stores NULL rather than 0 so "no margin yet" is distinct from "0% margin".
 */
export function computeMarginPct(
  sellTotalCents: number,
  costTotalCents: number,
): number | null {
  if (!(sellTotalCents > 0)) return null;
  return Math.round(((sellTotalCents - costTotalCents) / sellTotalCents) * 100 * 100) / 100;
}
