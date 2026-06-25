/**
 * enrichAssets — orchestration over ai.enrich().
 *
 * Verifies the gating (only rows missing a field AND having evidence are sent),
 * suggestion filtering (only fields the row was missing come back), and the
 * no-op when the provider can't enrich.
 */

import { describe, it, expect, vi } from "vitest";
import { enrichAssets } from "../src/enrich.js";
import type { AIProvider, EnrichInput, EnrichResult } from "@eq/ai";

const ASSET_SCHEMA = { type: "object", "x-eq-entity": "asset", properties: {} };

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

/** Provider that suggests a fixed value for every requested field of every sent row. */
function enrichAi(
  onCall?: (input: EnrichInput) => void,
): AIProvider {
  return {
    async map() {
      throw new Error("not used");
    },
    async extract() {
      throw new Error("not used");
    },
    async enrich(input: EnrichInput): Promise<EnrichResult> {
      onCall?.(input);
      return {
        suggestions: input.rows.map((r) => ({
          index: r.index,
          fields: Object.fromEntries(
            input.fieldsToInfer.map((f) => [
              f,
              { value: `guess_${f}`, confidence: 0.8, reason: "mock" },
            ]),
          ),
        })),
        metrics: metrics(),
      };
    },
  };
}

describe("enrichAssets", () => {
  it("only sends rows that are missing a field AND have evidence", async () => {
    let sent: EnrichInput | undefined;
    const ai = enrichAi((i) => (sent = i));

    const suggestions = await enrichAssets({
      ai,
      schema: ASSET_SCHEMA,
      fieldsToInfer: ["asset_type", "criticality"],
      rows: [
        // missing both, has evidence -> sent
        { index: 0, canonical: { name: "Switchboard A" } },
        // already complete -> skipped
        { index: 1, canonical: { name: "UPS B", asset_type: "ups", criticality: "high" } },
        // missing fields but NO evidence -> skipped
        { index: 2, canonical: { asset_type: null, criticality: null } },
      ],
    });

    expect(sent?.rows.map((r) => r.index)).toEqual([0]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.index).toBe(0);
    expect(Object.keys(suggestions[0]!.fields).sort()).toEqual(["asset_type", "criticality"]);
  });

  it("filters suggestions to the fields the row was actually missing", async () => {
    const ai = enrichAi();
    const suggestions = await enrichAssets({
      ai,
      schema: ASSET_SCHEMA,
      fieldsToInfer: ["asset_type", "criticality"],
      // asset_type already present; only criticality is missing
      rows: [{ index: 5, canonical: { name: "Gen 1", asset_type: "generator" } }],
    });

    expect(suggestions).toHaveLength(1);
    expect(Object.keys(suggestions[0]!.fields)).toEqual(["criticality"]);
  });

  it("is a no-op when the provider has no enrich() capability", async () => {
    const ai: AIProvider = {
      async map() {
        throw new Error("nope");
      },
      async extract() {
        throw new Error("nope");
      },
    };
    const enrichSpy = vi.fn();
    const suggestions = await enrichAssets({
      ai,
      schema: ASSET_SCHEMA,
      fieldsToInfer: ["asset_type"],
      rows: [{ index: 0, canonical: { name: "X" } }],
    });
    expect(suggestions).toEqual([]);
    expect(enrichSpy).not.toHaveBeenCalled();
  });
});
