/**
 * Types for the `maximo-pdf-wo` skill.
 *
 * The skill emits canonical-shaped insert candidates for `maintenance_check`
 * + `check_asset` (see `schemas/maintenance_check.schema.json` and
 * `schemas/check_asset.schema.json`). System-managed fields (check_id,
 * check_asset_id, tenant_id, imported_at, imported_from) are omitted — the
 * orchestrator fills those at commit time.
 *
 * Site/plan/asset FKs are emitted as RAW lookup keys (site code, plan code,
 * asset external_id + name) rather than UUIDs. The commit step resolves them
 * via the existing FK resolver in `@eq/validation`.
 */
import type { FrequencyEnum } from "@eq/validation";

export type MaintenanceCheckStatus =
  | "scheduled"
  | "in_progress"
  | "complete"
  | "overdue"
  | "cancelled";

export type CheckAssetStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "skipped"
  | "failed";

export type WorkType = "PM" | "CM" | "EM" | "CAL" | "INSP";

export type PriorityEnum = "low" | "medium" | "high" | "urgent";

export type IrScanResult = "pass" | "fail" | "na" | "not_done";

/**
 * Raw per-WO record produced by the extractor (text or vision). Field names
 * mirror the labels printed on the Maximo PDF header table so the AI prompt
 * can ask for them by name.
 */
export interface MaximoWoRecord {
  /** Maximo work-order number, top-left of the header (e.g. "4501310"). */
  wo_number: string;
  /** Site code as printed (e.g. "AU01-CA1"). Skill strips the AU0x- prefix. */
  site: string;
  /**
   * Asset cell as printed. Two known shapes:
   *   - `1070 — CA1-TS-AC-29-ATS` (numeric Maximo ID + descriptive name)
   *   - `CA1-PTP - CA1-Comprehensive Utility Failure Test (PTP)` (no leading ID)
   */
  asset: string;
  /** Serial # — often "N/A". Captured but not mapped to a canonical field. */
  serial_number?: string | null;
  /** Maximo status code, e.g. "INPRG" / "WAPPROV" / "COMP". */
  status?: string | null;
  /** Sub-location within site, e.g. "CA1-GF-22 - CA1-GF-Node Room". */
  location?: string | null;
  /** Maximo work type code: "PM" / "CM" / "EM" / "CAL" / "INSP". */
  work_type?: string | null;
  /** Maximo priority integer 1-4 (string or number both accepted). */
  priority?: string | number | null;
  /**
   * Job plan as printed, e.g. "ATS-3 - E1.8 ATS-Automatic Transfer Switches".
   * Skill splits on " - " to take the second token as the EQ plan code.
   */
  job_plan: string;
  /** Maximo crew identifier — usually blank. */
  crew_id?: string | null;
  /** Date as printed, e.g. "20-May-2026". Skill coerces to ISO. */
  target_start?: string | null;
  /** Date as printed, e.g. "20-May-2026". Skill coerces to ISO. */
  target_finish?: string | null;
  /** Blank until completed. Maximo timestamp string. */
  actual_start?: string | null;
  /** Blank until completed. Maximo timestamp string. */
  actual_finish?: string | null;
  /** Asset classification, e.g. "ATS-Auto Transfer Switch". */
  classification?: string | null;
  failure_code?: string | null;
  problem?: string | null;
  cause?: string | null;
  remedy?: string | null;
  /** IR scan tick-box result — usually blank when scheduling. */
  ir_scan_result?: string | null;
}

/**
 * Insert candidate for the canonical `maintenance_check` table.
 *
 * Site + plan are emitted as lookup keys; commit step resolves to UUIDs.
 */
export interface MaintenanceCheckInsert {
  /** Site code AFTER stripping the AU0x- prefix (e.g. "CA1"). */
  site_code: string;
  /** Site code AS PRINTED (e.g. "AU01-CA1") — kept for audit trail. */
  site_code_raw: string;
  /** Canonical plan code (e.g. "E1.8") — the bit after the dash in the printed name. */
  plan_code: string;
  /** Printed plan code prefix (e.g. "ATS-3") — kept for audit. */
  plan_code_raw: string;
  /** Full printed plan description (e.g. "ATS-Automatic Transfer Switches"). */
  plan_description: string | null;
  status: MaintenanceCheckStatus;
  /** ISO date (yyyy-mm-dd). */
  due_date: string;
  /** ISO date (yyyy-mm-dd) — Target Start, distinct from started_at timestamp. */
  start_date: string | null;
  frequency: FrequencyEnum | null;
  /**
   * Primary WO# stamped on this check. Set when the group has exactly one WO;
   * otherwise null — per-WO numbers live on each check_asset.
   */
  maximo_wo_number: string | null;
  /** Per-PDF metadata for audit/UI display. */
  source: SkillSourceTag;
}

/** Insert candidate for the canonical `check_asset` table. */
export interface CheckAssetInsert {
  /** Maximo numeric asset ID (matches `asset.external_id`) when printed. */
  asset_external_id: string | null;
  /** Full printed asset name (fuzzy fallback against `asset.name`). */
  asset_name: string;
  status: CheckAssetStatus;
  /** Always present — required by the brief; one PDF WO = one check_asset. */
  work_order_number: string;
  priority: PriorityEnum | null;
  work_type: WorkType | null;
  crew_id: string | null;
  /** ISO date (yyyy-mm-dd). */
  target_start: string | null;
  /** ISO date (yyyy-mm-dd). */
  target_finish: string | null;
  /** ISO timestamp when completed (Actual Finish). */
  completed_at: string | null;
  failure_code: string | null;
  problem: string | null;
  cause: string | null;
  remedy: string | null;
  classification: string | null;
  ir_scan_result: IrScanResult | null;
  notes: string | null;
  /** Per-PDF metadata for audit/UI display. */
  source: SkillSourceTag;
}

/**
 * A grouped bundle = one maintenance_check + its child check_assets, all
 * sharing (site, plan, frequency, due_date). The group_key is the
 * idempotency anchor; re-parsing the same fixtures yields the same key.
 */
export interface MaintenanceCheckBundle {
  /** Stable group identifier — `${siteCode}|${planCode}|${frequency}|${dueDate}`. */
  group_key: string;
  maintenance_check: MaintenanceCheckInsert;
  check_assets: CheckAssetInsert[];
}

/** Where a record came from, for audit. */
export interface SkillSourceTag {
  /** File name (when supplied), e.g. "CUFT Work Order.pdf". */
  file_name: string | undefined;
  /** "text" if extracted by unpdf, "vision" if extracted by AI. */
  extracted_via: "text" | "vision";
  /** 1-based PDF page number, when known. */
  page_number?: number;
}

/** Warnings the skill couldn't recover from but didn't fatal-error on. */
export interface SkillWarning {
  /** Stable code: "missing_field" / "unknown_status" / "ambiguous_asset" etc. */
  code: SkillWarningCode;
  message: string;
  /** What context the warning relates to (a WO number, a field name, etc). */
  context?: Record<string, unknown>;
}

export type SkillWarningCode =
  | "missing_field"
  | "invalid_date"
  | "unknown_status"
  | "unknown_priority"
  | "unknown_work_type"
  | "unknown_ir_scan_result"
  | "unknown_frequency_suffix"
  | "vision_low_confidence"
  | "vision_unavailable"
  | "no_records_extracted";

/** Top-level result returned by `parseMaximoPdfWo`. */
export interface MaximoPdfWoResult {
  /** Grouped maintenance checks + their child assets, ready for commit. */
  bundles: MaintenanceCheckBundle[];
  /** Flat list of raw extractions, in source-page order. Useful for audit + debugging. */
  raw_records: Array<MaximoWoRecord & { source: SkillSourceTag }>;
  /** Non-fatal warnings the orchestrator should surface to the user. */
  warnings: SkillWarning[];
  /** Per-PDF parse metadata. */
  sources: SkillFileSource[];
}

export interface SkillFileSource {
  file_name?: string;
  page_count: number;
  extracted_via: "text" | "vision";
  records_emitted: number;
}

export interface ParseMaximoPdfWoInput {
  /** One or more PDFs to parse. */
  files: SkillFileInput[];
  /**
   * AI provider for vision extraction. Required for scanned PDFs;
   * an unscanned (text-extractable) PDF can be parsed without it.
   */
  ai?: import("@eq/ai").AIProvider;
}

export interface SkillFileInput {
  bytes: Buffer | Uint8Array | ArrayBuffer;
  fileName?: string;
}
