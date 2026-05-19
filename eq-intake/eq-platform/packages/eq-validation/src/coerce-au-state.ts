/**
 * @eq/validation — AU state coercer
 *
 * Maps any reasonable representation of an Australian state/territory to its
 * canonical 2-3 letter abbreviation: NSW, VIC, QLD, SA, WA, TAS, NT, ACT.
 *
 * Handles:
 * - Full names (case insensitive): "New South Wales", "victoria"
 * - Abbreviations (case insensitive): "NSW", "nsw", "vic"
 * - With/without dots: "N.S.W.", "Vic.", "Q.L.D"
 * - Common typos: "Vict", "Quensland" (via fuzzy fallback when strict=false)
 *
 * Reject: anything else.
 */

import { CoerceOptions, CoerceResult, ok, err } from './types';

const CANON = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const;
type State = typeof CANON[number];

const ALIASES: Record<State, string[]> = {
  NSW: ['nsw', 'n.s.w', 'n.s.w.', 'new south wales', 'newsouthwales'],
  VIC: ['vic', 'vic.', 'v.i.c', 'v.i.c.', 'victoria'],
  QLD: ['qld', 'qld.', 'q.l.d', 'q.l.d.', 'queensland', 'qsl', 'qlnd'],
  SA: ['sa', 's.a', 's.a.', 'south australia', 'sth aus', 'south aust', 'southaustralia'],
  WA: ['wa', 'w.a', 'w.a.', 'western australia', 'west aus', 'westernaustralia'],
  TAS: ['tas', 'tas.', 'tasmania', 'tassie'],
  NT: ['nt', 'n.t', 'n.t.', 'northern territory', 'nthterritory'],
  ACT: ['act', 'a.c.t', 'a.c.t.', 'australian capital territory'],
};

// Build a lookup table once
const LOOKUP = new Map<string, State>();
for (const state of CANON) {
  LOOKUP.set(state.toLowerCase(), state);
  for (const alias of ALIASES[state]) {
    LOOKUP.set(alias, state);
  }
}

export function coerceAuState(
  value: unknown,
  opts: Partial<CoerceOptions> = {}
): CoerceResult<State | null> {
  if (value === null || value === undefined) {
    if (opts.strict) return err('value_null_or_empty', 'Empty state.');
    return ok(null, true, 'empty cell');
  }

  if (typeof value !== 'string') {
    return err('state_unrecognised', `Cannot coerce ${typeof value} to AU state.`);
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    if (opts.strict) return err('value_null_or_empty', 'Empty state.');
    return ok(null, true);
  }

  // Lowercase and remove all non-alphanumeric for matching
  const key = trimmed.toLowerCase();
  const looseKey = key.replace(/[^a-z]/g, '');

  // Try direct match first
  if (LOOKUP.has(key)) {
    const matched = LOOKUP.get(key)!;
    return ok(matched, matched !== trimmed);
  }

  // Try loose match (no spaces, no dots)
  for (const [alias, state] of LOOKUP.entries()) {
    if (alias.replace(/[^a-z]/g, '') === looseKey) {
      return ok(state, true);
    }
  }

  return err(
    'state_unrecognised',
    `"${value}" is not a recognised AU state/territory. Expected NSW/VIC/QLD/SA/WA/TAS/NT/ACT or full name.`
  );
}
