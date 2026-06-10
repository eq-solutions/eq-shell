/**
 * Translate a parsed Delta WO row into the `check_assets` insert shape,
 * with the Maximo enum-like fields normalised to the values our DB
 * columns expect.
 *
 * The parser carries 18 columns per row but the Delta import historically
 * persisted only 5 of them. The remaining 11 (priority, work_type,
 * crew_id, target_start, target_finish, failure_code, problem, cause,
 * remedy, classification, ir_scan_result) are now written too, so the
 * customer report + asset detail page have something to read.
 *
 * Pure function. No DB, no Supabase types beyond the Insert type.
 */
import type { Database } from '@/lib/supabase/database.types'
import type { DeltaRow } from '@/lib/import/delta-wo-parser'

type CheckAssetInsert = Database['public']['Tables']['check_assets']['Insert']

// ── Enum normalisers ───────────────────────────────────────────────────
// Maximo emits priority as "1"/"2"/"3"/"4" (or sometimes "p1".."p4" or
// "low"/"medium"/"high"/"urgent"). Work-type is "PM"/"CM"/"EM"/"CAL"/"INSP"
// or longer variants. IR-scan result is "pass"/"fail"/"na"/"not_done"
// (or shorthand). We keep our column values consistent with the canonical
// shape used by `/api/admin/export`.

const PRIORITY_MAP: Record<string, 'low' | 'medium' | 'high' | 'urgent'> = {
  low: 'low', l: 'low', '4': 'low', p4: 'low', low_priority: 'low',
  medium: 'medium', m: 'medium', med: 'medium', '3': 'medium', p3: 'medium', normal: 'medium',
  high: 'high', h: 'high', '2': 'high', p2: 'high',
  urgent: 'urgent', u: 'urgent', '1': 'urgent', p1: 'urgent', critical: 'urgent',
}

const WORK_TYPE_MAP: Record<string, 'PM' | 'CM' | 'EM' | 'CAL' | 'INSP'> = {
  pm: 'PM', preventive: 'PM', preventative: 'PM', preventive_maintenance: 'PM',
  cm: 'CM', corrective: 'CM', corrective_maintenance: 'CM',
  em: 'EM', emergency: 'EM', emergency_maintenance: 'EM',
  cal: 'CAL', calibration: 'CAL', calibrate: 'CAL',
  insp: 'INSP', inspection: 'INSP', inspect: 'INSP',
}

const IR_SCAN_MAP: Record<string, 'pass' | 'fail' | 'na' | 'not_done'> = {
  pass: 'pass', p: 'pass', ok: 'pass', passed: 'pass', green: 'pass',
  fail: 'fail', f: 'fail', failed: 'fail', red: 'fail',
  na: 'na', 'n/a': 'na', not_applicable: 'na',
  not_done: 'not_done', pending: 'not_done', skipped: 'not_done', incomplete: 'not_done',
}

export function normalisePriority(raw: string | null): 'low' | 'medium' | 'high' | 'urgent' | null {
  if (!raw) return null
  return PRIORITY_MAP[raw.trim().toLowerCase()] ?? null
}

export function normaliseWorkType(
  raw: string | null,
): 'PM' | 'CM' | 'EM' | 'CAL' | 'INSP' | null {
  if (!raw) return null
  return WORK_TYPE_MAP[raw.trim().toLowerCase()] ?? null
}

export function normaliseIrScan(
  raw: string | null,
): 'pass' | 'fail' | 'na' | 'not_done' | null {
  if (!raw) return null
  return IR_SCAN_MAP[raw.trim().toLowerCase()] ?? null
}

function isoDateTime(d: Date | null): string | null {
  return d ? d.toISOString() : null
}

// ── Main helper ────────────────────────────────────────────────────────

export interface CheckAssetMappingContext {
  tenantId: string
  checkId: string
  assetId: string
}

/**
 * Build the `check_assets` Insert row for one parsed Delta WO row.
 *
 * `status: 'pending'` is fixed on import — the work hasn't started yet.
 * Date fields land as ISO strings (Supabase timestamptz columns accept
 * ISO strings; we don't need separate Date conversion on the DB side).
 */
export function deltaRowToCheckAssetInsert(
  row: DeltaRow,
  ctx: CheckAssetMappingContext,
): CheckAssetInsert {
  return {
    tenant_id: ctx.tenantId,
    check_id: ctx.checkId,
    asset_id: ctx.assetId,
    status: 'pending',
    work_order_number: row.workOrder,
    priority: normalisePriority(row.priority),
    work_type: normaliseWorkType(row.workType),
    crew_id: row.crewId,
    target_start: isoDateTime(row.targetStart),
    target_finish: isoDateTime(row.targetFinish),
    failure_code: row.failureCode,
    problem: row.problem,
    cause: row.cause,
    remedy: row.remedy,
    classification: row.classification,
    ir_scan_result: normaliseIrScan(row.irScanResult),
  }
}
