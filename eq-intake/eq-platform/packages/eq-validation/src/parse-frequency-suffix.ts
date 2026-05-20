/**
 * parse-frequency-suffix.ts — map Delta/Maximo frequency suffix letters
 * to EQ canonical frequency enum values.
 *
 * Ported from eq-solves-service/lib/import/delta-wo-parser.ts (the source
 * of truth for the SKS work-order import flow) into @eq/validation so any
 * downstream importer can reuse the same map.
 *
 * Frequency suffix conventions (Delta / Equinix Maximo):
 *   A   → annual
 *   Q   → quarterly      (also "3" = every 3 months)
 *   M   → monthly
 *   S   → semi_annual    (also "6" = every 6 months)
 *   W   → weekly
 *   2   → 2yr
 *   5   → 5yr
 *   10  → 10yr
 *
 * Unknown suffixes return null. Importers must fail-closed (no default
 * guess) so an unrecognised code surfaces a per-row warning rather than
 * being silently mapped to the wrong frequency.
 */

export type FrequencyEnum =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semi_annual"
  | "annual"
  | "2yr"
  | "3yr"
  | "5yr"
  | "8yr"
  | "10yr";

/**
 * Source-of-truth map. Keys are upper-cased — `mapFrequencySuffix` upper-
 * cases the input before lookup so callers can pass either case.
 *
 * Note that 3yr and 8yr have no canonical Delta suffix today — they exist
 * in the EQ enum because contract scopes carry them (see `maintenance_plan`
 * + `contract_scope` schemas), but Equinix Maximo doesn't emit them via the
 * work-order route. If a future Delta export starts using "8" for 8yr it
 * can be added here alongside an integration-level note.
 */
export const FREQUENCY_SUFFIX_MAP: Readonly<Record<string, FrequencyEnum>> = Object.freeze({
  A: "annual",
  Q: "quarterly",
  "3": "quarterly",
  M: "monthly",
  S: "semi_annual",
  "6": "semi_annual",
  W: "weekly",
  "2": "2yr",
  "5": "5yr",
  "10": "10yr",
});

/**
 * Map a frequency suffix to its EQ frequency enum value. Returns null for
 * unknown suffixes — callers must fail-closed per the Delta WO import spec.
 *
 * Trims + upper-cases input so callers can pass `"a"`, `" A"`, `"A "`
 * uniformly.
 */
export function mapFrequencySuffix(suffix: string | null | undefined): FrequencyEnum | null {
  const key = (suffix ?? "").trim().toUpperCase();
  if (key === "") return null;
  return FREQUENCY_SUFFIX_MAP[key] ?? null;
}

/** All suffixes the map currently recognises. Stable for snapshot testing. */
export function knownFrequencySuffixes(): string[] {
  return Object.keys(FREQUENCY_SUFFIX_MAP).sort();
}
