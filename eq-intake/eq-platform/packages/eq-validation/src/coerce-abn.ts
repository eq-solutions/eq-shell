/**
 * @eq/validation — ABN coercer
 *
 * Validates and normalises Australian Business Numbers (ABN).
 *
 * Algorithm (ATO spec):
 *   1. Subtract 1 from the first digit.
 *   2. Multiply each of the 11 digits by its weight:
 *      [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
 *   3. Sum the products. If sum mod 89 === 0, the ABN is valid.
 *
 * Normalises:
 *   - Strips spaces, hyphens, dots (common formatting)
 *   - Outputs in standard display form: "XX XXX XXX XXX"
 *
 * Contract:
 *   - Null / undefined / empty → ok('', false) — ABN is optional on most entities
 *   - Invalid format (not 11 digits) → err('abn_invalid')
 *   - Invalid checksum → err('abn_invalid')
 *   - Already valid → ok(normalised, transformed) where transformed=true if
 *     spacing/formatting was changed
 */

import { CoerceOptions, CoerceResult, ok, err } from './types';

const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

function validateChecksum(digits: number[]): boolean {
  const adjusted = [digits[0]! - 1, ...digits.slice(1)];
  const sum = adjusted.reduce((acc, d, i) => acc + d * WEIGHTS[i]!, 0);
  return sum % 89 === 0;
}

function toDisplayForm(digits: string): string {
  // Standard form: XX XXX XXX XXX
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}`;
}

export function coerceAbn(
  value: unknown,
  opts: Partial<CoerceOptions> = {},
): CoerceResult<string> {
  if (value === null || value === undefined || value === '') {
    if (opts.strict) return err('value_null_or_empty', 'ABN is required.');
    return ok('', false);
  }

  const raw = String(value).trim();
  if (raw === '') {
    if (opts.strict) return err('value_null_or_empty', 'ABN is required.');
    return ok('', false);
  }

  // Strip common formatting characters
  const stripped = raw.replace(/[\s\-.]/g, '');

  if (!/^\d{11}$/.test(stripped)) {
    return err(
      'abn_invalid',
      `"${raw}" is not a valid ABN — must be 11 digits (got ${stripped.replace(/\D/g, '').length} digits).`,
    );
  }

  const digits = stripped.split('').map(Number);

  if (!validateChecksum(digits)) {
    return err(
      'abn_invalid',
      `"${raw}" is not a valid ABN — checksum failed. Check for a transcription error.`,
    );
  }

  const canonical = toDisplayForm(stripped);
  const transformed = canonical !== raw;

  return ok(canonical, transformed);
}
