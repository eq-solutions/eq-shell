/**
 * MockAi — a deterministic AIProvider that returns identity-style mappings.
 *
 * Used so the demo runs offline without an Anthropic API key. Replace with
 * AnthropicProvider in production. The contract is the same — @eq/confirm-ui
 * doesn't know which provider it's talking to.
 */

import type {
  AIProvider,
  AIMetrics,
  MapInput,
  MapResult,
  ExtractInput,
  ExtractResult,
} from "@eq/ai";

function metrics(): AIMetrics {
  return {
    provider: "mock",
    model: "mock-identity",
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 0,
    success: true,
    retried: false,
    startedAt: new Date().toISOString(),
  };
}

/**
 * Returns a mock AI that:
 *   - For map(): tries to match source columns to canonical fields by exact
 *     name OR by checking the target schema's x-eq-source-aliases. Falls back
 *     to null (no mapping) when nothing matches.
 *   - For extract(): unsupported in v1 — the demo doesn't exercise the vision
 *     path yet.
 */
export function makeMockAi(): AIProvider {
  return {
    async map(input: MapInput): Promise<MapResult> {
      // Simulate a network delay so the user sees the "matching columns…" state
      await new Promise((r) => setTimeout(r, 600));

      const props = (input.targetSchema.properties ?? {}) as Record<
        string,
        { "x-eq-source-aliases"?: string[] }
      >;

      // Build a reverse-lookup: every recognised name → canonical field
      const recognised = new Map<string, string>();
      for (const [canonical, schema] of Object.entries(props)) {
        recognised.set(normalise(canonical), canonical);
        for (const alias of schema["x-eq-source-aliases"] ?? []) {
          recognised.set(normalise(alias), canonical);
        }
      }

      const mappings = input.sourceColumns.map((col) => {
        const hit = recognised.get(normalise(col));
        if (hit) {
          return {
            sourceColumn: col,
            canonicalField: hit,
            confidence: hit === col ? 0.95 : 0.85,
            reason: hit === col ? "exact match" : "alias match",
          };
        }
        return {
          sourceColumn: col,
          canonicalField: null,
          confidence: 0,
          reason: "no recognised alias",
        };
      });

      return {
        mappings,
        unmappedRequiredFields: [],
        warnings: [],
        suggestions: [],
        needsClarification: [],
        metrics: metrics(),
      };
    },

    async extract(input: ExtractInput): Promise<ExtractResult> {
      // Simulate vision latency so the spinner is visible
      await new Promise((r) => setTimeout(r, 800));

      // Return a canned canonical record. Real Claude Vision would do the
      // actual extraction — this exists so the demo's photo / PDF flow runs
      // end-to-end without an API key.
      const props = (input.targetSchema.properties ?? {}) as Record<string, unknown>;
      const canned: Record<string, unknown> = {};
      const confidence: Record<string, number> = {};

      // Fill in plausible values per declared field
      for (const fieldName of Object.keys(props)) {
        const v = sampleFor(fieldName);
        if (v !== undefined) {
          canned[fieldName] = v;
          confidence[fieldName] = 0.88;
        }
      }

      return {
        extracted: canned,
        fieldConfidence: confidence,
        rawText:
          "Mock vision output — replace MockAi with AnthropicProvider to see real extraction. " +
          "This canned record demonstrates the photo → ParsedSheet → validate → commit flow end-to-end.",
        uncertainFields: [],
        illegibleRegions: [],
        warnings: [],
        metadata: {
          estimatedPages: 1,
          estimatedCaptureMethod: "photo",
          appearsSigned: false,
          appearsComplete: true,
        },
        metrics: metrics(),
      };
    },
  };
}

/** Plausible mock value for a given canonical field name. */
function sampleFor(field: string): unknown {
  switch (field) {
    case "first_name":
      return "James";
    case "last_name":
      return "Patel";
    case "email":
      return "james.patel@example.com.au";
    case "phone":
      return "+61412345678";
    case "employment_type":
      return "employee";
    case "trade":
      return "electrical";
    case "start_date":
      return "2022-03-01";
    case "active":
      return true;
    default:
      return undefined;
  }
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
