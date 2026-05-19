/**
 * @eq/ai - integration test against the REAL Anthropic API.
 *
 * Runs only when ANTHROPIC_API_KEY is set in the environment. Loaded via
 * `pnpm --filter @eq/ai test:integration` which uses Node\'s --env-file
 * flag to populate process.env from eq-platform/.env.
 *
 * Skip-if-absent semantics:
 *   - Key set     -> tests run, real API calls happen
 *   - Key missing -> tests skip cleanly (no failure)
 *
 * Costs: ~5 small calls per test run, well under one cent. Safe to run
 * repeatedly during development.
 */

import { describe, it, expect } from "vitest";
import { AnthropicProvider } from "../src/index.js";

const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

const SAMPLE_STAFF_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.eq.solutions/test/staff/v1.json",
  title: "Staff",
  description: "Minimal staff schema for integration testing.",
  type: "object",
  required: ["first_name", "last_name", "employment_type"],
  properties: {
    first_name: { type: "string", "x-eq-source-aliases": ["fname", "given"] },
    last_name: { type: "string", "x-eq-source-aliases": ["lname", "surname"] },
    email: { type: ["string", "null"], format: "email" },
    phone: { type: ["string", "null"], "x-eq-coerce": "phone-au" },
    employment_type: {
      type: "string",
      enum: ["employee", "subcontractor", "labour_hire", "casual", "apprentice"],
    },
  },
};

const SAMPLE_ROWS = [
  { Name: "James Patel", Mobile: "0412 345 678", Type: "FT" },
  { Name: "Sarah O\'Brien", Mobile: "+61413555111", Type: "Sub" },
  { Name: "Lien Tran", Mobile: "0415444222", Type: "Apprentice" },
  { Name: "Kofi Asante", Mobile: "0416777888", Type: "Permanent" },
  { Name: "Wei Chen", Mobile: "0422 555 444", Type: "labour-hire" },
];

describe.skipIf(!HAS_KEY)("AnthropicProvider.map() - REAL API", () => {
  it("returns a parsed MapResult against the staff schema with messy headers", async () => {
    const ai = new AnthropicProvider({});

    const result = await ai.map({
      targetSchema: SAMPLE_STAFF_SCHEMA,
      sourceColumns: ["Name", "Mobile", "Type"],
      sampleRows: SAMPLE_ROWS,
    });

    expect(result.mappings.length).toBeGreaterThan(0);
    expect(result.metrics?.success).toBe(true);
    expect(result.metrics?.tokensIn).toBeGreaterThan(0);
    expect(result.metrics?.tokensOut).toBeGreaterThan(0);

    // Print a friendly summary - useful when running by hand
    console.log("[real-api] mappings:");
    for (const m of result.mappings) {
      console.log("  " + m.sourceColumn + " -> " + (m.canonicalField ?? "(drop)") +
                  "  conf=" + m.confidence.toFixed(2));
    }
    console.log("[real-api] tokens in/out: " +
                result.metrics?.tokensIn + "/" + result.metrics?.tokensOut +
                ", latency " + result.metrics?.latencyMs + "ms");
  });
});

if (!HAS_KEY) {
  describe("@eq/ai integration tests", () => {
    it("skipped because ANTHROPIC_API_KEY is not set", () => {
      console.log("Set ANTHROPIC_API_KEY in eq-platform/.env to enable real API tests.");
      expect(HAS_KEY).toBe(false);
    });
  });
}
