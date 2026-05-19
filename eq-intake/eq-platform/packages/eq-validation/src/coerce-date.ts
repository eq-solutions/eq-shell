/**
 * @eq/validation — date coercer
 *
 * Handles every date format we encounter in trade subbie spreadsheets:
 * - ISO 8601 (preferred)
 * - AU short/long dates
 * - US dates (only when locale='en-US')
 * - Excel serial numbers
 * - Quarters (Q1 2026)
 * - Month-year (Jan-26, January 2026)
 * - Fiscal years (FY26, FY2025-26 — AU FY = 1 July to 30 June)
 *
 * Output: ISO 8601 date string (YYYY-MM-DD).
 *
 * Ambiguous dates (e.g. 03/04/2026 with no locale hint) error in strict mode,
 * default to locale interpretation otherwise.
 */

import { CoerceOptions, CoerceResult, ok, err } from './types';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].+)?$/;
const SLASH_DATE = /^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})$/;
const SHORT_AU = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/;
const TEXT_MONTH = /^(\d{1,2})[\s\-]([A-Za-z]+)[\s\-](\d{2,4})$/;
const MONTH_YEAR = /^([A-Za-z]+)[\s\-](\d{2,4})$/;
const QUARTER = /^Q([1-4])\s*(\d{2,4})$/i;
const FISCAL_YEAR_SHORT = /^FY\s*(\d{2})$/i;
const FISCAL_YEAR_LONG = /^FY\s*(\d{4})[\s\-\/](\d{2,4})$/i;
const EXCEL_SERIAL = /^[1-9]\d{3,4}(?:\.\d+)?$/;

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Pad to 2 digits */
const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Build YYYY-MM-DD string with validation */
function buildIso(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Check day is valid for month (handles Feb 29, etc)
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Resolve 2-digit year — pivot at 50 (00-49 → 2000s, 50-99 → 1900s) */
function fullYear(yr: number): number {
  if (yr >= 100) return yr;
  return yr < 50 ? 2000 + yr : 1900 + yr;
}

/** Excel stores dates as days since 1900-01-01, with a famous off-by-one bug */
function excelSerialToIso(serial: number): string | null {
  // Excel's epoch is 1899-12-30 due to its leap year bug
  const epoch = Date.UTC(1899, 11, 30);
  const ms = serial * 86400 * 1000;
  const d = new Date(epoch + ms);
  return buildIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function coerceDate(
  raw: unknown,
  opts: CoerceOptions
): CoerceResult<string> {
  if (raw === null || raw === undefined || raw === '') {
    return err('value_null_or_empty', 'Date is empty.');
  }

  // Already a Date object?
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) {
      return err('date_unparseable', 'Invalid Date object.');
    }
    const iso = buildIso(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
    return iso ? ok(iso, false) : err('date_out_of_range', 'Date out of valid range.');
  }

  // Excel serial as number
  if (typeof raw === 'number') {
    if (raw < 1 || raw > 100000) {
      return err('date_out_of_range', `Numeric value ${raw} not a plausible Excel date serial.`);
    }
    const iso = excelSerialToIso(raw);
    return iso
      ? ok(iso, true, 'parsed as Excel serial')
      : err('date_unparseable', `Excel serial ${raw} could not be converted.`);
  }

  // String parsing from here
  if (typeof raw !== 'string') {
    return err('date_unparseable', `Unexpected type ${typeof raw} for date.`);
  }

  let s = raw.trim();
  if (s === '') return err('value_null_or_empty', 'Date is empty after trim.');

  // Strip a trailing time component from slash/dash-formatted dates like
  // "01/05/2026 12:34" or "28-04-2026 09:00:00". Without this, the slash
  // parser fails on the whole string and the native fallback below would
  // re-parse it with the JS runtime's locale (not opts.locale), silently
  // flipping DD/MM to MM/DD on US-locale machines. Strip the time and let
  // the dedicated slash-date branch handle the rest.
  const slashDateWithTime = s.match(
    /^(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})\s+\d{1,2}:\d{2}(?::\d{2})?\s*$/,
  );
  if (slashDateWithTime) {
    s = slashDateWithTime[1]!;
  }

  // ISO 8601
  let m: RegExpMatchArray | null;
  if ((m = s.match(ISO_DATE))) {
    const year = parseInt(m[1]!, 10);
    const month = parseInt(m[2]!, 10);
    const day = parseInt(m[3]!, 10);
    const iso = buildIso(year, month, day);
    return iso
      ? ok(iso, false)
      : err('date_out_of_range', `Date ${s} components out of range.`);
  }

  // String that's actually an Excel serial (e.g. "45777")
  if (EXCEL_SERIAL.test(s)) {
    const n = parseFloat(s);
    const iso = excelSerialToIso(n);
    if (iso) return ok(iso, true, 'parsed as Excel serial');
    // fall through — might still be parseable
  }

  // Quarter (Q1 2026)
  if ((m = s.match(QUARTER))) {
    const q = parseInt(m[1]!, 10);
    const yr = fullYear(parseInt(m[2]!, 10));
    const month = (q - 1) * 3 + 1;
    const iso = buildIso(yr, month, 1);
    return iso
      ? ok(iso, true, `interpreted as start of Q${q}`)
      : err('date_unparseable', `Could not parse quarter ${s}.`);
  }

  // Fiscal year (AU FY = 1 July of start year)
  if ((m = s.match(FISCAL_YEAR_SHORT))) {
    const yr = fullYear(parseInt(m[1]!, 10));
    // FY26 = 1 July 2025 in AU
    return ok(`${yr - 1}-07-01`, true, 'interpreted as start of AU FY');
  }
  if ((m = s.match(FISCAL_YEAR_LONG))) {
    const startYr = parseInt(m[1]!, 10);
    return ok(`${startYr}-07-01`, true, 'interpreted as start of AU FY');
  }

  // "1 January 2026" / "January 2026" / "Jan-26"
  if ((m = s.match(TEXT_MONTH))) {
    const day = parseInt(m[1]!, 10);
    const monthName = m[2]!.toLowerCase();
    const yr = fullYear(parseInt(m[3]!, 10));
    const month = MONTH_NAMES[monthName];
    if (!month) return err('date_unparseable', `Unknown month name '${m[2]}'.`);
    const iso = buildIso(yr, month, day);
    return iso
      ? ok(iso, true)
      : err('date_unparseable', `Date ${s} not valid.`);
  }

  if ((m = s.match(MONTH_YEAR))) {
    const monthName = m[1]!.toLowerCase();
    const yr = fullYear(parseInt(m[2]!, 10));
    const month = MONTH_NAMES[monthName];
    if (!month) return err('date_unparseable', `Unknown month name '${m[1]}'.`);
    const iso = buildIso(yr, month, 1);
    return iso
      ? ok(iso, true, 'interpreted as first of month')
      : err('date_unparseable', `Date ${s} not valid.`);
  }

  // Slash/dash dates — locale-dependent
  if ((m = s.match(SLASH_DATE)) || (m = s.match(SHORT_AU))) {
    const a = parseInt(m[1]!, 10);
    const b = parseInt(m[2]!, 10);
    const c = parseInt(m[3]!, 10);

    // 4-digit first → YYYY-MM-DD
    if (a > 31) {
      const iso = buildIso(a, b, c);
      return iso
        ? ok(iso, true)
        : err('date_unparseable', `Date ${s} not valid.`);
    }

    // 4-digit last → either DMY or MDY based on locale
    const yr = fullYear(c);
    let day: number, month: number;

    if (a > 12 && b <= 12) {
      // First component must be day (>12)
      day = a; month = b;
    } else if (b > 12 && a <= 12) {
      // Second component must be month-impossible, so first is month
      month = a; day = b;
    } else if (a <= 12 && b <= 12) {
      // Genuinely ambiguous — use locale
      if (opts.locale === 'en-US') { month = a; day = b; }
      else { day = a; month = b; }
      if (opts.strict) {
        return err('date_ambiguous', `Date ${s} is ambiguous (could be ${a}/${b} or ${b}/${a}). Specify locale.`);
      }
    } else {
      return err('date_unparseable', `Date ${s} components out of range.`);
    }

    const iso = buildIso(yr, month, day);
    return iso
      ? ok(iso, true, opts.locale === 'en-US' ? 'parsed as US format' : 'parsed as AU format')
      : err('date_unparseable', `Date ${s} not valid.`);
  }

  // Last-ditch: native Date.parse — kept for ISO-ish forms the dedicated
  // parsers don't cover (e.g. "Wed, 01 May 2026"). Validate against overflow:
  // native Date silently rolls "Feb 30" into March, so if the input contains
  // a 2-digit number that doesn't appear as month/day in the parsed result,
  // reject — that means the parser "fixed up" something the bookkeeper meant.
  const native = Date.parse(s);
  if (!isNaN(native)) {
    const d = new Date(native);
    const iso = buildIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (iso) {
      // Overflow check: extract all 1-2 digit numbers from the input. The
      // result's day, month, and 2-digit year-suffix should be among them.
      // If a number appears in the input that's NOT in {day, month, yy},
      // the native parser silently rolled over (e.g. "Feb 30 2026" → Mar 2:
      // input has 30, result has day=2 → mismatch). Reject.
      const inputNums = (s.match(/\b\d{1,2}\b/g) ?? []).map((n) => parseInt(n, 10));
      const resultDay = d.getDate();
      const resultMonth = d.getMonth() + 1;
      const yearStr = String(d.getFullYear());
      const resultYearSuffix = parseInt(yearStr.slice(-2), 10);
      const validNums = new Set([resultDay, resultMonth, resultYearSuffix]);
      const rolled = inputNums.some((n) => !validNums.has(n));
      if (rolled) {
        return err(
          'date_unparseable',
          `Could not parse '${raw}' as a date — components don't match a valid date.`,
        );
      }
      return ok(iso, true, 'parsed via native Date');
    }
  }

  return err('date_unparseable', `Could not parse '${s}' as a date.`);
}
