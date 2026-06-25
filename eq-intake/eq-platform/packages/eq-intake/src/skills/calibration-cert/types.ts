/**
 * Types for the `calibration-cert` skill.
 *
 * Turns a calibration certificate PDF (Trescal and similar ISO-17025 labs)
 * into canonical `asset` update/insert candidates plus a match decision
 * against the existing equipment register.
 *
 * Unlike most skills, calibration certs predominantly UPDATE an existing
 * asset (its last/next calibration dates + cert link) rather than create a
 * new canonical entity — so this skill carries an explicit match step. New
 * instruments (no register match) fall through to an asset insert candidate.
 *
 * Target canonical entity: `asset` (schemas/asset.schema.json). The cert's
 * printed ASSET NUMBER / CMX BARCODE maps to `asset.external_id` (the
 * (tenant_id, external_id) upsert key), so re-importing a later cert for the
 * same instrument is idempotent.
 */

/**
 * Raw per-certificate record produced by the extractor (vision). Field names
 * mirror the labels printed on the cert so the AI prompt can ask for them by
 * name.
 */
export interface CalibrationCertRecord {
  /** ASSET NUMBER / CMX BARCODE — the customer's asset tag, e.g. "CXS027014". */
  asset_number: string | null;
  /** Manufacturer serial, verbatim incl. prefix/suffix, e.g. "68470187MV". */
  serial_number: string | null;
  /** Manufacturer / brand, e.g. "Fluke". */
  make: string | null;
  /** Model designation, e.g. "323". */
  model: string | null;
  /** UNIT UNDER TEST description, e.g. "Fluke 323 Clamp Meter". */
  unit_under_test: string | null;
  /** CAL DATE as printed, e.g. "28-Apr-2026". */
  cal_date: string | null;
  /** CAL DUE as printed, e.g. "28-Apr-2027". */
  cal_due: string | null;
  /** TEST RESULT as printed: "PASS" / "FAIL" / "LIMITED CALIBRATION" / … */
  test_result: string | null;
  /** Calibration Certificate Number, e.g. "S568457-1FL". */
  cert_number: string | null;
}

/**
 * Normalised calibration outcome. `limited` / `fail` / `unknown` are surfaced
 * to the reviewer and never silently treated as a clean pass.
 */
export type CalCertResult = "pass" | "fail" | "limited" | "unknown";

/** Where a record came from, for audit. */
export interface CalCertSourceTag {
  file_name: string | undefined;
  extracted_via: "vision" | "text";
  page_number?: number;
}

/**
 * Canonical `asset` update/insert candidate derived from one cert. FK + system
 * fields (asset_id, tenant_id, site_id, asset_type) are resolved by the
 * orchestrator at commit time — see the defaults documented in `index.ts`.
 */
export interface CalCertAssetCandidate {
  /** asset.external_id ← cert ASSET NUMBER (CXS tag). The upsert key. */
  external_id: string | null;
  serial_number: string | null;
  make: string | null;
  model: string | null;
  /** Display name for NEW rows — derived from unit_under_test or make+model. */
  name: string;
  /** asset.last_service_date ← CAL DATE (ISO yyyy-mm-dd). */
  last_service_date: string | null;
  /** asset.next_service_due ← CAL DUE (ISO yyyy-mm-dd). */
  next_service_due: string | null;
  /** Normalised PASS / FAIL / LIMITED. */
  cal_result: CalCertResult;
  /** Lab certificate number, for cert_url naming + audit. */
  certificate_number: string | null;
  source: CalCertSourceTag;
}

export type CalCertMatchBasis =
  | "external_id"
  | "serial_exact"
  | "serial_fuzzy"
  | "make_model"
  | "none";

/** What the commit step should do with this cert. */
export type CalCertAction = "update" | "confirm" | "create";

export interface CalCertMatch {
  /** Matched canonical asset_id, or null when action === "create". */
  asset_id: string | null;
  basis: CalCertMatchBasis;
  confidence: "high" | "medium" | "low";
  action: CalCertAction;
  /** Canonical row name of the match — for the review UI. */
  matched_name?: string | null;
  /** Canonical row serial of the match — for the review UI. */
  matched_serial?: string | null;
}

/** Minimal canonical asset shape needed to match a cert against the register. */
export interface CanonicalAssetRef {
  asset_id: string;
  name?: string | null;
  serial_number?: string | null;
  external_id?: string | null;
  make?: string | null;
  model?: string | null;
}

/** One reconciled cert: extraction + canonical candidate + match decision. */
export interface CalCertReconcileRow {
  record: CalibrationCertRecord & { source: CalCertSourceTag };
  candidate: CalCertAssetCandidate;
  match: CalCertMatch;
  warnings: SkillWarning[];
}

/** Warnings the skill couldn't recover from but didn't fatal-error on. */
export interface SkillWarning {
  code: CalCertWarningCode;
  message: string;
  context?: Record<string, unknown>;
}

export type CalCertWarningCode =
  | "missing_field"
  | "invalid_date"
  | "serial_echoes_tag"
  | "non_pass_result"
  | "unknown_result"
  | "vision_low_confidence"
  | "vision_unavailable"
  | "no_records_extracted";

export interface CalCertFileSource {
  file_name?: string;
  page_count: number;
  extracted_via: "vision" | "text";
  records_emitted: number;
}

export interface SkillFileInput {
  bytes: Buffer | Uint8Array | ArrayBuffer;
  fileName?: string;
}

export interface ParseCalibrationCertsInput {
  /** One or more calibration-cert PDFs to parse. */
  files: SkillFileInput[];
  /**
   * AI provider for vision extraction. Calibration certs are not reliably
   * text-extractable (two-column layout scrambles labels; many are image-only
   * scans), so this is effectively required to get records out.
   */
  ai?: import("@eq/ai").AIProvider;
  /**
   * Existing canonical assets to match against. When omitted, every cert is
   * treated as a new instrument (action = "create").
   */
  canonicalAssets?: CanonicalAssetRef[];
}

export interface ParseCalibrationCertsResult {
  /** One row per cert — every input cert yields a row (no silent drops). */
  rows: CalCertReconcileRow[];
  /** Roll-up counts for the review header. */
  summary: { update: number; confirm: number; create: number };
  /** Non-fatal warnings the orchestrator should surface to the user. */
  warnings: SkillWarning[];
  /** Per-PDF parse metadata. */
  sources: CalCertFileSource[];
}
