import { describe, it, expect } from "vitest";
import { coerceDate } from "../src/coerce-date.js";
import type { Locale } from "../src/types.js";
import { loadFixture, parseExpected } from "./_helpers.js";

describe("coerceDate (fixture-driven)", async () => {
  const cases = await loadFixture("dates-test-cases.csv");

  for (const row of cases) {
    const input = row["input"] ?? "";
    const localeRaw = row["locale"] ?? "";
    const expected = parseExpected(row["expected"] ?? "");
    const note = row["note"] ?? "";

    // The strict "ambiguous" cases pass an empty locale to force ambiguity
    // detection; treat that as an explicit-ambiguity test.
    const locale = (localeRaw || "en-AU") as Locale;
    const strict = localeRaw === "";

    const label = `[${input}] (${localeRaw || "no-locale"}) — ${note}`;

    it(label, () => {
      const result = coerceDate(input, { locale, strict });

      switch (expected.kind) {
        case "empty":
        case "null":
          // Empty input is an empty/null case — coercer returns
          // value_null_or_empty (treated as success-with-null in some pipelines).
          // We accept either an error of that code, or ok with empty value.
          if (result.ok) {
            expect(result.value === "" || result.value === null || result.value === undefined).toBe(true);
          } else {
            expect(result.error).toBe("value_null_or_empty");
          }
          break;
        case "error":
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error).toBe(expected.code);
          }
          break;
        case "value":
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value).toBe(expected.value);
          }
          break;
      }
    });
  }
});

describe("coerceDate — regression tests added 2026-05-19 (overnight review)", () => {
  it("rejects 'Feb 30 2026' instead of silently rolling to March 2 (was a bug)", () => {
    const r = coerceDate("Feb 30 2026", { locale: "en-AU" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("date_unparseable");
  });

  it("parses '01/05/2026 12:34' as AU (May 1), not US (Jan 5) — strips time + respects locale", () => {
    const r = coerceDate("01/05/2026 12:34", { locale: "en-AU" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("2026-05-01");
  });

  it("parses '28-04-2026 09:00:00' as AU after stripping time", () => {
    const r = coerceDate("28-04-2026 09:00:00", { locale: "en-AU" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("2026-04-28");
  });

  it("accepts valid leap-year 2024-02-29 (was incorrectly listed as a bug in iter-2 fuzz; never broken)", () => {
    const r = coerceDate("2024-02-29", { locale: "en-AU" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("2024-02-29");
  });

  it("rejects invalid 2026-02-29 (not a leap year)", () => {
    const r = coerceDate("2026-02-29", { locale: "en-AU" });
    expect(r.ok).toBe(false);
  });

  it("still accepts native-parsable forms that don't overflow (e.g. 'Wed, 01 May 2026')", () => {
    const r = coerceDate("Wed, 01 May 2026", { locale: "en-AU" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("2026-05-01");
  });
});
