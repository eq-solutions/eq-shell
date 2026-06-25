/**
 * Task 3 acceptance — site fuzzy-match review.
 *
 * An ambiguous site name (close to two real sites) is surfaced as a
 * fk_fuzzy_match flag with scored candidates; site_id stays null until the
 * user picks — never silently mis-linked. The bulk "accept top match" path
 * picks each row's best candidate.
 */

import { describe, it, expect } from "vitest";
import { createConfirmFlow } from "../src/index.js";
import type { FlowConfig } from "../src/index.js";
import type { AIProvider, MapInput, MapResult } from "@eq/ai";
import type { FkLookup } from "@eq/validation";
import { ASSET_SCHEMA } from "./fixtures/asset-schema.js";

const TENANT = "00000000-0000-4000-8000-000000000001";

function metrics() {
  return { provider: "mock", model: "mock", tokensIn: 0, tokensOut: 0, latencyMs: 0, success: true, retried: false, startedAt: new Date().toISOString() };
}

/** Maps the source 'site' column onto canonical site_id; name onto name. */
function siteAi(): AIProvider {
  return {
    async map(input: MapInput): Promise<MapResult> {
      return {
        mappings: input.sourceColumns.map((c) => ({
          sourceColumn: c,
          canonicalField: c === "site" ? "site_id" : c,
          confidence: 1,
          reason: "test",
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
  };
}

// Two sites close to "Equinix SY3" — neither an exact match, both fuzzy.
const fkLookup: FkLookup = {
  async list() {
    return [
      { id: "site-1", fields: { name: "Equinix SY1", code: "SY1", external_id: null } },
      { id: "site-2", fields: { name: "Equinix SY2", code: "SY2", external_id: null } },
    ];
  },
  async byId() {
    return null;
  },
};

function makeFlow(committed: { rows: { canonical: Record<string, unknown> }[] }) {
  const flow = createConfirmFlow();
  const config: FlowConfig = {
    schema: ASSET_SCHEMA,
    tenantId: TENANT,
    ai: siteAi(),
    fkLookup,
    commit: async (rows) => {
      committed.rows = rows as { canonical: Record<string, unknown> }[];
      return { committed: rows.length, failed: 0 };
    },
  };
  flow.driver.configure(config);
  return flow;
}

describe("site fuzzy-match flow — task 3", () => {
  it("shows a scored candidate picker for an ambiguous site, site_id null until resolved", async () => {
    const committed = { rows: [] as { canonical: Record<string, unknown> }[] };
    const flow = makeFlow(committed);

    const csv = "name,site\nUPS 1,Equinix SY3\n";
    await flow.driver.runToConfirmMapping({ name: "assets.csv", bytes: new TextEncoder().encode(csv) });
    await flow.driver.validate();

    const result = flow.useStore.getState().validationResult!;
    const row = result.flagged_rows[0]!;
    const fuzzy = row.flags.find((f) => f.kind === "fk_fuzzy_match");
    expect(fuzzy).toBeDefined();
    if (fuzzy?.kind === "fk_fuzzy_match") {
      expect(fuzzy.field).toBe("site_id");
      expect(fuzzy.candidates.length).toBeGreaterThanOrEqual(2);
      // Candidates carry a confidence score for the UI.
      expect(fuzzy.candidates[0].score).toBeGreaterThan(0.85);
    }
    // No silent mis-link: site_id is null on the canonical row pre-resolution.
    expect(row.canonical.site_id).toBeNull();
  });

  it("bulk 'accept top match' picks each row's best candidate on commit", async () => {
    const committed = { rows: [] as { canonical: Record<string, unknown> }[] };
    const flow = makeFlow(committed);
    const csv = "name,site\nUPS 1,Equinix SY3\n";
    await flow.driver.runToConfirmMapping({ name: "assets.csv", bytes: new TextEncoder().encode(csv) });
    await flow.driver.validate();

    // Bulk top-pick (the BulkActions button for fuzzy flags).
    flow.useStore.getState().resolveBulkPickTop("fk_fuzzy_match");

    await flow.driver.commit();
    const siteId = committed.rows[0]!.canonical.site_id;
    expect(["site-1", "site-2"]).toContain(siteId);
  });
});
