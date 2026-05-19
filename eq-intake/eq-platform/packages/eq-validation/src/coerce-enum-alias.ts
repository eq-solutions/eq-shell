/**
 * @eq/validation — enum alias coercer
 *
 * Resolves a value against an enum + its x-eq-enum-aliases map, with
 * case-insensitive, punctuation-insensitive matching.
 *
 * Example schema fragment:
 *   "employment_type": {
 *     "enum": ["employee", "subcontractor", "labour_hire", "casual", "apprentice"],
 *     "x-eq-enum-aliases": {
 *       "employee": ["full-time", "ft", "permanent", "perm"],
 *       "subcontractor": ["sub", "subbie", "contractor"],
 *       "labour_hire": ["agency", "labourer", "labour hire"]
 *     }
 *   }
 *
 * Input "FT" → matches alias for "employee" → returns "employee".
 * Input "fulltime" → matches "full-time" alias (after normalising) → "employee".
 * Input "freelancer" → no match → enum_unrecognised.
 */

import { CoerceOptions, CoerceResult, ok, err } from './types';

interface EnumOpts extends Partial<CoerceOptions> {
  /** The enum values from the schema */
  allowed: string[];
  /** The x-eq-enum-aliases map from the schema */
  aliases?: Record<string, string[]>;
}

/** Normalise: lowercase, strip non-alphanumeric */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function coerceEnumAlias(
  value: unknown,
  opts: EnumOpts
): CoerceResult<string | null> {
  if (value === null || value === undefined) {
    if (opts.strict) return err('value_null_or_empty', 'Empty enum value.');
    return ok(null, true, 'empty cell');
  }

  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return err('enum_unrecognised', `Cannot coerce ${typeof value} to enum.`);
  }

  const raw = String(value).trim();
  if (raw === '') {
    if (opts.strict) return err('value_null_or_empty', 'Empty enum value.');
    return ok(null, true);
  }

  const target = normalise(raw);

  // Direct match against canonical values
  for (const allowed of opts.allowed) {
    if (normalise(allowed) === target) {
      return ok(allowed, allowed !== raw);
    }
  }

  // Match against aliases
  if (opts.aliases) {
    for (const [canonical, aliasList] of Object.entries(opts.aliases)) {
      if (!opts.allowed.includes(canonical)) continue;
      for (const alias of aliasList) {
        if (normalise(alias) === target) {
          return ok(canonical, true);
        }
      }
    }
  }

  return err(
    'enum_unrecognised',
    `"${value}" is not a recognised value. Allowed: ${opts.allowed.join(', ')}.`
  );
}
