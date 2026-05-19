/**
 * processCapture tests - mocked AIProvider so we never hit the network.
 *
 * Covers: high-confidence happy path, low-confidence flagging, illegible
 * regions surfacing as capture_flags, validation gaps from extracted data.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { processCapture } from "../src/process-capture.js";
import type { AIProvider, ExtractResult, MapResult } from "@eq/ai";

const __filename = fileURLToPath(import.meta.url);
const SCHEMAS_DIR = join(dirname(__filename), "..", "..", "eq-schemas", "src", "schemas");

async function loadSchema(name: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(SCHEMAS_DIR, name + ".schema.json"), "utf8");
  return JSON.parse(raw);
}

const TENANT = "00000000-0000-4000-8000-000000000001";

function mockAi(extract: ExtractResult): AIProvider {
  return {
    async map(): Promise<MapResult> {
      throw new Error("map() not used by processCapture in these tests");
    },
    async extract(): Promise<ExtractResult> {
      return extract;
    },
  };
}

const HIGH_CONF: ExtractResult = {
  extracted: {
    first_name: "Sam",
    last_name: "Patel",
    employment_type: "employee",
    active: true,
  },
  fieldConfidence: { first_name: 0.96, last_name: 0.95, employment_type: 0.93, active: 0.99 },
  rawText: "Sam Patel - Employee - Active",
  uncertainFields: [],
  illegibleRegions: [],
  warnings: [],
  metadata: { estimatedPages: 1, estimatedCaptureMethod: "photo", appearsSigned: false, appearsComplete: true },
  metrics: { provider: "anthropic", model: "claude-sonnet-4-5", tokensIn: 200, tokensOut: 80, latencyMs: 800, success: true, retried: false, startedAt: "2026-04-29T10:00:00Z" },
};

describe("processCapture - happy path", async () => {
  const staffSchema = await loadSchema("staff");

  it("extracts + validates a high-confidence capture into a valid row", async () => {
    const result = await processCapture({
      ai: mockAi(HIGH_CONF),
      schema: staffSchema,
      fileBase64: "SGVsbG8=",
      mediaType: "image/png",
      tenantId: TENANT,
    });

    expect(result.summary.valid + result.summary.flagged).toBe(1);
    expect(result.summary.rejected).toBe(0);
    expect(result.capture_flags).toHaveLength(0);
    expect(result.raw_extracted["first_name"]).toBe("Sam");
    expect(result.extract_metadata.estimatedPages).toBe(1);
  });
});

describe("processCapture - low confidence flags", async () => {
  const staffSchema = await loadSchema("staff");

  it("flags fields below the confidence threshold", async () => {
    const lowConf: ExtractResult = {
      ...HIGH_CONF,
      fieldConfidence: { first_name: 0.55, last_name: 0.95, employment_type: 0.6, active: 0.99 },
    };

    const result = await processCapture({
      ai: mockAi(lowConf),
      schema: staffSchema,
      fileBase64: "SGVsbG8=",
      mediaType: "image/png",
      tenantId: TENANT,
      flagConfidenceBelow: 0.7,
    });

    const lowConfFlags = result.capture_flags.filter((f) => f.kind === "low_extraction_confidence");
    expect(lowConfFlags.length).toBe(2);
    const fields = lowConfFlags.map((f) => (f as { field: string }).field).sort();
    expect(fields).toEqual(["employment_type", "first_name"]);
  });

  it("respects a custom confidence threshold", async () => {
    const result = await processCapture({
      ai: mockAi(HIGH_CONF),
      schema: staffSchema,
      fileBase64: "SGVsbG8=",
      mediaType: "image/png",
      tenantId: TENANT,
      flagConfidenceBelow: 0.99, // very strict
    });
    // Every field is below 0.99 except `active` which is exactly 0.99
    const lowConfFlags = result.capture_flags.filter((f) => f.kind === "low_extraction_confidence");
    expect(lowConfFlags.length).toBeGreaterThan(0);
  });
});

describe("processCapture - illegible regions and warnings", async () => {
  const staffSchema = await loadSchema("staff");

  it("surfaces illegible regions as capture_flags", async () => {
    const withIllegible: ExtractResult = {
      ...HIGH_CONF,
      illegibleRegions: ["bottom-left signature", "top-right date stamp"],
    };

    const result = await processCapture({
      ai: mockAi(withIllegible),
      schema: staffSchema,
      fileBase64: "SGVsbG8=",
      mediaType: "image/png",
      tenantId: TENANT,
    });

    const illegibleFlags = result.capture_flags.filter((f) => f.kind === "illegible_region");
    expect(illegibleFlags).toHaveLength(2);
  });

  it("passes through extract warnings", async () => {
    const withWarning: ExtractResult = {
      ...HIGH_CONF,
      warnings: [{ type: "partial_capture", message: "Top edge is cropped" }],
    };

    const result = await processCapture({
      ai: mockAi(withWarning),
      schema: staffSchema,
      fileBase64: "SGVsbG8=",
      mediaType: "image/png",
      tenantId: TENANT,
    });

    const warningFlags = result.capture_flags.filter((f) => f.kind === "extract_warning");
    expect(warningFlags).toHaveLength(1);
    expect((warningFlags[0] as { message: string }).message).toBe("Top edge is cropped");
  });
});

describe("processCapture - validation gaps in extracted data", async () => {
  const staffSchema = await loadSchema("staff");

  it("rejects when required fields are missing from the extraction", async () => {
    const incomplete: ExtractResult = {
      ...HIGH_CONF,
      extracted: { first_name: "Sam" }, // missing last_name + employment_type
      fieldConfidence: { first_name: 0.96 },
    };

    const result = await processCapture({
      ai: mockAi(incomplete),
      schema: staffSchema,
      fileBase64: "SGVsbG8=",
      mediaType: "image/png",
      tenantId: TENANT,
    });

    expect(result.summary.rejected).toBe(1);
    const errs = result.rejected_rows[0]!.errors;
    const missingFields = errs.filter((e) => e.kind === "field_required").map((e) => (e as { field: string }).field);
    expect(missingFields).toContain("last_name");
    expect(missingFields).toContain("employment_type");
  });
});
