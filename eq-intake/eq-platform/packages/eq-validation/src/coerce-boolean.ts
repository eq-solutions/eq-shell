/**
 * @eq/validation — boolean coercer
 *
 * Handles every truthy/falsy representation seen in trade-subbie spreadsheets:
 * - Booleans: true / false
 * - Numbers: 1 / 0
 * - Strings: yes/no, y/n, true/false, t/f, x/empty, ✓/✗
 * - Status words: active/inactive, current/expired, on/off, enabled/disabled
 *
 * Anything outside this set returns boolean_unrecognised.
 *
 * Note: empty string and null/undefined return ok:true with value=false by default,
 * UNLESS strict=true, in which case they return value_null_or_empty.
 * This handles the very common pattern where a "Active?" column is just "X" or empty.
 */

import { CoerceOptions, CoerceResult, ok, err } from './types';

const TRUTHY = new Set([
  'true', 't',
  'yes', 'y',
  '1',
  'on',
  'active', 'current', 'enabled', 'live',
  'x', '✓', '✔',
]);

const FALSY = new Set([
  'false', 'f',
  'no', 'n',
  '0',
  'off',
  'inactive', 'expired', 'disabled', 'archived', 'finished', 'ended',
  '✗', '✘', '-',
]);

export function coerceBoolean(
  value: unknown,
  opts: Partial<CoerceOptions> = {}
): CoerceResult<boolean> {
  // Already a boolean
  if (typeof value === 'boolean') {
    return ok(value, false);
  }

  // Numeric
  if (typeof value === 'number') {
    if (value === 1) return ok(true, true);
    if (value === 0) return ok(false, true);
    return err(
      'boolean_unrecognised',
      `Expected 0 or 1, got numeric value ${value}.`
    );
  }

  // Null / undefined — empty cells in spreadsheets
  if (value === null || value === undefined) {
    if (opts.strict) {
      return err('value_null_or_empty', 'Empty value in strict mode.');
    }
    return ok(false, true, 'empty cell treated as false');
  }

  // String
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();

    if (trimmed === '') {
      if (opts.strict) {
        return err('value_null_or_empty', 'Empty string in strict mode.');
      }
      return ok(false, true, 'empty string treated as false');
    }

    if (TRUTHY.has(trimmed)) {
      return ok(true, true);
    }
    if (FALSY.has(trimmed)) {
      return ok(false, true);
    }

    return err(
      'boolean_unrecognised',
      `Cannot interpret "${value}" as boolean. Expected y/n, yes/no, true/false, 1/0, active/inactive, x/empty.`
    );
  }

  // Anything else (object, array, etc)
  return err(
    'boolean_unrecognised',
    `Cannot coerce ${typeof value} to boolean.`
  );
}
