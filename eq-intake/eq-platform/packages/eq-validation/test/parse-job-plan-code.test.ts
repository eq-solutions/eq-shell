import { describe, it, expect } from "vitest";
import { splitJobPlanCode } from "../src/parse-job-plan-code";

describe("splitJobPlanCode", () => {
  it("splits the canonical LVACB-A on the last dash", () => {
    expect(splitJobPlanCode("LVACB-A")).toEqual({ code: "LVACB", suffix: "A" });
  });

  it("handles numeric suffixes (Delta short-form)", () => {
    expect(splitJobPlanCode("ATS-3")).toEqual({ code: "ATS", suffix: "3" });
    expect(splitJobPlanCode("LVACB-2")).toEqual({ code: "LVACB", suffix: "2" });
    expect(splitJobPlanCode("LVACB-10")).toEqual({ code: "LVACB", suffix: "10" });
  });

  it("preserves hierarchical codes that themselves contain dots", () => {
    expect(splitJobPlanCode("M10.13-A")).toEqual({ code: "M10.13", suffix: "A" });
    expect(splitJobPlanCode("E1.25-Q")).toEqual({ code: "E1.25", suffix: "Q" });
  });

  it("preserves codes with embedded dashes — splits on the LAST dash only", () => {
    expect(splitJobPlanCode("LV-ACB-A")).toEqual({ code: "LV-ACB", suffix: "A" });
    expect(splitJobPlanCode("M-10-13-A")).toEqual({ code: "M-10-13", suffix: "A" });
  });

  it("returns the whole input as code when no dash is present", () => {
    expect(splitJobPlanCode("LVACB")).toEqual({ code: "LVACB", suffix: "" });
  });

  it("trims surrounding whitespace on both parts", () => {
    expect(splitJobPlanCode(" LVACB - A ")).toEqual({ code: "LVACB", suffix: "A" });
    expect(splitJobPlanCode("  LVACB-A  ")).toEqual({ code: "LVACB", suffix: "A" });
  });

  it("handles trailing-dash edge case (suffix is empty string)", () => {
    expect(splitJobPlanCode("LVACB-")).toEqual({ code: "LVACB", suffix: "" });
  });

  it("handles leading-dash edge case (code is empty string)", () => {
    expect(splitJobPlanCode("-A")).toEqual({ code: "", suffix: "A" });
  });

  it("returns empty parts for empty / nullish input", () => {
    expect(splitJobPlanCode("")).toEqual({ code: "", suffix: "" });
    expect(splitJobPlanCode("   ")).toEqual({ code: "", suffix: "" });
    expect(splitJobPlanCode(null)).toEqual({ code: "", suffix: "" });
    expect(splitJobPlanCode(undefined)).toEqual({ code: "", suffix: "" });
  });
});
