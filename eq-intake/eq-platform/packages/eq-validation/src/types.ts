/**
 * @eq/validation — coercer types
 *
 * A coercer takes a raw value (string, number, anything) from an imported row
 * and returns a typed canonical value, OR an error if it can't be coerced.
 *
 * Coercers MUST be pure functions. No I/O, no side effects.
 */

export type CoerceOk<T> = {
  ok: true;
  value: T;
  /** True if the input was modified (not already in canonical form) */
  transformed: boolean;
  /** Optional human-readable note (e.g. "format unrecognised, kept raw") */
  note?: string;
};

export type CoerceErr = {
  ok: false;
  /** Stable error code — caller switches on this */
  error: CoerceErrorCode;
  /** Human-readable message */
  message: string;
};

export type CoerceResult<T> = CoerceOk<T> | CoerceErr;

export type CoerceErrorCode =
  | 'value_null_or_empty'
  | 'date_unparseable'
  | 'date_ambiguous'
  | 'date_out_of_range'
  | 'boolean_unrecognised'
  | 'phone_unrecognised'
  | 'number_unparseable'
  | 'state_unrecognised'
  | 'enum_unrecognised'
  | 'string_too_long';

export type Locale = 'en-AU' | 'en-US' | 'en-GB';

export interface CoerceOptions {
  locale: Locale;
  /** If true, ambiguous values return error; if false, they return ok with note */
  strict?: boolean;
}

export const ok = <T>(value: T, transformed = false, note?: string): CoerceOk<T> => ({
  ok: true,
  value,
  transformed,
  note,
});

export const err = (error: CoerceErrorCode, message: string): CoerceErr => ({
  ok: false,
  error,
  message,
});
