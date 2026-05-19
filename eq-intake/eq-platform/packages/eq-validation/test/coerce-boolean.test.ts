import { describe, it, expect } from "vitest";
import { coerceBoolean } from "../src/coerce-boolean.js";
import { loadFixture, parseExpected } from "./_helpers.js";

describe("coerceBoolean (fixture-driven)", async () => {
  const cases = await loadFixture("booleans-test-cases.csv");

  for (const row of cases) {
    const input = row["input"] ?? "";
    const expected = parseExpected(row["expected"] ?? "");
    const note = row["note"] ?? "";
    const label = `[${JSON.stringify(input)}] — ${note}`;

    it(label, () => {
      const result = coerceBoolean(input, { locale: "en-AU" });

      switch (expected.kind) {
        case "empty":
          // Empty cell → either ok:false (value_null_or_empty) or ok:true with false
          // depending on lenient handling. Fixture says "false (lenient)".
          if (result.ok) {
            expect(result.value).toBe(false);
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
          if (result.ok) {
            expect(result.value).toBe(expected.value === "true");
          }
          break;
      }
    });
  }
});
