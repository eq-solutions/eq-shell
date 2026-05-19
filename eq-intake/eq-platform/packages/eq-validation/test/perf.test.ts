/**
 * Performance test - 10,000 rows must validate in <2s on a single thread.
 * Per Phase 1 NFR target in COWORK-BRIEF-PHASE-1.md.
 *
 * The fixture is generated synthetically (deterministic) to avoid disk I/O
 * dominating the measurement. Schema is staff (largest realistic field set).
 *
 * Synthetic distribution (chosen to mirror what a real bulk import looks like
 * — a mostly-clean file with a small minority of warnings and a thin tail of
 * rejected rows). The split exercises both rejection and warning paths in
 * one run:
 *   - 8500 valid     (clean — active=true, all required fields present)
 *   - 1300 flagged   (inactive without end_date — `inactive_has_end_date` warning)
 *   -  200 rejected  (missing first_name — required-field rejection)
 *
 * The earlier all-flagged synthetic was an artefact: every row carried a
 * mapped sensitive field (hourly_rate_cost), so the orchestrator correctly
 * tagged every row with the `sensitive_field` advisory. Numbers reconciled
 * but the output ("10000 flagged 0 valid") looked like everything was broken.
 *
 * `hourly_rate_cost` is intentionally NOT in this mapping — including it
 * would re-introduce the all-rows-flagged effect. The sensitive-field path
 * is exercised separately by the `validate.test.ts` suite.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../src/validate.js";

const __filename = fileURLToPath(import.meta.url);
const SCHEMAS_DIR = join(dirname(__filename), "..", "..", "eq-schemas", "src", "schemas");

const ROW_COUNT = 10_000;
const PERF_BUDGET_MS = 2_000;

// Boundaries of the synthetic mix (see header comment). Adjust together if the
// distribution shifts.
const REJECTED_END = 200;       // i in 0..199            — rejected (blank first_name)
const INACTIVE_END = 1500;      // i in 200..1499         — flagged (inactive_has_end_date warning)
//                                 i in 1500..9999        — valid

const EXPECTED_REJECTED = REJECTED_END;
const EXPECTED_FLAGGED = INACTIVE_END - REJECTED_END;
const EXPECTED_VALID = ROW_COUNT - EXPECTED_REJECTED - EXPECTED_FLAGGED;

const TRADES = ["electrical", "mechanical", "fire", "hydraulic", "civil", "data", "carpentry", "plumbing"];
const TYPES = ["employee", "subcontractor", "labour_hire", "casual", "apprentice"];

function makeRow(i: number) {
  const isRejected = i < REJECTED_END;
  const isInactive = i >= REJECTED_END && i < INACTIVE_END;

  return {
    first_name: isRejected ? "" : "First" + i,
    last_name: "Last" + i,
    email: "user" + i + "@example.com.au",
    phone: "0412" + String(100000 + (i % 900000)).padStart(6, "0"),
    employment_type: TYPES[i % TYPES.length]!,
    trade: TRADES[i % TRADES.length]!,
    start_date: "2024-0" + ((i % 9) + 1) + "-15",
    active: !isInactive,
  };
}

describe("validate() - 10K-row performance", async () => {
  const staffSchema = JSON.parse(
    await readFile(join(SCHEMAS_DIR, "staff.schema.json"), "utf8"),
  );
  const rows = Array.from({ length: ROW_COUNT }, (_, i) => makeRow(i));

  const mapping: Record<string, string | null> = {
    first_name: "first_name",
    last_name: "last_name",
    email: "email",
    phone: "phone",
    employment_type: "employment_type",
    trade: "trade",
    start_date: "start_date",
    active: "active",
    // hourly_rate_cost intentionally omitted — see header comment.
  };

  it("processes " + ROW_COUNT + " rows in under " + PERF_BUDGET_MS + "ms", async () => {
    const t0 = performance.now();
    const result = await validate({
      schema: staffSchema,
      mapping,
      rows,
      tenantId: "00000000-0000-4000-8000-000000000001",
    });
    const elapsed = performance.now() - t0;

    console.log("[perf] " + ROW_COUNT + " rows in " + elapsed.toFixed(0) + "ms");
    console.log("[perf] summary:", result.summary);

    expect(result.summary.total).toBe(ROW_COUNT);
    expect(result.summary.valid).toBe(EXPECTED_VALID);
    expect(result.summary.flagged).toBe(EXPECTED_FLAGGED);
    expect(result.summary.rejected).toBe(EXPECTED_REJECTED);
    expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
  }, 10_000);
});
