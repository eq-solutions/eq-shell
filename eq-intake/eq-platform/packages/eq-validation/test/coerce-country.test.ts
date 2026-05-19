import { describe, it, expect } from "vitest";
import { coerceCountry } from "../src/coerce-country.js";
import { loadFixture, parseExpected } from "./_helpers.js";

describe("coerceCountry (fixture-driven)", async () => {
  const cases = await loadFixture("countries-test-cases.csv");

  for (const row of cases) {
    const input = row["input"] ?? "";
    const expected = parseExpected(row["expected"] ?? "");
    const note = row["note"] ?? "";
    const label = `[${JSON.stringify(input)}] — ${note}`;

    it(label, () => {
      const result = coerceCountry(input, { locale: "en-AU" });

      switch (expected.kind) {
        case "empty":
        case "null":
          if (result.ok) {
            expect(result.value === "" || result.value === null || result.value === undefined).toBe(true);
          } else {
            expect(result.error).toBe("value_null_or_empty");
          }
          break;
        case "error":
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error).toBe(expected.code);
          break;
        case "value":
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.value).toBe(expected.value);
          break;
      }
    });
  }
});

describe("coerceCountry (direct)", () => {
  it("returns null for undefined non-strict", () => {
    const r = coerceCountry(undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it("rejects undefined in strict mode", () => {
    const r = coerceCountry(undefined, { strict: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("value_null_or_empty");
  });

  it("rejects non-string types", () => {
    const r = coerceCountry(123 as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("country_unrecognised");
  });

  it("marks transformed=true when input differs from canonical", () => {
    const r = coerceCountry("Australia");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("AU");
      expect(r.transformed).toBe(true);
    }
  });

  it("marks transformed=false when input already canonical", () => {
    const r = coerceCountry("AU");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("AU");
      expect(r.transformed).toBe(false);
    }
  });
});
