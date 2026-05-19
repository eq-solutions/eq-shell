import { describe, it, expect } from "vitest";
import { coercePhoneAU } from "../src/coerce-phone-au.js";
import { loadFixture, parseExpected } from "./_helpers.js";

describe("coercePhoneAU — permissive mode (legacy 'kept raw' behaviour)", () => {
  it("unrecognised input kept raw with note when opts.permissive: true", () => {
    const r = coercePhoneAU("abc", { permissive: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("abc");
      expect(r.note).toBe("phone_format_unrecognised_kept_raw");
    }
  });
  it("short E.164 kept raw under permissive", () => {
    const r = coercePhoneAU("+1234", { permissive: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("+1234");
      expect(r.note).toBe("phone_format_unrecognised_kept_raw");
    }
  });
  it("strict mode (default) rejects same input", () => {
    const r = coercePhoneAU("abc");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("phone_unrecognised");
  });
});

describe("coercePhoneAU (fixture-driven)", async () => {
  const cases = await loadFixture("phones-test-cases.csv");

  for (const row of cases) {
    const input = row["input"] ?? "";
    const expected = parseExpected(row["expected"] ?? "");
    const note = row["note"] ?? "";
    const label = `[${JSON.stringify(input)}] — ${note}`;

    it(label, () => {
      const result = coercePhoneAU(input, { locale: "en-AU" });

      switch (expected.kind) {
        case "empty":
          // Empty phone → ok:true with empty value, or value_null_or_empty error
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
          // Recognised phones produce a normalised E.164 string. Unrecognised
          // shapes are rejected with phone_format_unrecognised by default
          // (since 2026-05-19) — callers wanting the legacy "keep raw with
          // note" behaviour pass opts.permissive: true.
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.value).toBe(expected.value);
          break;
      }
    });
  }
});
