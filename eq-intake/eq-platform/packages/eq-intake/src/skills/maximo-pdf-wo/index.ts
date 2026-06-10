/**
 * `maximo-pdf-wo` — EQ Intake skill for IBM Maximo work-order PDFs.
 *
 * Why: Equinix (and other Maximo-using customers) emails ad-hoc / mid-cycle
 * WO additions as PDF attachments — sometimes a fresh print from Maximo
 * (text-extractable), more often a scanned printout (vision required).
 * Without this skill those PDFs are 100% manual entry in eq-service. With
 * it they round-trip into the canonical maintenance_check + check_asset
 * spine the same way the monthly Delta xlsx importer does.
 *
 * Public entry: `parseMaximoPdfWo({ files, ai? })`. Returns canonical-
 * shaped insert candidates. The orchestrator runs `validate()` and commits
 * via the existing intake commit RPC — this skill does NOT touch the DB.
 *
 * Routing:
 *   - text-extractable PDF → `unpdf` reader → header-table line parser
 *   - scanned PDF (or text parser miss) → `ai.extract()` with a multi-WO
 *     wrapped schema, unwrapping `extracted.work_orders[]`
 *
 * Grouping: rows sharing (site, plan_code, frequency, due_date) collapse
 * into one maintenance_check, matching the Delta xlsx importer's groupKey.
 *
 * Idempotency: the `group_key` is deterministic, and check_assets carry
 * `work_order_number` as the natural key. Re-parsing the same fixture set
 * → identical bundles → upserting by (group_key, wo_number) yields zero
 * net diffs.
 */
import { extractMaximoWosFromPdf } from "./extract.js";
import { groupMappedRows } from "./group.js";
import { mapRecordToCanonical } from "./to-canonical.js";
import type {
  MaximoPdfWoResult,
  ParseMaximoPdfWoInput,
  SkillFileSource,
  SkillWarning,
} from "./types.js";

export async function parseMaximoPdfWo(
  input: ParseMaximoPdfWoInput,
): Promise<MaximoPdfWoResult> {
  const warnings: SkillWarning[] = [];
  const sources: SkillFileSource[] = [];
  const rawRecords: MaximoPdfWoResult["raw_records"] = [];
  const mapped: ReturnType<typeof mapRecordToCanonical>[] = [];

  for (const file of input.files) {
    const result = await extractMaximoWosFromPdf(file, input.ai);
    sources.push(result.source);
    warnings.push(...result.warnings);

    for (const raw of result.records) {
      rawRecords.push(raw);
      const m = mapRecordToCanonical(raw);
      warnings.push(...m.warnings);
      mapped.push(m);
    }
  }

  const bundles = groupMappedRows(mapped);

  return {
    bundles,
    raw_records: rawRecords,
    warnings,
    sources,
  };
}

// Public re-exports so callers don't have to reach into subpaths.
export type {
  CheckAssetInsert,
  CheckAssetStatus,
  IrScanResult,
  MaintenanceCheckBundle,
  MaintenanceCheckInsert,
  MaintenanceCheckStatus,
  MaximoPdfWoResult,
  MaximoWoRecord,
  ParseMaximoPdfWoInput,
  PriorityEnum,
  SkillFileInput,
  SkillFileSource,
  SkillSourceTag,
  SkillWarning,
  SkillWarningCode,
  WorkType,
} from "./types.js";
export { groupKeyFor } from "./group.js";
export {
  coerceMaximoDate,
  parseAssetCell,
  parseJobPlan,
} from "./to-canonical.js";
export { MAXIMO_WO_EXTRACT_SCHEMA } from "./schema.js";
