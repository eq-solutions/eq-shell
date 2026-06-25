/**
 * @eq/ai — mock-based tests for AnthropicProvider.enrich().
 *
 * No real network. We replace globalThis.fetch with a mock and check: the
 * happy path normalises suggestions, the cheap Haiku model is used, fields
 * outside the requested set are dropped, and null-valued suggestions are not
 * surfaced (a missing suggestion beats a wrong one).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AnthropicProvider } from "../src/index.js";

function fakeResponse(textBody: string, usage = { input_tokens: 20, output_tokens: 40 }) {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: textBody }], usage }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const ASSET_SCHEMA = {
  type: "object",
  "x-eq-entity": "asset",
  properties: {
    name: { type: "string" },
    asset_type: { type: "string", enum: ["switchboard", "ups", "other"] },
    criticality: { type: "string", enum: ["critical", "high", "medium", "low"] },
    ppm_frequency: { type: "string" },
  },
};

function enrichInput() {
  return {
    targetSchema: ASSET_SCHEMA,
    rows: [{ index: 0, fields: { name: "Main Switchboard MSB-1" } }],
    fieldsToInfer: ["asset_type", "criticality", "ppm_frequency"],
  };
}

describe("AnthropicProvider.enrich()", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("normalises suggestions and uses the cheap Haiku model", async () => {
    const body = JSON.stringify({
      suggestions: [
        {
          index: 0,
          fields: {
            asset_type: { value: "switchboard", confidence: 0.95, reason: "name says so" },
            criticality: { value: "high", confidence: 0.6, reason: "main board" },
          },
        },
      ],
    });
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(body));
    globalThis.fetch = fetchMock;

    const ai = new AnthropicProvider({ apiKey: "test-key" });
    const result = await ai.enrich!(enrichInput());

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.fields.asset_type).toEqual({
      value: "switchboard",
      confidence: 0.95,
      reason: "name says so",
    });
    expect(result.metrics.success).toBe(true);

    // The request body should name the Haiku model.
    const sentBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(sentBody.model).toBe("claude-haiku-4-5");
  });

  it("drops fields outside fieldsToInfer and null-valued suggestions", async () => {
    const body = JSON.stringify({
      suggestions: [
        {
          index: 0,
          fields: {
            asset_type: { value: "switchboard", confidence: 0.9, reason: "ok" },
            // null value — model declined; must not surface
            criticality: { value: null, confidence: 0.2, reason: "unsure" },
            // not requested — must be dropped
            condition: { value: "good", confidence: 0.8, reason: "n/a" },
          },
        },
      ],
    });
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse(body));

    const ai = new AnthropicProvider({ apiKey: "test-key" });
    const result = await ai.enrich!(enrichInput());

    const fields = result.suggestions[0]!.fields;
    expect(Object.keys(fields)).toEqual(["asset_type"]);
  });
});
