/**
 * @eq/validation — AU phone coercer
 *
 * Converts AU phone numbers to E.164 (+614xxxxxxxx for mobile, +612xxxxxxxx etc for landlines).
 * International numbers (already +) are kept verbatim if the digit count is plausible.
 *
 * Contract:
 * - Default: STRICT. Unrecognised formats return ok:false so the caller can
 *   trust the ok flag without consulting notes. This is the no-silent-drops
 *   posture — every input either resolves to a valid recognised shape or
 *   surfaces as an error.
 * - opts.permissive: true → unrecognised formats are kept raw with a
 *   `phone_format_unrecognised_kept_raw` note. Use this when the caller is
 *   a confirm-UI that wants to show the user the raw value alongside a flag.
 *
 * Strips before processing:
 * - Whitespace
 * - Brackets ()
 * - Hyphens, dots, slashes
 * - Leading "ph:", "tel:", "mob:" prefixes
 *
 * Recognised AU patterns:
 * - 04xxxxxxxx (10 digits) → +614xxxxxxxx (mobile)
 * - 614xxxxxxxx (11 digits, no +) → +614xxxxxxxx
 * - 0Nxxxxxxxx where N in [2,3,7,8] (10 digits) → +61Nxxxxxxxx (landline)
 * - 1300xxxxxx, 1800xxxxxx, 13xxxx → kept as-is (no E.164 form for these)
 *
 * Recognised international:
 * - +<country><number> → kept verbatim if 8-15 digits total
 */

import { CoerceOptions, CoerceResult, ok, err } from './types';

interface PhoneOpts extends Partial<CoerceOptions> {
  /**
   * When true, unrecognised formats are kept raw with a note instead of
   * being rejected. Use for confirm-UI flows that want to surface the value
   * for the user to fix manually. Default: false (strict).
   */
  permissive?: boolean;
}

const STRIP_CHARS = /[\s().\-/]/g;
const PREFIX_STRIP = /^(ph|tel|mob|mobile|phone|cell):\s*/i;

function unrecognised(
  rawValue: string,
  permissive: boolean,
): CoerceResult<string> {
  if (permissive) {
    return ok(rawValue, false, 'phone_format_unrecognised_kept_raw');
  }
  return err(
    'phone_unrecognised',
    `Phone "${rawValue}" not in a recognised AU or international format.`,
  );
}

export function coercePhoneAU(
  value: unknown,
  opts: PhoneOpts = {}
): CoerceResult<string> {
  const permissive = opts.permissive === true;

  // Null / undefined / empty — pass through (phones are almost always optional)
  if (value === null || value === undefined) {
    if (opts.strict) {
      return err('value_null_or_empty', 'Empty phone in strict mode.');
    }
    return ok('', true, 'empty cell');
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return err('phone_unrecognised', `Cannot coerce ${typeof value} to phone.`);
  }

  let raw = String(value).trim();
  if (raw === '') {
    if (opts.strict) return err('value_null_or_empty', 'Empty phone.');
    return ok('', true);
  }

  // Strip prefix labels
  raw = raw.replace(PREFIX_STRIP, '');

  // Capture original for fallback
  const original = raw;

  // Strip formatting chars
  let stripped = raw.replace(STRIP_CHARS, '');

  // Already E.164?
  if (stripped.startsWith('+')) {
    const digits = stripped.slice(1);
    if (/^\d{8,15}$/.test(digits)) {
      return ok(stripped, stripped !== original.replace(STRIP_CHARS, ''));
    }
    return unrecognised(original, permissive);
  }

  // 614... → +614...
  if (/^614\d{8}$/.test(stripped)) {
    return ok(`+${stripped}`, true);
  }

  // 04xxxxxxxx → +614xxxxxxxx (AU mobile)
  if (/^04\d{8}$/.test(stripped)) {
    return ok(`+61${stripped.slice(1)}`, true);
  }

  // 0[2378]xxxxxxxx → +61[2378]xxxxxxxx (AU landline)
  if (/^0[2378]\d{8}$/.test(stripped)) {
    return ok(`+61${stripped.slice(1)}`, true);
  }

  // 13xxxx, 1300xxxxxx, 1800xxxxxx — AU service numbers, keep as-is
  if (/^(13\d{4}|1[38]00\d{6})$/.test(stripped)) {
    return ok(stripped, stripped !== original);
  }

  // Plausible international without + (8-15 digits) — still unrecognised because
  // we can't infer the country code. Permissive mode keeps it raw with a flag.
  // Anything else — same treatment.
  return unrecognised(original, permissive);
}
