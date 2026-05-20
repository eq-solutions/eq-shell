/**
 * parse-site-prefix.ts — strip the Equinix Maximo `AU0x-` prefix from a
 * site code so it matches the canonical `sites.code` value.
 *
 * Ported from eq-solves-service/lib/import/delta-wo-parser.ts.
 *
 * Equinix Maximo exports site codes as `AU01-SY3`, `AU01-CA1`, `AU02-SY9`
 * etc., where `AU0x` is the country/region prefix. EQ's `sites.code`
 * stores just the bare site (`SY3`, `CA1`, `SY9`).
 *
 * Non-matching input is returned trimmed but unchanged so callers can
 * pass already-stripped values safely.
 */

const PREFIX_RE = /^AU\d{2}-/;

/**
 * Strip `AU0x-` prefix from a Maximo-shaped site code. Returns the trimmed
 * site code without the prefix; returns the trimmed input if no prefix
 * matches.
 */
export function stripSitePrefix(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  return trimmed.replace(PREFIX_RE, "");
}

/**
 * True if `raw` matches the Maximo prefix pattern. Use to surface "this
 * looks like a Maximo site code" hints during import preview, without
 * actually mutating the value.
 */
export function hasMaximoSitePrefix(raw: string | null | undefined): boolean {
  return PREFIX_RE.test((raw ?? "").trim());
}
