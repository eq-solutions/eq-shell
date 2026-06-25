/**
 * Task 2 acceptance — duplicate / merge detection.
 *
 * Re-importing the same export flags 100% of rows as duplicates of existing
 * assets; choosing "update existing" stamps the existing asset_id so the
 * commit RPC upserts in place (ON CONFLICT asset_id) instead of inserting a
 * second copy. Within-batch duplicates are flagged too.
 */

import { describe, it, expect } from "vitest";
import { createConfirmFlow } from "../src/index.js";
import type { FlowConfig } from "../src/index.js";
import type { AIProvider, MapInput, MapResult } from "@eq/ai";
import type { DupLookup, ExistingAssetMatch } from "@eq/intake";
import { ASSET_SCHEMA } from "./fixtures/asset-schema.js";

const TENANT = "00000000-0000-4000-8000-000000000001";

function metrics() {
  return { provider: "mock", model: "mock", tokensIn: 0, tokensOut: 0, latencyMs: 0, success: true, retried: false, startedAt: new Date().toISOString() };
}

/** Identity mapping, no enrichment (kept off so we isolate dedup behaviour). */
function identityAi(): AIProvider {
  return {
    async map(input: MapInput): Promise<MapResult> {
      return {
        mappings: input.sourceColumns.map((c) => ({ sourceColumn: c, canonicalField: c, confidence: 1, reason: "identity" })),
        unmappedRequiredFields: [],
        warnings: [],
        suggestions: [],
        needsClarification: [],
        metrics: metrics(),
      };
    },
    async extract() {
      throw new Error("not used");
    },
  };
}

describe("duplicate detection flow — task 2", () => {
  it("re-importing the same export flags 100% as existing dupes; update stamps asset_id", async () => {
    const committed: { rows: { canonical: Record<string, unknown> }[] } = { rows: [] };
    const flow = createConfirmFlow();

    const lookup: DupLookup = async (): Promise<ExistingAssetMatch[]> => [
      { asset_id: "asset-aaa", serial_number: "SN-1" },
      { asset_id: "asset-bbb", serial_number: "SN-2" },
    ];

    const config: FlowConfig = {
      schema: ASSET_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      enableEnrichment: false,
      dupLookup: lookup,
      commit: async (rows) => {
        committed.rows = rows as { canonical: Record<string, unknown> }[];
        return { committed: rows.length, failed: 0 };
      },
    };
    flow.driver.configure(config);

    const csv = "name,serial_number\nBoard A,SN-1\nBoard B,SN-2\n";
    await flow.driver.runToConfirmMapping({ name: "assets.csv", bytes: new TextEncoder().encode(csv) });
    await flow.driver.validate();

    const result = flow.useStore.getState().validationResult!;
    // Both rows flagged as duplicates — none left as plain-valid.
    expect(result.summary.flagged).toBe(2);
    expect(result.summary.valid).toBe(0);
    for (const row of result.flagged_rows) {
      const dup = row.flags.find((f) => f.kind === "duplicate");
      expect(dup).toBeDefined();
      if (dup?.kind === "duplicate") {
        expect(dup.matchType).toBe("existing");
        expect(dup.existingAssetId).toMatch(/^asset-/);
      }
    }

    // "Update existing" for both -> stamp the existing asset_id.
    for (const row of result.flagged_rows) {
      const dup = row.flags.find((f) => f.kind === "duplicate");
      if (dup?.kind === "duplicate") {
        flow.useStore.getState().resolveFlag(row.source_row_index, {
          kind: "set_value",
          field: "asset_id",
          value: dup.existingAssetId,
        });
      }
    }

    await flow.driver.commit();
    expect(committed.rows).toHaveLength(2);
    const ids = committed.rows.map((r) => r.canonical.asset_id).sort();
    expect(ids).toEqual(["asset-aaa", "asset-bbb"]);
  });

  it("flags a within-batch duplicate serial and can skip it", async () => {
    const committed: { rows: { canonical: Record<string, unknown> }[] } = { rows: [] };
    const flow = createConfirmFlow();
    flow.driver.configure({
      schema: ASSET_SCHEMA,
      tenantId: TENANT,
      ai: identityAi(),
      enableEnrichment: false,
      commit: async (rows) => {
        committed.rows = rows as { canonical: Record<string, unknown> }[];
        return { committed: rows.length, failed: 0 };
      },
    });

    // Two rows share serial SN-9 within the batch.
    const csv = "name,serial_number\nBoard A,SN-9\nBoard A copy,SN-9\n";
    await flow.driver.runToConfirmMapping({ name: "assets.csv", bytes: new TextEncoder().encode(csv) });
    await flow.driver.validate();

    const result = flow.useStore.getState().validationResult!;
    const dupRow = result.flagged_rows.find((r) =>
      r.flags.some((f) => f.kind === "duplicate" && f.matchType === "within_batch"),
    );
    expect(dupRow).toBeDefined();

    // Skip the duplicate -> only the first row commits.
    flow.useStore.getState().resolveFlag(dupRow!.source_row_index, { kind: "skip_row" });
    await flow.driver.commit();
    expect(committed.rows).toHaveLength(1);
  });
});
