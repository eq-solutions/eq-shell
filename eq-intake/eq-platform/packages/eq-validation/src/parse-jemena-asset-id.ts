/**
 * parse-jemena-asset-id.ts — recognise and extract Jemena's `JM######`
 * asset identifiers from free-text fields.
 *
 * Background: Jemena's RCD workbooks key boards by their internal
 * `JM######` asset id (e.g. `JM003534` = Cardiff DB-1). Per-circuit
 * sub-asset ids are different — bare 5–6 digit numbers like `30248` —
 * see `parse-jemena-asset-id.test.ts` for the boundary cases.
 *
 * The import flow uses these to resolve `assets.jemena_asset_id` (per
 * migration 0066) without polluting `assets.external_id` (which is reserved
 * for Maximo).
 *
 * Pattern: `JM` (literal, case-insensitive when reading user data but
 * always emitted as upper-case) followed by 4–8 ASCII digits. We've seen
 * 6-digit IDs in production; 4–8 is permissive enough for older fleets
 * or future expansion without false positives on adjacent text.
 *
 * Pure functions — no DB access, no logging side effects.
 */

const JEMENA_ID_RE = /\bJM(\d{4,8})\b/i;
const JEMENA_ID_GLOBAL_RE = /\bJM(\d{4,8})\b/gi;

/** Canonical form: uppercase `JM` + zero-padded digit string. */
function canon(digits: string): string {
  return "JM" + digits;
}

/**
 * True when the trimmed input is exactly a Jemena asset id (no
 * surrounding text). Use as a strict whole-string check.
 */
export function isJemenaAssetId(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  if (s === "") return false;
  // Anchor whole string; case-insensitive on the prefix.
  return /^JM\d{4,8}$/i.test(s);
}

/**
 * Extract the FIRST Jemena id found anywhere in the input, or null if none.
 * Useful for free-text "notes" / "description" cells where the technician
 * may have written `"Cardiff DB-1 (JM003534)"`.
 *
 * Returned id is normalised to upper-case `JM`+digits.
 */
export function extractJemenaAssetId(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  const m = s.match(JEMENA_ID_RE);
  return m && m[1] ? canon(m[1]) : null;
}

/**
 * Extract ALL Jemena ids found in the input, in source order, de-duped.
 * Empty input or no matches → empty array.
 */
export function extractAllJemenaAssetIds(raw: string | null | undefined): string[] {
  const s = (raw ?? "").trim();
  if (s === "") return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of s.matchAll(JEMENA_ID_GLOBAL_RE)) {
    if (!m[1]) continue;
    const id = canon(m[1]);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
