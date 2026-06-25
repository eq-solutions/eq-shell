/**
 * @eq/intake — Australian data normalisation and validation utilities.
 * Deterministic rules — no network calls, no AI.
 */

// ---------------------------------------------------------------------------
// ABN (Australian Business Number)
// ---------------------------------------------------------------------------

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19] as const;

/** Strip whitespace and hyphens, returning bare digits. */
export function normaliseAbn(raw: string): string {
  return raw.replace(/[\s\-]/g, '');
}

/** Returns true if the string passes the 11-digit ABN checksum algorithm. */
export function isValidAbn(abn: string): boolean {
  const digits = normaliseAbn(abn);
  if (!/^\d{11}$/.test(digits)) return false;

  // First digit: subtract 1 before weighting
  let sum = (Number(digits[0]) - 1) * ABN_WEIGHTS[0];
  for (let i = 1; i < 11; i++) {
    sum += Number(digits[i]) * ABN_WEIGHTS[i]!;
  }
  return sum % 89 === 0;
}

// ---------------------------------------------------------------------------
// Phone (Australian)
// ---------------------------------------------------------------------------

/** Normalises an Australian phone number to 10 bare digits (strips +61 / 61 prefix). */
export function normalisePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  // +61 → 0
  if (digits.startsWith('61') && digits.length === 11) {
    digits = '0' + digits.slice(2);
  }
  return digits;
}

/** True if the string is a plausible Australian phone number (10 digits, 0[2-9] prefix). */
export function isValidAuPhone(phone: string): boolean {
  return /^0[2-9]\d{8}$/.test(normalisePhone(phone));
}

// ---------------------------------------------------------------------------
// Australian state codes
// ---------------------------------------------------------------------------

const AU_STATES = new Set(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']);

export function isValidAuState(state: string): boolean {
  return AU_STATES.has(state.toUpperCase().trim());
}

// ---------------------------------------------------------------------------
// Postcode
// ---------------------------------------------------------------------------

export function isValidAuPostcode(postcode: string): boolean {
  return /^\d{4}$/.test(postcode.trim());
}

// ---------------------------------------------------------------------------
// String normalisation for duplicate detection
// ---------------------------------------------------------------------------

const LEGAL_SUFFIXES =
  /\b(pty\.?\s*ltd\.?|ltd\.?|pty\.?|incorporated|inc\.?|limited|trust|& co\.?|and co\.?|co\.?)\b/gi;
const NON_ALPHA_NUM = /[^a-z0-9\s]/g;

/** Normalise a company name for fuzzy comparison (strips legal suffixes, punctuation). */
export function normaliseCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, '')
    .replace(NON_ALPHA_NUM, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalise a person's full name for fuzzy comparison. */
export function normalisePersonName(first: string, last: string): string {
  return `${first} ${last}`
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
