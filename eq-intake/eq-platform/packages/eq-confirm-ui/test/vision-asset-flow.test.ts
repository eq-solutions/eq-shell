/**
 * Task 4 acceptance — nameplate photo → asset.
 *
 * A photo of a switchboard nameplate runs through the vision extractor and
 * produces a draft asset row with make + serial filled, reaching the confirm
 * screen. The vision sheet is already canonical-keyed, so the driver must
 * take the fast-path: no classify, no AI column re-mapping.
 */

import { describe, it, expect, vi } from "vitest";
import { createConfirmFlow } from "../src/index.js";
import type { FlowConfig } from "../src/index.js";
import type { AIProvider, ExtractInput, ExtractResult, MapInput, MapResult } from "@eq/ai";
import { ASSET_SCHEMA } from "./fixtures/asset-schema.js";

const TENANT = "00000000-0000-4000-8000-000000000001";

function metrics() {
  return { provider: "mock", model: "mock", tokensIn: 0, tokensOut: 0, latencyMs: 0, success: true, retried: false, startedAt: new Date().toISOString() };
}

describe("nameplate photo flow — task 4", () => {
  it("creates a draft asset with make + serial and skips AI column mapping", async () => {
    const mapSpy = vi.fn();
    const visionAi: AIProvider = {
      async map(input: MapInput): Promise<MapResult> {
        mapSpy(input);
        return {
          mappings: [],
          unmappedRequiredFields: [],
          warnings: [],
          suggestions: [],
          needsClarification: [],
          metrics: metrics(),
        };
      },
      async extract(_input: ExtractInput): Promise<ExtractResult> {
        return {
          extracted: {
            name: "Main Switchboard",
            make: "Schneider Electric",
            model: "Prisma P",
            serial_number: "SN-SWB-44219",
          },
          fieldConfidence: { name: 0.9, make: 0.95, model: 0.8, serial_number: 0.97 },
          rawText: "SCHNEIDER ELECTRIC Prisma P  S/N SN-SWB-44219  Main Switchboard",
          uncertainFields: [],
          illegibleRegions: [],
          warnings: [],
          metadata: { estimatedPages: 1, estimatedCaptureMethod: "photo", appearsSigned: false, appearsComplete: true },
          metrics: metrics(),
        };
      },
    };

    const committed: { rows: { canonical: Record<string, unknown> }[] } = { rows: [] };
    const flow = createConfirmFlow();
    const config: FlowConfig = {
      schema: ASSET_SCHEMA,
      tenantId: TENANT,
      ai: visionAi,
      enableEnrichment: false,
      commit: async (rows) => {
        committed.rows = rows as { canonical: Record<string, unknown> }[];
        return { committed: rows.length, failed: 0 };
      },
    };
    flow.driver.configure(config);

    // JPEG magic bytes — enough for the format detector to route to vision.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]);
    await flow.driver.runToConfirmMapping({ name: "nameplate.jpg", bytes: jpeg });

    const state = flow.useStore.getState();
    expect(state.status.kind).toBe("confirm_mapping");
    // Draft asset row carries make + serial straight from the nameplate.
    expect(state.parsedSheet!.rows[0]).toMatchObject({
      make: "Schneider Electric",
      serial_number: "SN-SWB-44219",
    });
    // Fast-path: the AI column mapper was never invoked on canonical-keyed data.
    expect(mapSpy).not.toHaveBeenCalled();
    // Identity overrides were seeded so the row validates + commits.
    expect(state.userOverrides.make).toBe("make");

    await flow.driver.validate();
    expect(flow.useStore.getState().validationResult!.summary.rejected).toBe(0);

    await flow.driver.commit();
    expect(committed.rows[0]!.canonical).toMatchObject({
      make: "Schneider Electric",
      serial_number: "SN-SWB-44219",
    });
  });
});
