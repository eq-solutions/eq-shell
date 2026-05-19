/**
 * @eq/validation — Country coercer
 *
 * Maps reasonable representations of a country (full name, short form,
 * common abbreviation) to its ISO 3166-1 alpha-2 code.
 *
 * The canonical site/customer/etc. schemas store `country` as a 2-letter ISO
 * code (e.g. "AU"). Real-world exports (SimPRO especially) ship full names
 * like "Australia". Without this coercer 535/544 SimPRO site rows reject on
 * the `maxLength: 2` check — see SIMPRO-FIXTURE-SMOKE-2026-05-19.md.
 *
 * Coverage is deliberately narrow — AU contractor focus. We accept:
 *   - Canonical alpha-2 codes (AU, NZ, US, GB, ...) for the listed countries
 *   - Common full names ("Australia", "New Zealand", "United States", ...)
 *   - Common short/colloquial forms ("USA", "UK", "Aus", "NZL")
 *
 * Anything else is REJECTED rather than silently coerced — a country we don't
 * recognise should surface in confirm-UI for a human, not get stamped to "AU"
 * by default. Empty cells return null (the schema's `default: "AU"` then fills
 * in via validate.ts's default-application step).
 *
 * To extend: add the alpha-2 to CANON and its aliases to ALIASES.
 */

import { CoerceOptions, CoerceResult, ok, err } from './types';

const CANON = ['AU', 'NZ', 'US', 'GB', 'CA', 'IE', 'SG', 'PG', 'FJ'] as const;
type Country = typeof CANON[number];

const ALIASES: Record<Country, string[]> = {
  AU: ['au', 'aus', 'aust', 'australia', 'commonwealth of australia'],
  NZ: ['nz', 'nzl', 'new zealand', 'newzealand', 'aotearoa'],
  US: [
    'us',
    'usa',
    'u.s.',
    'u.s.a.',
    'united states',
    'united states of america',
    'america',
  ],
  GB: [
    'gb',
    'uk',
    'u.k.',
    'gbr',
    'united kingdom',
    'great britain',
    'britain',
    'england',
    'scotland',
    'wales',
    'northern ireland',
  ],
  CA: ['ca', 'can', 'canada'],
  IE: ['ie', 'irl', 'ireland', 'republic of ireland', 'eire'],
  SG: ['sg', 'sgp', 'singapore'],
  PG: ['pg', 'png', 'papua new guinea', 'papuanewguinea'],
  FJ: ['fj', 'fji', 'fiji'],
};

// Build a lookup table once at module load. Both the canonical code and every
// alias get keyed by their lowercase form for direct lookup.
const LOOKUP = new Map<string, Country>();
for (const country of CANON) {
  LOOKUP.set(country.toLowerCase(), country);
  for (const alias of ALIASES[country]) {
    LOOKUP.set(alias, country);
  }
}

export function coerceCountry(
  value: unknown,
  opts: Partial<CoerceOptions> = {}
): CoerceResult<Country | null> {
  if (value === null || value === undefined) {
    if (opts.strict) return err('value_null_or_empty', 'Empty country.');
    return ok(null, true, 'empty cell');
  }

  if (typeof value !== 'string') {
    return err(
      'country_unrecognised',
      `Cannot coerce ${typeof value} to country.`
    );
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    if (opts.strict) return err('value_null_or_empty', 'Empty country.');
    return ok(null, true);
  }

  // Lowercase for matching. Keep punctuation in the first pass so "U.S." hits
  // its alias entry directly; fall back to a punctuation-stripped pass for
  // inputs like "U-S-A" or "United  States" with weird whitespace.
  const key = trimmed.toLowerCase();
  const looseKey = key.replace(/[^a-z0-9]/g, '');

  if (LOOKUP.has(key)) {
    const matched = LOOKUP.get(key)!;
    return ok(matched, matched !== trimmed);
  }

  for (const [alias, country] of LOOKUP.entries()) {
    if (alias.replace(/[^a-z0-9]/g, '') === looseKey) {
      return ok(country, true);
    }
  }

  return err(
    'country_unrecognised',
    `"${value}" is not a recognised country. Expected ISO 3166-1 alpha-2 code (AU/NZ/US/GB/...) or full name.`
  );
}
