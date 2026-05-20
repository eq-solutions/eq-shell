/**
 * parse-job-plan-code.ts — split Delta-style job plan codes into the
 * canonical code part + the frequency-suffix part.
 *
 * Ported from eq-solves-service/lib/import/delta-wo-parser.ts. Delta /
 * Equinix Maximo job-plan codes encode the frequency as a trailing
 * "-X" suffix:
 *
 *   "LVACB-A"   → { code: "LVACB",   suffix: "A"  }   (annual)
 *   "ATS-3"     → { code: "ATS",     suffix: "3"  }   (quarterly)
 *   "M10.13-A"  → { code: "M10.13",  suffix: "A"  }   (annual, hierarchical code)
 *   "RCD-S"     → { code: "RCD",     suffix: "S"  }   (semi-annual)
 *
 * Split happens on the LAST dash so codes that themselves contain dashes
 * (rare but legal) are preserved.
 *
 * Input without a dash returns `{ code: trimmed, suffix: "" }`. Callers
 * should check `suffix === ""` if they want to treat suffix-less codes
 * as a hard error rather than a warning.
 */

export interface JobPlanCodeParts {
  /** The portion before the last dash — matches `maintenance_plan.code`. */
  code: string;
  /** The portion after the last dash — feed to `mapFrequencySuffix`. */
  suffix: string;
}

/**
 * Split a job plan code on its last dash. Trims input; returns trimmed
 * parts. Empty / nullish input returns `{ code: "", suffix: "" }`.
 */
export function splitJobPlanCode(raw: string | null | undefined): JobPlanCodeParts {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { code: "", suffix: "" };
  const idx = trimmed.lastIndexOf("-");
  if (idx === -1) return { code: trimmed, suffix: "" };
  return {
    code: trimmed.slice(0, idx).trim(),
    suffix: trimmed.slice(idx + 1).trim(),
  };
}
