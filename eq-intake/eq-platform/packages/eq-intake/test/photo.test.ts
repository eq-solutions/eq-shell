/**
 * Photo reader tests.
 *
 * Mock AIProvider returns a canned ExtractResult — verifies the photo
 * reader threads its output into a ParsedSheet that downstream code can
 * consume identically to CSV / XLSX output.
 */

import { describe, it, expect } from "vitest";
import { parsePhoto } from "../src/readers/photo.js";
import type { AIProvider, ExtractInput, ExtractResult, MapResult } from "@eq/ai";

function mockAi(extracted: Record<string, unknown>, confidence: Record<string, number> = {}): AIProvider {
  return {
    async extract(_input: ExtractInput): Promise<ExtractResult> {
      return {
        extracted,
        fieldConfidence: confidence,
        rawText: "raw text from vision",
        uncertainFields: [],
        illegibleRegions: [],
        warnings: [],
        metadata: {
          estimatedPages: 1,
          estimatedCaptureMethod: "photo",
          appearsSigned: false,
          appearsComplete: true,
        },
        metrics: {
          provider: "mock",
          model: "mock",
          tokensIn: 0,
          tokensOut: 0,
          latencyMs: 0,
          success: true,
          retried: false,
          startedAt: new Date().toISOString(),
        },
      };
    },
    async map(): Promise<MapResult> {
      throw new Error("not used");
    },
  };
}

const SAMPLE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic
const TARGET_SCHEMA = {
  type: "object",
  properties: {
    first_name: { type: "string" },
    last_name: { type: "string" },
  },
};

describe("parsePhoto", () => {
  it("returns one ParsedSheet with extracted fields as the row", async () => {
    const ai = mockAi(
      { first_name: "James", last_name: "Patel" },
      { first_name: 0.95, last_name: 0.92 },
    );
    const sheets = await parsePhoto({
      bytes: SAMPLE_BYTES,
      mediaType: "image/jpeg",
      ai,
      targetSchema: TARGET_SCHEMA,
    });
    expect(sheets).toHaveLength(1);
    const sheet = sheets[0]!;
    expect(sheet.sheetName).toBe("vision_extract");
    expect(sheet.headerRow).toEqual(["first_name", "last_name"]);
    expect(sheet.rows[0]).toMatchObject({
      first_name: "James",
      last_name: "Patel",
    });
  });

  it("aggregates per-field confidence into meta.visionConfidence", async () => {
    const ai = mockAi(
      { a: "1", b: "2" },
      { a: 0.9, b: 0.6 },
    );
    const sheets = await parsePhoto({
      bytes: SAMPLE_BYTES,
      mediaType: "image/jpeg",
      ai,
      targetSchema: TARGET_SCHEMA,
    });
    const meta = sheets[0]!.meta as { visionConfidence?: number };
    expect(meta.visionConfidence).toBeCloseTo(0.75, 2);
  });

  it("preserves the raw vision text on the sheet meta for audit", async () => {
    const ai = mockAi({ x: "1" }, { x: 1.0 });
    const sheets = await parsePhoto({
      bytes: SAMPLE_BYTES,
      mediaType: "image/jpeg",
      ai,
      targetSchema: TARGET_SCHEMA,
    });
    const meta = sheets[0]!.meta as { visionRawText?: string };
    expect(meta.visionRawText).toBe("raw text from vision");
  });
});
