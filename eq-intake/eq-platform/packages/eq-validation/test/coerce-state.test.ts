import { describe, it, expect } from "vitest";
import { coerceAuState } from "../src/coerce-au-state.js";
import { loadFixture, parseExpected } from "./_helpers.js";

describe("coerceAuState (fixture-driven)", async () => {
  const cases = await loadFixture("states-test-cases.csv");

  for (const row of cases) {
    const input = row["input"] ?? "";
    const expected = parseExpected(row["expected"] ?? "");
    const note = row["note"] ?? "";
    const label = `[${JSON.stringify(input)}] — ${note}`;

    it(label, () => {
      const result = coerceAuState(input, { locale: "en-AU" });

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
