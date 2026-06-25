/**
 * `calibration-cert` — EQ Intake skill for calibration / test certificate PDFs.
 *
 * Why: labs (Trescal, etc.) return calibration certs as PDF bundles — often
 * image-only scans. Today that's 100% manual: find the instrument in the
 * equipment register, type the new cal dates, attach the PDF. This skill
 * reads each cert (vision), matches it to the existing asset by tag/serial
 * (tolerating prefix/suffix drift), and emits an update-or-create candidate
 * plus a match decision for the review queue. It does NOT touch the DB — the
 * orchestrator commits via the existing asset write path.
 *
 * Target canonical entity: `asset` (schemas/asset.schema.json). The cert's
 * ASSET NUMBER / CMX BARCODE backfills `asset.external_id`, so the next cert
 * for the same instrument matches on a clean key (match tier 1).
 *
 * Public entry points:
 *   - `reconcileCalibrationCerts(records, assets)` — pure core (no AI/DB),
 *     the unit-testable matcher used by the dry-run and the live path alike.
 *   - `parseCalibrationCerts({ files, ai, canonicalAssets })` — full pipeline:
 *     vision extract → reconcile.
 */
import { extractCertsFromPdf } from "./extract.js";
import { mapRecordToCandidate } from "./to-canonical.js";
import { matchCertToAssets } from "./match.js";
import type {
  CalCertFileSource,
  CalCertReconcileRow,
  CalCertSourceTag,
  CalibrationCertRecord,
  CanonicalAssetRef,
  ParseCalibrationCertsInput,
  ParseCalibrationCertsResult,
  SkillWarning,
} from "./types.js";

/**
 * Reconcile already-extracted cert records against the canonical register.
 * Pure + synchronous — the unit-testable core (no AI, no DB). Every input
 * record yields exactly one row (no silent drops).
 */
export function reconcileCalibrationCerts(
  records: Array<CalibrationCertRecord & { source: CalCertSourceTag }>,
  canonicalAssets: CanonicalAssetRef[] = [],
): CalCertReconcileRow[] {
  return records.map((record) => {
    const { candidate, warnings } = mapRecordToCandidate(record);
    const match = matchCertToAssets(candidate, canonicalAssets);
    return { record, candidate, match, warnings };
  });
}

/**
 * Full pipeline: extract each PDF (vision) → reconcile against the register.
 * Every input cert yields exactly one row.
 */
export async function parseCalibrationCerts(
  input: ParseCalibrationCertsInput,
): Promise<ParseCalibrationCertsResult> {
  const warnings: SkillWarning[] = [];
  const sources: CalCertFileSource[] = [];
  const allRecords: Array<CalibrationCertRecord & { source: CalCertSourceTag }> = [];

  for (const file of input.files) {
    const res = await extractCertsFromPdf(file, input.ai);
    sources.push(res.source);
    warnings.push(...res.warnings);
    allRecords.push(...res.records);
  }

  const rows = reconcileCalibrationCerts(allRecords, input.canonicalAssets ?? []);
  for (const row of rows) warnings.push(...row.warnings);

  const summary = { update: 0, confirm: 0, create: 0 };
  for (const row of rows) summary[row.match.action] += 1;

  return { rows, summary, warnings, sources };
}

// Public re-exports so callers don't have to reach into subpaths.
export { extractCertsFromPdf } from "./extract.js";
export {
  mapRecordToCandidate,
  coerceCertDate,
  mapResult,
  normaliseSerial,
} from "./to-canonical.js";
export { matchCertToAssets } from "./match.js";
export { CALIBRATION_CERT_EXTRACT_SCHEMA } from "./schema.js";
export type {
  CalibrationCertRecord,
  CalCertAssetCandidate,
  CalCertResult,
  CalCertSourceTag,
  CalCertMatch,
  CalCertMatchBasis,
  CalCertAction,
  CalCertReconcileRow,
  CanonicalAssetRef,
  ParseCalibrationCertsInput,
  ParseCalibrationCertsResult,
  CalCertFileSource,
  SkillWarning,
  CalCertWarningCode,
  SkillFileInput,
} from "./types.js";
