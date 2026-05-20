import { describe, it, expect } from "vitest";
import {
  FREQUENCY_SUFFIX_MAP,
  mapFrequencySuffix,
  knownFrequencySuffixes,
  type FrequencyEnum,
} from "../src/parse-frequency-suffix";

describe("FREQUENCY_SUFFIX_MAP", () => {
  it("maps the Delta-canonical letters", () => {
    expect(FREQUENCY_SUFFIX_MAP.A).toBe("annual");
    expect(FREQUENCY_SUFFIX_MAP.Q).toBe("quarterly");
    expect(FREQUENCY_SUFFIX_MAP.M).toBe("monthly");
    expect(FREQUENCY_SUFFIX_MAP.S).toBe("semi_annual");
    expect(FREQUENCY_SUFFIX_MAP.W).toBe("weekly");
  });

  it("maps the multi-year numeric aliases", () => {
    expect(FREQUENCY_SUFFIX_MAP["2"]).toBe("2yr");
    expect(FREQUENCY_SUFFIX_MAP["5"]).toBe("5yr");
    expect(FREQUENCY_SUFFIX_MAP["10"]).toBe("10yr");
  });

  it("maps numeric monthly aliases to their letter equivalents", () => {
    expect(FREQUENCY_SUFFIX_MAP["3"]).toBe("quarterly");
    expect(FREQUENCY_SUFFIX_MAP["6"]).toBe("semi_annual");
  });

  it("is frozen — guards against accidental mutation by consumers", () => {
    expect(Object.isFrozen(FREQUENCY_SUFFIX_MAP)).toBe(true);
  });
});

describe("mapFrequencySuffix", () => {
  const cases: Array<[string | null | undefined, FrequencyEnum | null]> = [
    ["A", "annual"],
    ["a", "annual"],
    [" A ", "annual"],
    ["Q", "quarterly"],
    ["3", "quarterly"],
    ["S", "semi_annual"],
    ["6", "semi_annual"],
    ["W", "weekly"],
    ["M", "monthly"],
    ["2", "2yr"],
    ["5", "5yr"],
    ["10", "10yr"],
    ["", null],
    [null, null],
    [undefined, null],
    [" ", null],
    ["X", null],
    ["weekly", null], // not a suffix
    ["A-Q", null],
    ["7", null], // 7yr not yet a Delta convention
    ["3yr", null], // canonical enum value, not a suffix
  ];

  for (const [input, expected] of cases) {
    it(`maps ${JSON.stringify(input)} → ${expected}`, () => {
      expect(mapFrequencySuffix(input)).toBe(expected);
    });
  }
});

describe("knownFrequencySuffixes", () => {
  it("returns suffixes sorted for snapshot-stable assertions", () => {
    const out = knownFrequencySuffixes();
    expect(out).toEqual(["10", "2", "3", "5", "6", "A", "M", "Q", "S", "W"]);
  });

  it("includes every key in the map", () => {
    const fromMap = Object.keys(FREQUENCY_SUFFIX_MAP).sort();
    expect(knownFrequencySuffixes()).toEqual(fromMap);
  });
});
