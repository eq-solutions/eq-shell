/**
 * to-canonical.ts — turn raw `MaximoWoRecord`s into canonical insert
 * candidates (`MaintenanceCheckInsert` + `CheckAssetInsert`).
 *
 * Field-level mapping rules are anchored in `SKILL-BRIEF.md` and mirror
 * `deltaRowToCheckAssetInsert` in eq-solves-service so the two intake paths
 * (PDF skill + Delta xlsx importer) round-trip 1:1.
 */
import {
  mapFrequencySuffix,
  splitJobPlanCode,
  stripSitePrefix,
} from "@eq/validation";
import type {
  CheckAssetInsert,
  CheckAssetStatus,
  IrScanResult,
  MaintenanceCheckInsert,
  MaintenanceCheckStatus,
  MaximoWoRecord,
  PriorityEnum,
  SkillSourceTag,
  SkillWarning,
  WorkType,
} from "./types.js";

/** Per-record output: the asset row + the parent check derivable from it. */
export interface MappedRow {
  check_asset: CheckAssetInsert;
  parent_check: MaintenanceCheckInsert;
  warnings: SkillWarning[];
}

export function mapRecordToCanonical(
  raw: MaximoWoRecord & { source: SkillSourceTag },
): MappedRow {
  const warnings: SkillWarning[] = [];

  // Site code.
  const siteCodeRaw = (raw.site ?? "").trim();
  const siteCode = stripSitePrefix(siteCodeRaw);
  if (!siteCode) {
    warnings.push({
      code: "missing_field",
      message: `WO ${raw.wo_number}: site code missing or unrecognised ('${siteCodeRaw}').`,
      context: { wo: raw.wo_number, field: "site" },
    });
  }

  // Job plan — split on " - " into prefix and canonical-code + description.
  const planParts = parseJobPlan(raw.job_plan);
  if (!planParts.canonicalCode) {
    warnings.push({
      code: "missing_field",
      message: `WO ${raw.wo_number}: could not parse job plan ('${raw.job_plan}'). Expected 'PREFIX-X - CODE Description'.`,
      context: { wo: raw.wo_number, field: "job_plan" },
    });
  }

  // Frequency — derived from the trailing suffix on the PRINTED prefix
  // (e.g. "ATS-3" → suffix "3" → quarterly).
  const { suffix: prefixSuffix } = splitJobPlanCode(planParts.prefix);
  const frequency = mapFrequencySuffix(prefixSuffix);
  if (!frequency && prefixSuffix !== "") {
    warnings.push({
      code: "unknown_frequency_suffix",
      message: `WO ${raw.wo_number}: unknown frequency suffix '${prefixSuffix}' on plan prefix '${planParts.prefix}'.`,
      context: { wo: raw.wo_number, prefix: planParts.prefix, suffix: prefixSuffix },
    });
  }

  // Dates.
  const targetStartIso = coerceMaximoDate(raw.target_start);
  const targetFinishIso = coerceMaximoDate(raw.target_finish);
  const actualFinishIso = coerceMaximoDate(raw.actual_finish);
  if (raw.target_start && !targetStartIso) {
    warnings.push({
      code: "invalid_date",
      message: `WO ${raw.wo_number}: target_start '${raw.target_start}' is not a recognised date.`,
      context: { wo: raw.wo_number, field: "target_start", value: raw.target_start },
    });
  }
  if (raw.target_finish && !targetFinishIso) {
    warnings.push({
      code: "invalid_date",
      message: `WO ${raw.wo_number}: target_finish '${raw.target_finish}' is not a recognised date.`,
      context: { wo: raw.wo_number, field: "target_finish", value: raw.target_finish },
    });
  }

  // Status.
  const checkStatus = mapCheckStatus(raw.status, warnings, raw.wo_number);
  const assetStatus = mapAssetStatus(raw.status, warnings, raw.wo_number);

  // Priority / work type / IR scan.
  const priority = mapPriority(raw.priority, warnings, raw.wo_number);
  const workType = mapWorkType(raw.work_type, warnings, raw.wo_number);
  const ir = mapIrScanResult(raw.ir_scan_result, warnings, raw.wo_number);

  // Asset split (numeric external_id + descriptive name).
  const { externalId, name } = parseAssetCell(raw.asset);

  // Derive due_date for the check: prefer target_finish, fall back to target_start.
  // Required by maintenance_check.schema.json.
  const dueDate = targetFinishIso ?? targetStartIso ?? null;
  if (!dueDate) {
    warnings.push({
      code: "missing_field",
      message: `WO ${raw.wo_number}: neither Target Start nor Target Finish parsed — maintenance_check.due_date will be unsettable.`,
      context: { wo: raw.wo_number },
    });
  }

  const check_asset: CheckAssetInsert = {
    asset_external_id: externalId,
    asset_name: name,
    status: assetStatus,
    work_order_number: raw.wo_number,
    priority,
    work_type: workType,
    crew_id: nullIfBlank(raw.crew_id),
    target_start: targetStartIso,
    target_finish: targetFinishIso,
    completed_at: actualFinishIso,
    failure_code: nullIfBlank(raw.failure_code),
    problem: nullIfBlank(raw.problem),
    cause: nullIfBlank(raw.cause),
    remedy: nullIfBlank(raw.remedy),
    classification: nullIfBlank(raw.classification),
    ir_scan_result: ir,
    notes: raw.location ? `Location: ${raw.location}` : null,
    source: raw.source,
  };

  const parent_check: MaintenanceCheckInsert = {
    site_code: siteCode,
    site_code_raw: siteCodeRaw,
    plan_code: planParts.canonicalCode,
    plan_code_raw: planParts.prefix,
    plan_description: planParts.description,
    status: checkStatus,
    due_date: dueDate ?? "",
    start_date: targetStartIso,
    frequency,
    maximo_wo_number: raw.wo_number,
    source: raw.source,
  };

  return { check_asset, parent_check, warnings };
}

// ============================================================================
// FIELD-LEVEL HELPERS
// ============================================================================

interface JobPlanParts {
  /** The bit before " - " in the printed name (e.g. "ATS-3"). */
  prefix: string;
  /** The canonical EQ plan code (e.g. "E1.8") — first token after " - ". */
  canonicalCode: string;
  /** Everything after the canonical code (e.g. "ATS-Automatic Transfer Switches"). */
  description: string | null;
}

/**
 * Maximo prints job plan as `PREFIX-X - CODE Description`, e.g.
 * `ATS-3 - E1.8 ATS-Automatic Transfer Switches`. Split on the first
 * ` - ` (space-dash-space) so the prefix's own trailing dash isn't taken
 * for the separator.
 */
export function parseJobPlan(raw: string | null | undefined): JobPlanParts {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { prefix: "", canonicalCode: "", description: null };

  const sepIdx = trimmed.indexOf(" - ");
  if (sepIdx === -1) {
    // Single token — treat whole thing as the canonical code.
    return { prefix: "", canonicalCode: trimmed, description: null };
  }

  const prefix = trimmed.slice(0, sepIdx).trim();
  const remainder = trimmed.slice(sepIdx + 3).trim();
  if (!remainder) return { prefix, canonicalCode: "", description: null };

  // Canonical code = first whitespace-delimited token of the remainder.
  const firstSpaceIdx = remainder.search(/\s/);
  if (firstSpaceIdx === -1) {
    return { prefix, canonicalCode: remainder, description: null };
  }
  return {
    prefix,
    canonicalCode: remainder.slice(0, firstSpaceIdx).trim(),
    description: remainder.slice(firstSpaceIdx + 1).trim() || null,
  };
}

interface AssetParts {
  externalId: string | null;
  name: string;
}

/**
 * Maximo prints assets as `<NUMERIC_ID> — <NAME>` or `<NUMERIC_ID> - <NAME>`,
 * sometimes with the numeric prefix absent (e.g. `CA1-PTP - CA1-Comprehensive…`).
 * If the leading token is purely numeric, treat it as the external_id.
 */
export function parseAssetCell(raw: string): AssetParts {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { externalId: null, name: "" };

  // Try em-dash, en-dash, then hyphen-with-surrounding-space.
  const dashMatch = trimmed.match(/^([^\s—–\-]+)\s*[—–\-]\s*(.+)$/);
  if (dashMatch) {
    const lead = dashMatch[1]!.trim();
    const rest = dashMatch[2]!.trim();
    if (/^\d+$/.test(lead)) {
      return { externalId: lead, name: rest };
    }
  }
  // No numeric-prefix shape — whole string is the name; external_id stays null.
  return { externalId: null, name: trimmed };
}

/**
 * Coerce Maximo date strings. Handles `dd-MMM-yyyy` (the printed format),
 * `dd/MM/yyyy`, and ISO. Returns `yyyy-mm-dd` or null.
 */
export function coerceMaximoDate(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  // dd-MMM-yyyy (e.g. "20-May-2026")
  const monthMatch = trimmed.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/);
  if (monthMatch) {
    const day = parseInt(monthMatch[1]!, 10);
    const monthName = monthMatch[2]!.toLowerCase().slice(0, 3);
    const year = parseInt(monthMatch[3]!, 10);
    const monthIdx = MONTH_ABBR.indexOf(monthName);
    if (monthIdx !== -1) {
      return `${year.toString().padStart(4, "0")}-${(monthIdx + 1).toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }
  }

  // dd/MM/yyyy
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]!, 10);
    const month = parseInt(slashMatch[2]!, 10);
    const year = parseInt(slashMatch[3]!, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }
  }

  // ISO already
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].+)?$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return null;
}

const MONTH_ABBR = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function mapCheckStatus(
  raw: string | null | undefined,
  warnings: SkillWarning[],
  wo: string,
): MaintenanceCheckStatus {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "scheduled";
  const map: Record<string, MaintenanceCheckStatus> = {
    wapprov: "scheduled",
    approved: "scheduled",
    sched: "scheduled",
    wsched: "scheduled",
    open: "scheduled",
    pending: "scheduled",
    new: "scheduled",
    inprg: "in_progress",
    inprog: "in_progress",
    in_progress: "in_progress",
    started: "in_progress",
    running: "in_progress",
    wmatl: "in_progress",
    comp: "complete",
    clo: "complete",
    closed: "complete",
    completed: "complete",
    done: "complete",
    finished: "complete",
    canc: "cancelled",
    cancel: "cancelled",
    cancelled: "cancelled",
    void: "cancelled",
    voided: "cancelled",
  };
  const out = map[v];
  if (!out) {
    warnings.push({
      code: "unknown_status",
      message: `WO ${wo}: unrecognised Maximo status '${raw}' — defaulting to 'scheduled'.`,
      context: { wo, status: raw },
    });
    return "scheduled";
  }
  return out;
}

function mapAssetStatus(
  raw: string | null | undefined,
  warnings: SkillWarning[],
  wo: string,
): CheckAssetStatus {
  // Per-asset status mirrors the WO status; eq-service tracks per-asset completion
  // separately once work begins. At intake time the asset status follows the WO.
  const checkStatus = mapCheckStatus(raw, [], wo); // suppress duplicate warning
  switch (checkStatus) {
    case "scheduled":
      return "pending";
    case "in_progress":
      return "in_progress";
    case "complete":
      return "complete";
    case "cancelled":
      return "skipped";
    case "overdue":
      return "pending";
    default:
      return "pending";
  }
}

function mapPriority(
  raw: string | number | null | undefined,
  warnings: SkillWarning[],
  wo: string,
): PriorityEnum | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const v = String(raw).trim().toLowerCase();
  const map: Record<string, PriorityEnum> = {
    "1": "urgent", p1: "urgent", urgent: "urgent", critical: "urgent",
    "2": "high", p2: "high", high: "high",
    "3": "medium", p3: "medium", medium: "medium", med: "medium", normal: "medium",
    "4": "low", p4: "low", low: "low",
  };
  const out = map[v];
  if (!out) {
    warnings.push({
      code: "unknown_priority",
      message: `WO ${wo}: unrecognised priority '${raw}'.`,
      context: { wo, priority: raw },
    });
    return null;
  }
  return out;
}

function mapWorkType(
  raw: string | null | undefined,
  warnings: SkillWarning[],
  wo: string,
): WorkType | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  const allowed: WorkType[] = ["PM", "CM", "EM", "CAL", "INSP"];
  if (allowed.includes(v as WorkType)) return v as WorkType;
  const map: Record<string, WorkType> = {
    PREVENTIVE: "PM",
    PREVENTATIVE: "PM",
    CORRECTIVE: "CM",
    EMERGENCY: "EM",
    CALIBRATION: "CAL",
    INSPECTION: "INSP",
  };
  const out = map[v];
  if (!out) {
    warnings.push({
      code: "unknown_work_type",
      message: `WO ${wo}: unrecognised work type '${raw}'.`,
      context: { wo, work_type: raw },
    });
    return null;
  }
  return out;
}

function mapIrScanResult(
  raw: string | null | undefined,
  warnings: SkillWarning[],
  wo: string,
): IrScanResult | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  const map: Record<string, IrScanResult> = {
    p: "pass", pass: "pass", passed: "pass", ok: "pass", green: "pass",
    f: "fail", fail: "fail", failed: "fail", red: "fail",
    na: "na", "n/a": "na", not_applicable: "na",
    pending: "not_done", skipped: "not_done", incomplete: "not_done", not_done: "not_done",
  };
  const out = map[v];
  if (!out) {
    warnings.push({
      code: "unknown_ir_scan_result",
      message: `WO ${wo}: unrecognised IR scan result '${raw}'.`,
      context: { wo, value: raw },
    });
    return null;
  }
  return out;
}

function nullIfBlank(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
