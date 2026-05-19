/**
 * @eq/validation — FK resolver
 *
 * Resolves a value (UUID, name, code, external_id, etc) to a canonical foreign-key UUID.
 *
 * Resolution order:
 *   1. If value parses as a UUID, look up by primary key. exact_id.
 *   2. Look up by each fuzzyField (e.g. site.name, site.code, site.external_id) for a
 *      case-insensitive exact match. exact_match.
 *   3. Fuzzy match (Jaro-Winkler) against all values in fuzzyFields for this tenant.
 *      Return top N candidates above threshold. fuzzy_matches.
 *   4. no_match.
 *
 * The `lookup` function is injected — typically backed by a Supabase query in production,
 * or an in-memory map in tests. This keeps the validator package free of DB deps.
 */

export type FkResolution =
  | { kind: 'exact_id'; id: string }
  | { kind: 'exact_match'; id: string; matched_on: string; matched_value: string }
  | { kind: 'fuzzy_matches'; candidates: FkCandidate[] }
  | { kind: 'no_match' };

export interface FkCandidate {
  id: string;
  score: number;
  matched_on: string;
  matched_value: string;
}

export interface FkLookupRow {
  id: string;
  /** Map of fuzzy field name → its current value (e.g. { name: "Equinix SY3", code: "SY3" }) */
  fields: Record<string, string | null>;
}

export interface FkLookup {
  /** Returns all rows of the target entity for a tenant. Implementation may cache. */
  list(entity: string, tenantId: string): Promise<FkLookupRow[]>;
  /** Returns a single row by primary key id, or null. */
  byId(entity: string, tenantId: string, id: string): Promise<FkLookupRow | null>;
}

interface ResolveOpts {
  entity: string;
  tenantId: string;
  rawValue: unknown;
  fuzzyFields: string[];
  threshold: number;        // 0-1, e.g. 0.85
  maxCandidates?: number;   // default 5
  lookup: FkLookup;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveFk(opts: ResolveOpts): Promise<FkResolution> {
  const { entity, tenantId, rawValue, fuzzyFields, threshold, lookup } = opts;
  const maxCandidates = opts.maxCandidates ?? 5;

  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return { kind: 'no_match' };
  }

  const raw = String(rawValue).trim();
  const rawLower = raw.toLowerCase();

  // 1. UUID exact id
  if (UUID_RE.test(raw)) {
    const row = await lookup.byId(entity, tenantId, raw);
    if (row) return { kind: 'exact_id', id: row.id };
  }

  // 2 + 3 require the full list — fetch once
  const all = await lookup.list(entity, tenantId);

  // 2. Exact case-insensitive match on each fuzzy field
  for (const field of fuzzyFields) {
    for (const row of all) {
      const v = row.fields[field];
      if (v != null && v.trim().toLowerCase() === rawLower) {
        return {
          kind: 'exact_match',
          id: row.id,
          matched_on: field,
          matched_value: v,
        };
      }
    }
  }

  // 3. Fuzzy match across all fuzzy field values
  const candidates: FkCandidate[] = [];
  for (const row of all) {
    let bestScore = 0;
    let bestField = '';
    let bestValue = '';
    for (const field of fuzzyFields) {
      const v = row.fields[field];
      if (v == null || v.trim() === '') continue;
      const score = jaroWinkler(rawLower, v.toLowerCase().trim());
      if (score > bestScore) {
        bestScore = score;
        bestField = field;
        bestValue = v;
      }
    }
    if (bestScore >= threshold) {
      candidates.push({
        id: row.id,
        score: bestScore,
        matched_on: bestField,
        matched_value: bestValue,
      });
    }
  }

  if (candidates.length === 0) return { kind: 'no_match' };

  candidates.sort((a, b) => b.score - a.score);
  return { kind: 'fuzzy_matches', candidates: candidates.slice(0, maxCandidates) };
}

// ============================================================================
// Jaro-Winkler distance — string similarity
// Reference: https://en.wikipedia.org/wiki/Jaro%E2%80%93Winkler_distance
// Returns 0 (no similarity) to 1 (exact match).
// ============================================================================

export function jaroWinkler(s1: string, s2: string, prefixScale = 0.1): number {
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / s1.length +
      matches / s2.length +
      (matches - transpositions / 2) / matches) / 3;

  // Winkler: bonus for common prefix up to 4 chars
  let prefixLen = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefixLen++;
    else break;
  }

  return jaro + prefixLen * prefixScale * (1 - jaro);
}
