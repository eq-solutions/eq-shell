/**
 * @eq/validation — public API
 *
 * Drop into apps via:
 *   import { validate, coerceDate, resolveFk } from '@eq/validation';
 */

export { validate } from './validate';
export type {
  ValidateOpts,
  ValidationResult,
  ValidRow,
  FlaggedRow,
  RejectedRow,
  Flag,
  ValidationError,
  ValidationSummary,
  TransformSpec,
} from './validate';

export { coerceString } from './coerce-string';
export { coerceBoolean } from './coerce-boolean';
export { coerceNumber } from './coerce-number';
export { coerceDate } from './coerce-date';
export { coercePhoneAU } from './coerce-phone-au';
export { coerceAuState } from './coerce-au-state';
export { coerceCountry } from './coerce-country';
export { coerceEnumAlias } from './coerce-enum-alias';

export { resolveFk, jaroWinkler } from './fk-resolver';
export type { FkResolution, FkCandidate, FkLookup, FkLookupRow } from './fk-resolver';

export { compileRule, evalRule } from './cross-field-eval';

export { computeSignatureHash, computeSignatureHashWithDebug } from './signature-hash';

export type {
  CoerceOk,
  CoerceErr,
  CoerceResult,
  CoerceErrorCode,
  CoerceOptions,
  Locale,
} from './types';
export { ok, err } from './types';
