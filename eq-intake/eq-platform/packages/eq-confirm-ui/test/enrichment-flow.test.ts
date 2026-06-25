/**
 * Task 1 acceptance — AI asset enrichment.
 *
 * A CSV with only name + make yields suggested asset_type + ppm_frequency as
 * flags on the row. The user accepts (value written) or rejects (left empty);
 * nothing is written before the user acts.
 */

import { describe, it, expect } from "vitest";
import { createConfirmFlow } from "../src/index.js";
import type { FlowConfig } from "../src/index.js";
import type { AIProvider, MapInput, MapResult, EnrichInput, EnrichResult } from "@eq/ai";
import { ASSET_SCHEMA } from "./fixtures/asset-schema.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const CSV = "name,make\nMain Switchboard MSB-1,Schneider\n";

function metrics() {
  return {
    provider: "mock",
    model: "mock",
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 0,
    success: true,
    retried: false,
    startedAt: new Date().toISOString(),
  };
}

/** Identity column mapping + canned enrichment suggestions. */
function assetAi(): AIProvider {
  return {
    async map(input: MapInput): Promise<MapResult> {
      return {
        mappings: input.sourceColumns.map((c) => ({
          sourceColumn: c,
          canonicalField: c,
          confidence: 0.95,
          reason: "identity",
        })),
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
    async enrich(input: EnrichInput): Promise<EnrichResult> {
      return {
        suggestions: input.rows.map((r) => ({
          index: r.index,
          fields: {
            asset_type: { value: "switchboard", confidence: 0.92, reason: "name says switchboard" },
            ppm_frequency: { value: "6M", confidence: 0.6, reason: "switchboards serviced 6-monthly" },
            criticality: { value: "high", confidence: 0.55, reason: "main board" },
          },
        })),
        metrics: metrics(),
      };
    },
  };
}

function makeFlow(committed: { rows: unknown[] }) {
  const flow = createConfirmFlow();
  const config: FlowConfig = {
    schema: ASSET_SCHEMA,
    tenantId: TENANT,
    ai: assetAi(),
    commit: async (rows) => {
      committed.rows = rows;
      return { committed: rows.length, failed: 0 };
    },
  };
  flow.driver.configure(config);
  return flow;
}

describe("enrichment flow — task 1", () => {
  it("surfaces asset_type + ppm_frequency as ai_enrichment flags, nothing written yet", async () => {
    const committed = { rows: [] as unknown[] };
    const flow = makeFlow(committed);

    await flow.driver.runToConfirmMapping({ name: "assets.csv", bytes: new TextEncoder().encode(CSV) });
    await flow.driver.validate();

    const result = flow.useStore.getState().validationResult!;
    // The single row moved from valid -> flagged because it gained suggestions.
    expect(result.summary.valid).toBe(0);
    expect(result.summary.flagged).toBe(1);

    const flags = result.flagged_rows[0]!.flags.filter((f) => f.kind === "ai_enrichment");
    const fields = flags.map((f) => (f.kind === "ai_enrichment" ? f.field : ""));
    expect(fields).toContain("asset_type");
    expect(fields).toContain("ppm_frequency");

    // Pre-acceptance: the canonical row carries NO asset_type — never silently written.
    expect(result.flagged_rows[0]!.canonical.asset_type).toBeUndefined();
  });

  it("accepting suggestions writes the values on commit", async () => {
    const committed = { rows: [] as unknown[] };
    const flow = makeFlow(committed);
    await flow.driver.runToConfirmMapping({ name: "assets.csv", bytes: new TextEncoder().encode(CSV) });
    await flow.driver.validate();

    const idx = flow.useStore.getState().validationResult!.flagged_rows[0]!.source_row_index;
    flow.useStore.getState().resolveFlag(idx, {
      kind: "set_fields",
      values: { asset_type: "switchboard", ppm_frequency: "6M" },
    });

    await flow.driver.commit();
    const row = committed.rows[0] as { canonical: Record<string, unknown> };
    expect(row.canonical.asset_type).toBe("switchboard");
    expect(row.canonical.ppm_frequency).toBe("6M");
  });

  it("rejecting (no acceptance) leaves the fields empty on commit", async () => {
    const committed = { rows: [] as unknown[] };
    const flow = makeFlow(committed);
    await flow.driver.runToConfirmMapping({ name: "assets.csv", bytes: new TextEncoder().encode(CSV) });
    await flow.driver.validate();

    // No resolution recorded -> row commits as-is (suggestions discarded).
    await flow.driver.commit();
    const row = committed.rows[0] as { canonical: Record<string, unknown> };
    expect(row.canonical.asset_type).toBeUndefined();
    expect(row.canonical.ppm_frequency).toBeUndefined();
    expect(row.canonical.name).toBe("Main Switchboard MSB-1");
  });
});
