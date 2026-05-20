import { describe, it, expect } from "vitest";
import { stripSitePrefix, hasMaximoSitePrefix } from "../src/parse-site-prefix";

describe("stripSitePrefix", () => {
  it("strips the AU0x- prefix from canonical Equinix codes", () => {
    expect(stripSitePrefix("AU01-SY3")).toBe("SY3");
    expect(stripSitePrefix("AU01-CA1")).toBe("CA1");
    expect(stripSitePrefix("AU02-SY9")).toBe("SY9");
    expect(stripSitePrefix("AU09-SY1")).toBe("SY1");
  });

  it("returns the trimmed input unchanged when no prefix matches", () => {
    expect(stripSitePrefix("SY1")).toBe("SY1");
    expect(stripSitePrefix("Cardiff DB-1")).toBe("Cardiff DB-1");
    expect(stripSitePrefix("US01-NYC")).toBe("US01-NYC"); // only AU is canonical
  });

  it("trims whitespace", () => {
    expect(stripSitePrefix(" AU01-SY3 ")).toBe("SY3");
    expect(stripSitePrefix("\tAU01-SY3\n")).toBe("SY3");
  });

  it("only strips a single prefix at the start", () => {
    expect(stripSitePrefix("AU01-AU02-SY3")).toBe("AU02-SY3");
  });

  it("returns empty for empty / nullish input", () => {
    expect(stripSitePrefix("")).toBe("");
    expect(stripSitePrefix(null)).toBe("");
    expect(stripSitePrefix(undefined)).toBe("");
  });

  it("doesn't strip a partial match", () => {
    // Not the prefix pattern — must be AU + exactly 2 digits + dash.
    expect(stripSitePrefix("AU1-SY3")).toBe("AU1-SY3");
    expect(stripSitePrefix("AUSY3")).toBe("AUSY3");
    expect(stripSitePrefix("AU-SY3")).toBe("AU-SY3");
  });
});

describe("hasMaximoSitePrefix", () => {
  it("identifies prefixes without mutating", () => {
    expect(hasMaximoSitePrefix("AU01-SY3")).toBe(true);
    expect(hasMaximoSitePrefix("AU99-FOO")).toBe(true);
    expect(hasMaximoSitePrefix("SY3")).toBe(false);
    expect(hasMaximoSitePrefix("")).toBe(false);
    expect(hasMaximoSitePrefix(null)).toBe(false);
  });
});
