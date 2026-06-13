import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSellRate,
  computeMarkupPct,
  lineTotalCents,
  computeMarginPct,
} from "./quoteMath";

// These expectations mirror, line-for-line, the values asserted by the SQL
// regression test (supabase/tests/quote_math.sql) and the live verification of
// migration 0077 — so the browser preview and the server-stored totals provably
// agree. If the DB rollup changes, these must change too (and vice versa).

test("computeSellRate applies markup over cost", () => {
  assert.equal(computeSellRate(100, 15).toFixed(2), "115.00");
  assert.equal(computeSellRate(200, 25).toFixed(2), "250.00");
  assert.equal(computeSellRate(100, 0).toFixed(2), "100.00");
});

test("computeSellRate returns NaN when cost is not positive (keeps the manual rate)", () => {
  assert.ok(Number.isNaN(computeSellRate(0, 15)));
  assert.ok(Number.isNaN(computeSellRate(NaN, 15)));
  assert.ok(Number.isNaN(computeSellRate(-5, 15)));
});

test("computeSellRate treats a blank/NaN markup as 0", () => {
  assert.equal(computeSellRate(100, NaN).toFixed(2), "100.00");
});

test("computeMarkupPct inverts computeSellRate", () => {
  assert.equal(computeMarkupPct(100, 115), 15);
  assert.equal(computeMarkupPct(400, 500).toFixed(2), "25.00");
  assert.equal(computeMarkupPct(0, 100), 0);
});

test("lineTotalCents matches the DB integer math (qty_thousandths × rate / 1000)", () => {
  assert.equal(lineTotalCents(2000, 11500), 23000);
  assert.equal(lineTotalCents(1000, 50000), 50000);
  assert.equal(lineTotalCents(1500, 10000), 15000);
});

test("computeMarginPct matches the DB rollup (2dp; null when nothing to sell)", () => {
  // (73000 - 60000) / 73000 × 100 = 17.81  — same as VERIFY_OK on sks-canonical
  assert.equal(computeMarginPct(73000, 60000)?.toFixed(2), "17.81");
  assert.equal(computeMarginPct(20000, 15000), 25);
  assert.equal(computeMarginPct(0, 0), null);
  assert.equal(computeMarginPct(1000, 0), 100);
});
