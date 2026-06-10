/**
 * Delta / Equinix Maximo Work-Order Excel Parser
 *
 * Converts the monthly `.xlsx` file that Equinix's Delta team sends
 * (one row per work order, one sheet) into structured groups that can
 * become maintenance_checks + check_assets in EQ Service.
 *
 * Spec: see auto-memory/project_delta_wo_import.md (locked 2026-04-19).
 *
 * No DB access, no React — pure parsing. Safe to run in a server action
 * or a unit test.
 */

import { Workbook, Worksheet } from 'exceljs'

// ── Frequency suffix → EQ frequency enum ────────────────────────────
// Keys match the enum values used by maintenance_checks.frequency in the
// CreateCheckForm (see app/(app)/maintenance/CreateCheckForm.tsx).

export const FREQUENCY_SUFFIX_MAP: Record<string, FrequencyEnum> = {
  A: 'annual',
  Q: 'quarterly',
  '3': 'quarterly',
  M: 'monthly',
  S: 'semi_annual',
  '6': 'semi_annual',
  W: 'weekly',
  '2': '2yr',
  '5': '5yr',
  '10': '10yr',
}

export type FrequencyEnum =
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'semi_annual'
  | 'annual'
  | '2yr'
  | '3yr'
  | '5yr'
  | '8yr'
  | '10yr'

// ── Types ───────────────────────────────────────────────────────────

export interface DeltaRow {
  /** 1-indexed row number from the source sheet, for error reporting. */
  rowNumber: number
  /** Raw site code from the sheet, e.g. "AU01-SY3". */
  site: string
  /** Site code after stripping the "AU0x-" prefix, e.g. "SY3". */
  siteCode: string
  /** Maximo work-order number, e.g. "3962180". */
  workOrder: string
  /** Asset description (usually asset name), e.g. "SY3-A1-TPL-01". */
  description: string
  /** Maximo classification path, e.g. "ELEC \\ TRNSFMR". Nullable. */
  classification: string | null
  /** Location code (rack/zone), e.g. "SY3-GF16". Nullable. */
  location: string | null
  /** Numeric-string Maximo asset ID — matches assets.maximo_id on our side. */
  maximoAssetId: string
  /** Raw job plan code from the sheet, e.g. "LVACB-A". */
  jobPlanRaw: string
  /** Job plan code portion, e.g. "LVACB". */
  jobPlanCode: string
  /** Frequency suffix portion, e.g. "A". */
  frequencySuffix: string
  /** Mapped EQ frequency, or null if the suffix is unknown. */
  frequency: FrequencyEnum | null
  /** Target start date. */
  targetStart: Date
  /** Priority from Maximo WO (low, medium, high, urgent). Nullable. */
  priority: string | null
  /** Work Type from Maximo (PM, CM, EM, CAL, INSP or raw string). Nullable. */
  workType: string | null
  /** Crew ID from Maximo. Nullable. */
  crewId: string | null
  /** Target finish date. Nullable. */
  targetFinish: Date | null
  /** Failure Code from Maximo. Nullable. */
  failureCode: string | null
  /** Problem code from Maximo. Nullable. */
  problem: string | null
  /** Cause code from Maximo. Nullable. */
  cause: string | null
  /** Remedy code from Maximo. Nullable. */
  remedy: string | null
  /** IR Scan result (pass, fail, na, not_done or raw string). Nullable. */
  irScanResult: string | null
  /** Maximo Task ID for linking to job_plan_items. Nullable. */
  maximoTaskId: string | null
  /** Per-row non-blocking warnings — row still emitted, flagged for preview. */
  warnings: string[]
}

export interface ParsedGroup {
  /** Stable deterministic key — site|jpCode|frequency|YYYY-MM-DD. */
  key: string
  siteCode: string
  jobPlanCode: string
  frequencySuffix: string
  frequency: FrequencyEnum | null
  startDate: Date
  rows: DeltaRow[]
}

export interface ParseError {
  /** 1-indexed source row number (0 = workbook-level error). */
  rowNumber: number
  message: string
}

export interface ParseResult {
  rows: DeltaRow[]
  groups: ParsedGroup[]
  /** Hard failures — the row was skipped and is NOT in `rows` or `groups`. */
  errors: ParseError[]
}

// ── Constants ───────────────────────────────────────────────────────

/**
 * Canonical header order in the Delta work-order export. Used by the test
 * suite as the reference shape; not used for runtime validation.
 *
 * Real-world exports vary by classification — Equinix Maximo ships:
 *   - ACB Breaker exports: 14 cols, adds `CR Required` and `Qualifications Required`
 *   - HV / LV / PDU exports: 11 cols, drops `History` entirely
 *
 * The parser tolerates these shapes by resolving cells against
 * REQUIRED_HEADERS via column-name lookup, ignoring extras and missing
 * optional columns.
 */
export const EXPECTED_HEADERS = [
  'Site',
  'Work Order',
  'Description',
  'Classification',
  'History',
  'Location',
  'Asset',
  'Work Type',
  'Status',
  'Job Plan',
  'Target Start',
  'Reported Date',
] as const

/**
 * Headers that MUST be present (in any column position) for a sheet to
 * count as a valid work-order data sheet. Missing any of these is a
 * workbook-level error.
 */
export const REQUIRED_HEADERS = [
  'Site',
  'Work Order',
  'Description',
  'Asset',
  'Job Plan',
  'Target Start',
] as const

/**
 * Headers we recognise but don't require. Missing-OK; extra unknown
 * columns are silently ignored.
 */
export const OPTIONAL_HEADERS = [
  'Classification',
  'History',
  'Location',
  'Work Type',
  'Status',
  'Reported Date',
  'CR Required',
  'Qualifications Required',
  'Priority',
  'Crew',
  'Crew ID',
  'Target Finish',
  'Sched Finish',
  'Failure Code',
  'Problem',
  'Cause',
  'Remedy',
  'IR Scan',
  'IR Test Result',
  'Task ID',
  'Task #',
] as const

/**
 * The name Maximo gives the data tab in the monthly Delta export. When the
 * file also contains pivot/summary tabs (the common real-world case — see
 * `WO Aug 2025_Delta.xlsx`, which ships `Sheet1` as an active pivot), we
 * want to land on the headered tab regardless of sheet order.
 */
export const DATA_SHEET_NAME = 'List of Work Orders'

// ── Pure helpers (exported for unit testing) ────────────────────────

/**
 * Strip the "AU0x-" prefix from an Equinix Maximo site code so it matches
 * `sites.code` in EQ Service. `AU01-SY3` → `SY3`. Non-matching input is
 * returned trimmed but unchanged.
 */
export function stripSitePrefix(raw: string): string {
  const trimmed = (raw ?? '').trim()
  return trimmed.replace(/^AU\d{2}-/, '')
}

/**
 * Split a Delta-style job plan code on the LAST dash. The portion before
 * becomes the EQ `job_plans.code`; the portion after is the frequency
 * suffix. Input without a dash returns `{ code: input, suffix: '' }`.
 *
 * Examples: `LVACB-A` → { LVACB, A }, `ATS-3` → { ATS, 3 }.
 */
export function splitJobPlanCode(raw: string): { code: string; suffix: string } {
  const trimmed = (raw ?? '').trim()
  const idx = trimmed.lastIndexOf('-')
  if (idx === -1) return { code: trimmed, suffix: '' }
  return {
    code: trimmed.slice(0, idx).trim(),
    suffix: trimmed.slice(idx + 1).trim(),
  }
}

/**
 * Map a Delta frequency suffix to an EQ frequency enum value. Returns
 * null for unknown suffixes — callers must fail-closed per spec (no
 * default guess).
 */
export function mapFrequencySuffix(suffix: string): FrequencyEnum | null {
  const key = (suffix ?? '').toUpperCase()
  return FREQUENCY_SUFFIX_MAP[key] ?? null
}

/**
 * Read row 1 of a worksheet as trimmed strings. Returns one entry per
 * non-empty column; trailing empties are dropped.
 */
function readHeaderRow(ws: Worksheet): string[] {
  const headerRow = ws.getRow(1)
  // exceljs `actualCellCount` is the count of populated cells; use the
  // larger of that and EXPECTED_HEADERS so we never under-read on sparse
  // sheets, and never over-read on long sheets with junk far to the right.
  const lastCol = Math.max(headerRow.actualCellCount, EXPECTED_HEADERS.length)
  const out: string[] = []
  for (let c = 1; c <= lastCol; c++) {
    const raw = headerRow.getCell(c).value
    out.push(raw == null ? '' : String(raw).trim())
  }
  return out
}

/**
 * Build a map of header name → 1-indexed column number. Header lookups
 * are case-sensitive and exact (matches the strings in REQUIRED_HEADERS /
 * OPTIONAL_HEADERS). Unknown columns are still indexed so per-row warnings
 * can reference them by name.
 */
function buildHeaderMap(ws: Worksheet): Map<string, number> {
  const headers = readHeaderRow(ws)
  const map = new Map<string, number>()
  headers.forEach((h, i) => {
    if (h && !map.has(h)) map.set(h, i + 1)
  })
  return map
}

/** True when every REQUIRED_HEADERS entry has a column on `ws`. */
function hasRequiredHeaders(ws: Worksheet): boolean {
  const map = buildHeaderMap(ws)
  return REQUIRED_HEADERS.every((h) => map.has(h))
}

/**
 * Pick the sheet that holds the work-order data. Maximo exports usually
 * land on `List of Work Orders`, but the file may also include pivot tabs
 * (`Sheet1`, etc.) that get marked active. Order of preference:
 *   1. Sheet named exactly DATA_SHEET_NAME, if it has the required headers
 *   2. First sheet whose row 1 contains all REQUIRED_HEADERS
 *   3. null — caller emits a workbook-level error
 *
 * The named-sheet match still requires headers to validate so a renamed
 * pivot tab named `List of Work Orders` doesn't fool us.
 */
export function findDataSheet(wb: Workbook): Worksheet | null {
  const named = wb.getWorksheet(DATA_SHEET_NAME)
  if (named && hasRequiredHeaders(named)) return named
  for (const ws of wb.worksheets) {
    if (hasRequiredHeaders(ws)) return ws
  }
  return null
}

/** Compose the stable group key used for deduplication. */
export function groupKey(
  siteCode: string,
  jpCode: string,
  frequency: string,
  date: Date,
): string {
  const iso = date.toISOString().slice(0, 10)
  return `${siteCode}|${jpCode}|${frequency}|${iso}`
}

// ── Main entry ──────────────────────────────────────────────────────

/**
 * Parse a Delta work-order workbook. Accepts either an ArrayBuffer
 * (browser upload) or a Buffer (Node/test fixture).
 */
export async function parseWorkbook(
  source: ArrayBuffer | Buffer | Uint8Array,
): Promise<ParseResult> {
  const wb = new Workbook()
  // exceljs types accept Buffer; ArrayBuffer / Uint8Array also work at
  // runtime. Cast through unknown to sidestep the generic Buffer<ArrayBufferLike>
  // mismatch between @types/node and exceljs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(source as any)

  if (wb.worksheets.length === 0) {
    return {
      rows: [],
      groups: [],
      errors: [{ rowNumber: 0, message: 'Workbook contains no worksheets' }],
    }
  }

  const ws = findDataSheet(wb)
  if (!ws) {
    const available = wb.worksheets.map((w) => `"${w.name}"`).join(', ')
    return {
      rows: [],
      groups: [],
      errors: [
        {
          rowNumber: 0,
          message:
            `Could not find the work-order data tab. Expected a sheet named ` +
            `"${DATA_SHEET_NAME}" (or any sheet whose row 1 contains all of ` +
            `${REQUIRED_HEADERS.map((h) => `"${h}"`).join(', ')}). ` +
            `Available sheets: ${available}.`,
        },
      ],
    }
  }

  const errors: ParseError[] = []

  // ── Header validation ──────────────────────────────────────────────
  // findDataSheet guarantees REQUIRED_HEADERS are present, but we
  // re-resolve the map here to drive cell access by header name. This is
  // what lets the parser tolerate Equinix's per-classification column
  // shapes (CR Required / Qualifications Required on ACB, no History on
  // PDU/HV/LV).
  const headerMap = buildHeaderMap(ws)
  const missing = REQUIRED_HEADERS.filter((h) => !headerMap.has(h))
  if (missing.length > 0) {
    errors.push({
      rowNumber: 1,
      message:
        `Sheet "${ws.name}" is missing required column(s): ${missing.map((m) => `"${m}"`).join(', ')}. ` +
        `Found columns: ${Array.from(headerMap.keys()).map((k) => `"${k}"`).join(', ')}.`,
    })
    return { rows: [], groups: [], errors }
  }

  // ── Unknown-column detection (2026-05-21) ──
  // Workbook-level warning when row 1 carries headers we don't recognise.
  // Surfaces Equinix Maximo template drift early instead of silently
  // dropping data. Doesn't block import — just signals the column was
  // ignored so the operator can decide whether to add it to OPTIONAL_HEADERS.
  const knownHeaders = new Set<string>([...REQUIRED_HEADERS, ...OPTIONAL_HEADERS])
  const unknownHeaders = Array.from(headerMap.keys()).filter((h) => !knownHeaders.has(h))
  if (unknownHeaders.length > 0) {
    errors.push({
      rowNumber: 1,
      message:
        `Sheet "${ws.name}" has unknown column(s) which will be ignored: ` +
        `${unknownHeaders.map((h) => `"${h}"`).join(', ')}. ` +
        `If this column carries data the import should capture, add it to OPTIONAL_HEADERS ` +
        `in lib/import/delta-wo-parser.ts and wire the per-row read.`,
    })
    // Note: not returning. Unknown columns are non-blocking — import continues.
  }

  // ── Row parsing ────────────────────────────────────────────────────
  const rows: DeltaRow[] = []

  const lastRow = ws.actualRowCount
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const row = ws.getRow(rowNumber)
    if (!row.hasValues) continue

    /**
     * Resolve a header name to its cell value on the current row. Returns
     * null when the column doesn't exist on this sheet (optional column),
     * or when the cell is empty. exceljs hyperlink/richText shapes expose
     * `.text` — unwrap so callers see plain strings.
     */
    const cell = (header: string): unknown => {
      const col = headerMap.get(header)
      if (!col) return null
      const v = row.getCell(col).value
      if (v === null || v === undefined || v === '') return null
      const obj = v as unknown as Record<string, unknown>
      if (typeof v === 'object' && v !== null && 'text' in obj) {
        return obj.text
      }
      return v
    }

    const site = String(cell('Site') ?? '').trim()
    const workOrder = String(cell('Work Order') ?? '').trim()
    const description = String(cell('Description') ?? '').trim()
    const classificationRaw = cell('Classification')
    const classification = classificationRaw ? String(classificationRaw).trim() : null
    const locationRaw = cell('Location')
    const location = locationRaw ? String(locationRaw).trim() : null
    const assetRaw = cell('Asset')
    const maximoAssetId = assetRaw != null ? String(assetRaw).trim() : ''
    const jobPlanRaw = String(cell('Job Plan') ?? '').trim()
    const targetRaw = cell('Target Start')
    const targetStart = targetRaw instanceof Date ? targetRaw : null

    // ── Maximo WO metadata fields (all optional) ──
    const priorityRaw = cell('Priority')
    const priority = priorityRaw ? String(priorityRaw).trim() : null

    const workTypeRaw = cell('Work Type')
    const workType = workTypeRaw ? String(workTypeRaw).trim() : null

    const crewRaw = cell('Crew') ?? cell('Crew ID')
    const crewId = crewRaw ? String(crewRaw).trim() : null

    const targetFinishRaw = cell('Target Finish') ?? cell('Sched Finish') ?? cell('TARGCOMPDATE')
    const targetFinish = targetFinishRaw instanceof Date ? targetFinishRaw : null

    const failureCodeRaw = cell('Failure Code')
    const failureCode = failureCodeRaw ? String(failureCodeRaw).trim() : null

    const problemRaw = cell('Problem')
    const problem = problemRaw ? String(problemRaw).trim() : null

    const causeRaw = cell('Cause')
    const cause = causeRaw ? String(causeRaw).trim() : null

    const remedyRaw = cell('Remedy')
    const remedy = remedyRaw ? String(remedyRaw).trim() : null

    const irScanRaw = cell('IR Scan') ?? cell('IR Test Result')
    const irScanResult = irScanRaw ? String(irScanRaw).trim() : null

    const taskIdRaw = cell('Task ID') ?? cell('Task #')
    const maximoTaskId = taskIdRaw ? String(taskIdRaw).trim() : null

    // Hard-fail rows with missing critical fields.
    if (!site) {
      errors.push({ rowNumber, message: 'Missing Site' })
      continue
    }
    if (!workOrder) {
      errors.push({ rowNumber, message: 'Missing Work Order' })
      continue
    }
    if (!maximoAssetId) {
      errors.push({ rowNumber, message: 'Missing Asset (Maximo ID)' })
      continue
    }
    if (!jobPlanRaw) {
      errors.push({ rowNumber, message: 'Missing Job Plan' })
      continue
    }
    if (!targetStart) {
      errors.push({ rowNumber, message: 'Missing or non-date Target Start' })
      continue
    }

    const siteCode = stripSitePrefix(site)
    const { code: jobPlanCode, suffix: frequencySuffix } = splitJobPlanCode(jobPlanRaw)

    if (!jobPlanCode) {
      errors.push({
        rowNumber,
        message: `Cannot parse job plan code from "${jobPlanRaw}"`,
      })
      continue
    }

    const frequency = mapFrequencySuffix(frequencySuffix)
    const warnings: string[] = []
    if (!frequency) {
      warnings.push(
        `Unknown frequency suffix "${frequencySuffix}" — manual frequency assignment required`,
      )
    }

    rows.push({
      rowNumber,
      site,
      siteCode,
      workOrder,
      description,
      classification,
      location,
      maximoAssetId,
      jobPlanRaw,
      jobPlanCode,
      frequencySuffix,
      frequency,
      targetStart,
      priority,
      workType,
      crewId,
      targetFinish,
      failureCode,
      problem,
      cause,
      remedy,
      irScanResult,
      maximoTaskId,
      warnings,
    })
  }

  // ── Group rows by (site, jp_code, frequency, start_date) ──────────
  const groupMap = new Map<string, ParsedGroup>()
  for (const r of rows) {
    // Rows with unknown frequency still group — key uses the raw suffix so
    // the preview can show the group and prompt for manual assignment.
    const freqForKey = r.frequency ?? `unknown:${r.frequencySuffix}`
    const k = groupKey(r.siteCode, r.jobPlanCode, freqForKey, r.targetStart)
    let g = groupMap.get(k)
    if (!g) {
      g = {
        key: k,
        siteCode: r.siteCode,
        jobPlanCode: r.jobPlanCode,
        frequencySuffix: r.frequencySuffix,
        frequency: r.frequency,
        startDate: r.targetStart,
        rows: [],
      }
      groupMap.set(k, g)
    }
    g.rows.push(r)
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => {
    // Sort by asset count descending, then site+jpCode — deterministic for
    // both UX (biggest group first) and test assertions.
    if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length
    return `${a.siteCode}|${a.jobPlanCode}`.localeCompare(`${b.siteCode}|${b.jobPlanCode}`)
  })

  return { rows, groups, errors }
}
