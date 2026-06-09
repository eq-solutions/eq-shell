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
export { coerceAbn } from './coerce-abn';
export { coerceEmail } from './coerce-email';

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

// ── Delta / Maximo / Jemena code-parsing helpers ────────────────────
// Ported from eq-solves-service/lib/import/delta-wo-parser.ts +
// jemena-rcd-parser.ts so other intake pipelines can reuse them
// without depending on eq-solves-service directly.
export {
  FREQUENCY_SUFFIX_MAP,
  mapFrequencySuffix,
  knownFrequencySuffixes,
} from './parse-frequency-suffix';
export type { FrequencyEnum } from './parse-frequency-suffix';

export { splitJobPlanCode } from './parse-job-plan-code';
export type { JobPlanCodeParts } from './parse-job-plan-code';

export { stripSitePrefix, hasMaximoSitePrefix } from './parse-site-prefix';

export {
  isJemenaAssetId,
  extractJemenaAssetId,
  extractAllJemenaAssetIds,
} from './parse-jemena-asset-id';
