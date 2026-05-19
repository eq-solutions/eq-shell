/**
 * @eq/validation — number coercer
 *
 * Handles every numeric format seen in trade-subbie spreadsheets:
 * - Plain numbers: 123, 123.45, -123.45
 * - Currency: $123.45, AUD 1,234.56, $1,234, USD 99.99, €100, £50
 * - Thousands separators: 1,234.56 (en-AU/en-US), 1.234,56 (european with locale='de')
 * - Accounting negatives: (123.45) → -123.45
 * - Percentages: 50% → 0.5, 12.5% → 0.125
 * - Hours notation: 1h 30m → 1.5 (only when opts.allowDuration)
 *
 * Empty / null returns null (most number fields are optional).
 */

import { CoerceOptions, CoerceResult, ok, err } from './types';

interface NumberOpts extends Partial<CoerceOptions> {
  /** Treat percentages as their decimal form (50% → 0.5). Default true. */
  percentAsDecimal?: boolean;
  /** Allow "1h 30m" → 1.5 conversions. Default false. */
  allowDuration?: boolean;
  /** Allow negative numbers. Default true. */
  allowNegative?: boolean;
}

const CURRENCY_SYMBOLS = /[$€£¥]|\b(AUD|USD|EUR|GBP|JPY|NZD|CAD)\b/gi;
const ACCOUNTING_NEG = /^\((.+)\)$/;
const DURATION = /^(\d+)h(?:\s*(\d+)m)?$|^(\d+)m$/i;

export function coerceNumber(
  value: unknown,
  opts: NumberOpts = {}
): CoerceResult<number | null> {
  const percentAsDecimal = opts.percentAsDecimal ?? true;
  const allowNegative = opts.allowNegative ?? true;

  // Null / undefined
  if (value === null || value === undefined) {
    if (opts.strict) {
      return err('value_null_or_empty', 'Empty value in strict mode.');
    }
    return ok(null, true, 'empty cell');
  }

  // Already a number
  if (typeof value === 'number') {
    if (!isFinite(value)) {
      return err('number_unparseable', `Non-finite number: ${value}.`);
    }
    if (!allowNegative && value < 0) {
      return err('number_unparseable', `Negative not allowed: ${value}.`);
    }
    return ok(value, false);
  }

  if (typeof value !== 'string') {
    return err('number_unparseable', `Cannot coerce ${typeof value} to number.`);
  }

  let raw = value.trim();
  if (raw === '') {
    if (opts.strict) return err('value_null_or_empty', 'Empty number.');
    return ok(null, true);
  }

  // Duration form (1h 30m)
  if (opts.allowDuration) {
    const m = raw.match(DURATION);
    if (m) {
      const hours = m[1] ? parseInt(m[1], 10) : 0;
      const mins = m[2] ? parseInt(m[2], 10) : (m[3] ? parseInt(m[3], 10) : 0);
      return ok(hours + mins / 60, true);
    }
  }

  let isPercent = false;
  if (raw.endsWith('%')) {
    isPercent = true;
    raw = raw.slice(0, -1).trim();
  }

  // Accounting negatives: (123.45) → -123.45
  let isNegative = false;
  const accMatch = raw.match(ACCOUNTING_NEG);
  if (accMatch && accMatch[1] !== undefined) {
    isNegative = true;
    raw = accMatch[1].trim();
  }

  // Strip currency symbols & codes
  raw = raw.replace(CURRENCY_SYMBOLS, '').trim();

  // Trailing/leading minus
  if (raw.startsWith('-')) {
    isNegative = !isNegative;
    raw = raw.slice(1).trim();
  } else if (raw.endsWith('-')) {
    isNegative = !isNegative;
    raw = raw.slice(0, -1).trim();
  }

  if (raw === '') {
    return err('number_unparseable', `Empty after stripping non-numeric chars from "${value}".`);
  }

  // Determine separator convention
  // - en-AU / en-US: comma = thousands, dot = decimal
  // - en-GB: same as AU/US
  // For now we assume en-AU / en-US convention (per the userPreferences).
  // If both . and , present, the rightmost is the decimal separator.
  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');

  let normalised: string;
  if (hasComma && hasDot) {
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
      // European: 1.234,56 — strip dots, comma → dot
      normalised = raw.replace(/\./g, '').replace(',', '.');
    } else {
      // AU/US: 1,234.56 — strip commas
      normalised = raw.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Could be "1,234" (thousands) or "1,5" (european decimal)
    // Heuristic: if exactly one comma followed by 1-2 digits, treat as decimal (european)
    // Otherwise treat as thousands separator and strip
    const m = raw.match(/^(\d+),(\d{1,2})$/);
    if (m) {
      // Ambiguous — could be 1,234 (no, that's 4 digits after) or 1,5 (european)
      // We default to AU/US convention (thousands), but flag if the comma is NOT
      // 3 digits before the end — that's a strong european decimal signal.
      // Actually the regex above requires 1-2 digits after the comma — that IS european.
      normalised = `${m[1]}.${m[2]}`;
    } else {
      // 1,234 or 1,234,567 — strip commas
      normalised = raw.replace(/,/g, '');
    }
  } else {
    normalised = raw;
  }

  // Strict numeric shape — `parseFloat` is greedy and silently truncates at
  // the first non-numeric character ("1 234.56" → 1, "0x1F" → 0). Validate
  // the whole normalised string is a clean decimal number BEFORE parsing.
  // Accepts: 123, 123.45, .45, 123., 1.23e10, 1.23E+10, 1.23e-10.
  // Rejects: anything with embedded whitespace, hex/octal/binary prefixes,
  // multiple decimals, trailing junk, or stray characters.
  if (!/^\d+(\.\d*)?([eE][+-]?\d+)?$|^\.\d+([eE][+-]?\d+)?$/.test(normalised)) {
    return err('number_unparseable', `Cannot parse "${value}" as number.`);
  }

  const parsed = parseFloat(normalised);
  if (isNaN(parsed) || !isFinite(parsed)) {
    return err('number_unparseable', `Cannot parse "${value}" as number.`);
  }

  let result = isNegative ? -parsed : parsed;
  if (isPercent && percentAsDecimal) {
    result = result / 100;
  }

  if (!allowNegative && result < 0) {
    return err('number_unparseable', `Negative not allowed: ${result}.`);
  }

  return ok(result, true);
}
