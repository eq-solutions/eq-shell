/**
 * DELTA ELCOM commercial-sheet xlsx parser.
 *
 * Reads the per-site Equinix AU SMCA commercial-sheet workbook
 * ("DELTA ELCOM_<SITE> Elec Maintenance_Commercial Sheet JPs <date>.xlsx")
 * and returns structured rows ready to feed `contract_scopes`.
 *
 * Ported from `load_sy3_bootstrap.py` (Python prototype, 2026-04-27). All
 * shape decisions trace back to migration 0073's `contract_scopes` columns
 * and the audit findings captured in `audit-2026-04-27-digest.md`.
 *
 * Pure functions only — no DB, no React, no I/O beyond the supplied buffer.
 * Safe to run in a server action or unit test.
 *
 * Workbook structure (Equinix AU SMCA template):
 *   - "Summary Cost Sheet" tab: aggregate JP rows with year totals + due-year comments
 *   - One tab per JP (e.g. "E1.25 Low Voltage ACB"): the per-asset costs +
 *     labour hours per cycle live here, NOT on the Summary Cost Sheet
 *   - "Additional Items" tab: RCD push-button, RCD battery test, T&T
 *
 * Per migration 0073's contract:
 *   - `cycle_costs` JSONB holds PER-ASSET cost per cycle from the JP tab
 *   - `year_totals` JSONB holds AGGREGATE per-year totals from the Summary
 *     Cost Sheet (already includes asset_qty + occurrences)
 */

import { Workbook } from 'exceljs'

// ── Types ────────────────────────────────────────────────────────────────

/** A single parsed scope row ready for contract_scopes insert. */
export interface ParsedScope {
  /** "E1.3", "M14.29" etc. NULL for "Additional Items" rows. */
  jp_code: string | null
  /** Free-text description, e.g. "Low Voltage Air Circuit Breaker (ACB)". */
  scope_item: string
  /** Count of physical assets at this site covered by this scope. */
  asset_qty: number
  /** Raw interval string from SCS column F. e.g. "A; 5", "M/Q/A". */
  intervals_text: string
  /** "fixed" for priced JPs and Additional Items; "ad_hoc" for SY9-style. */
  billing_basis: 'fixed' | 'ad_hoc'
  /** Per-asset cost per cycle. From the JP tab's "Total Cost Per Asset" row. */
  cycle_costs: Record<string, number>
  /** Aggregate per-year totals from SCS year columns. */
  year_totals: Record<string, number>
  /** Per-year asset count due, parsed from SCS comments column. */
  due_years: Record<string, number>
  /** Per-cycle labour hours from JP tab "Labour Time Per Asset" row. */
  labour_hours_per_asset: Record<string, number>
  /** For Additional Items: unit cost per asset (e.g. RCD push @ $8.50). */
  unit_rate_per_asset: number | null
  /** Free-text from SCS comments column. Truncated to 500 chars. */
  notes: string | null
  /** 1-indexed source row in the workbook, for audit trail. */
  source_row: number | null
  /** Which sheet this row came from. */
  source_sheet: string
  /** Set when JP-tab labour > 0 but SCS year_totals = 0 (audit hit). */
  commercial_gap: boolean
  /** Set when scope is delivered free against a calendar entry. Manual. */
  has_bundled_scope: boolean
}

/** Result of parsing one workbook. */
export interface ParsedSheet {
  /** Site hint extracted from filename (e.g. "SY3"). May be null. */
  site_hint: string | null
  /** Source workbook filename. */
  source_workbook: string
  /** Priced JPs from "Summary Cost Sheet". */
  scopes: ParsedScope[]
  /** Additional Items (RCD, T&T) — billing_basis='fixed', unit_rate_per_asset set. */
  additional_items: ParsedScope[]
  /** Soft warnings — surfaced in the preview but don't block commit. */
  warnings: string[]
  /** Hard errors — block commit. */
  errors: string[]
}

// ── Helpers ──────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const cleaned = v.trim().replace(/^\$/, '').replace(/,/g, '')
    if (!cleaned || cleaned === '-') return null
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : null
  }
  // exceljs hyperlink/richText shapes
  if (typeof v === 'object' && v !== null) {
    const obj = v as { result?: unknown; richText?: { text?: string }[]; text?: unknown }
    if (obj.result !== undefined) return num(obj.result)
    if (obj.text !== undefined) return num(obj.text)
    if (Array.isArray(obj.richText)) {
      return num(obj.richText.map((r) => r.text ?? '').join(''))
    }
  }
  return null
}

function text(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object' && v !== null) {
    const obj = v as { result?: unknown; richText?: { text?: string }[]; text?: unknown; hyperlink?: string }
    if (obj.richText && Array.isArray(obj.richText)) {
      return obj.richText.map((r) => r.text ?? '').join('').trim()
    }
    if (obj.text !== undefined) return text(obj.text)
    if (obj.result !== undefined) return text(obj.result)
    if (typeof obj.hyperlink === 'string') return ''
  }
  return ''
}

/**
 * Parse "X due in YYYY" patterns from the SCS comments column.
 * Returns { 2026: 14, 2027: 3, 2028: 15 } shape.
 *
 * Falls back to "due in YYYY[, YYYY...]" — without counts — when no count
 * pattern matches. In that case, entries get count=0 (the structural
 * shape is preserved; the actual count needs SOW review).
 */
export function parseDueYears(comment: string): Record<string, number> {
  const out: Record<string, number> = {}
  if (!comment) return out
  const countPattern = /(\d+)\s+(?:asset[s]?\s+)?due\s+in\s+(\d{4})/gi
  let m: RegExpExecArray | null
  while ((m = countPattern.exec(comment)) !== null) {
    out[m[2]] = parseInt(m[1], 10)
  }
  if (Object.keys(out).length === 0) {
    const yearPattern = /due\s+in\s+([\d\s,&]+\d{4})/gi
    while ((m = yearPattern.exec(comment)) !== null) {
      const years = m[1].match(/\d{4}/g) ?? []
      for (const y of years) out[y] = 0
    }
  }
  return out
}

/**
 * Pull "site code" out of the filename. Equinix template is:
 *   DELTA ELCOM_<SITE> Elec[trical] Maintenance_Commercial Sheet[s] JPs <date>.xlsx
 */
export function extractSiteHint(filename: string): string | null {
  const m = filename.match(/^DELTA ELCOM_([A-Z0-9]+)\s/i)
  return m ? m[1].toUpperCase() : null
}

// ── Tab parsers ──────────────────────────────────────────────────────────

interface JPRow {
  jp_code: string
  description: string
  asset_qty: number
  intervals: string[]
  cycle_costs: Record<string, number>
  year_totals: Record<string, number>
  comments: string
  due_years: Record<string, number>
  source_row: number
}

const SCS_GROUP_TOTAL_CODES = new Set(['E1', 'M10', 'M14', 'Template', 'TEMPLATE'])
const JP_CODE_PATTERN = /^[EM]\d+(\.\d+)*$/

function parseSummaryCostSheet(wb: Workbook): { rows: JPRow[]; warnings: string[] } {
  const ws = wb.getWorksheet('Summary Cost Sheet')
  const warnings: string[] = []
  if (!ws) {
    return {
      rows: [],
      warnings: ['Workbook has no "Summary Cost Sheet" tab — parser cannot find priced JPs.'],
    }
  }

  const rows: JPRow[] = []
  let current: JPRow | null = null

  // SCS layout (1-indexed columns):
  //   B(2)  jp_code
  //   C(3)  description
  //   E(5)  asset_qty
  //   F(6)  intervals_text
  //   G..M (7..13) cycle_costs at 1YR/2YR/3YR/4YR/5YR/8YR/10YR
  //   N(14) comments (with "X due in YYYY" patterns)
  //   O..S (15..19) year_totals 2026..2030

  const cycleCols: Array<[string, number]> = [
    ['1YR', 7], ['2YR', 8], ['3YR', 9], ['4YR', 10], ['5YR', 11], ['8YR', 12], ['10YR', 13],
  ]
  const yearCols: Array<[string, number]> = [
    ['2026', 15], ['2027', 16], ['2028', 17], ['2029', 18], ['2030', 19],
  ]

  // Start at row 12 — header rows above. Iterate to ws.actualRowCount or last
  // row with any cell, whichever exposes more data on this template.
  const lastRow = Math.max(ws.actualRowCount ?? 0, ws.rowCount ?? 0)

  for (let r = 12; r <= lastRow; r++) {
    const row = ws.getRow(r)
    const jpCode = text(row.getCell(2).value)
    const desc = text(row.getCell(3).value)
    const qty = num(row.getCell(5).value)
    const interval = text(row.getCell(6).value)
    const comments = text(row.getCell(14).value)
    const isGroupTotal = SCS_GROUP_TOTAL_CODES.has(jpCode)

    if (jpCode && !isGroupTotal && JP_CODE_PATTERN.test(jpCode)) {
      // New JP row.
      if (current !== null) rows.push(current)
      current = {
        jp_code: jpCode,
        description: desc,
        asset_qty: qty !== null ? Math.round(qty) : 0,
        intervals: interval ? [interval] : [],
        cycle_costs: {},
        year_totals: {},
        comments,
        due_years: parseDueYears(comments),
        source_row: r,
      }
      for (const [label, col] of cycleCols) {
        const v = num(row.getCell(col).value)
        if (v !== null) current.cycle_costs[label] = v
      }
      for (const [yr, col] of yearCols) {
        const v = num(row.getCell(col).value)
        if (v !== null) current.year_totals[yr] = v
      }
    } else if (current !== null && !jpCode && !isGroupTotal) {
      // Continuation row for the previous JP — extra interval, more comments.
      if (interval) current.intervals.push(interval)
      for (const [label, col] of cycleCols) {
        const v = num(row.getCell(col).value)
        if (v !== null && v !== 0 && current.cycle_costs[label] === undefined) {
          current.cycle_costs[label] = v
        }
      }
      if (comments && !current.comments.includes(comments)) {
        current.comments = (current.comments + ' ' + comments).trim()
        Object.assign(current.due_years, parseDueYears(comments))
      }
    } else if (jpCode === 'Ad-Hoc') {
      if (current !== null) {
        rows.push(current)
        current = null
      }
    }
  }
  if (current !== null) rows.push(current)
  return { rows, warnings }
}

/** "Total Cost Per Asset" row → per-asset cycle costs. */
function parseJpTabTotal(wb: Workbook, jpCode: string): Record<string, number> {
  const sheet = wb.worksheets.find((w) => w.name.startsWith(jpCode + ' '))
  if (!sheet) return {}
  const out: Record<string, number> = {}
  const lastRow = Math.max(sheet.actualRowCount ?? 0, sheet.rowCount ?? 0)
  for (let r = 1; r <= lastRow; r++) {
    const row = sheet.getRow(r)
    const label = text(row.getCell(2).value).toLowerCase()
    if (label.includes('total cost per asset')) {
      const v1 = num(row.getCell(10).value)
      if (v1 !== null) out['1YR'] = v1
      for (const [cycle, col] of [['2YR', 12], ['3YR', 14], ['4YR', 16], ['5YR', 18], ['10YR', 20]] as const) {
        const v = num(row.getCell(col).value)
        if (v !== null) out[cycle] = v
      }
    }
  }
  return out
}

/** "Labour Time Per Asset" row → per-cycle labour hours. */
function parseJpTabLabour(wb: Workbook, jpCode: string): Record<string, number> {
  const sheet = wb.worksheets.find((w) => w.name.startsWith(jpCode + ' '))
  if (!sheet) return {}
  const out: Record<string, number> = {}
  const lastRow = Math.max(sheet.actualRowCount ?? 0, sheet.rowCount ?? 0)
  for (let r = 1; r <= lastRow; r++) {
    const row = sheet.getRow(r)
    const label = text(row.getCell(2).value).toLowerCase()
    if (label.includes('labour time per asset')) {
      const cols: Array<[string, number]> = [
        ['D', 4], ['W', 5], ['M', 6], ['Q', 7], ['S', 8], ['A', 9],
        ['2YR', 12], ['3YR', 14], ['4YR', 16], ['5YR', 18], ['10YR', 20],
      ]
      for (const [f, col] of cols) {
        const v = num(row.getCell(col).value)
        if (v !== null) out[f] = v
      }
    }
  }
  return out
}

function parseAdditionalItems(wb: Workbook): ParsedScope[] {
  const ws = wb.getWorksheet('Additional Items')
  if (!ws) return []
  const items: ParsedScope[] = []
  const lastRow = Math.max(ws.actualRowCount ?? 0, ws.rowCount ?? 0)
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r)
    const desc = text(row.getCell(2).value)
    const freq = text(row.getCell(3).value)
    const cnt = num(row.getCell(4).value)
    const unit = num(row.getCell(5).value)
    const total = num(row.getCell(6).value)
    if (!desc) continue
    const lower = desc.toLowerCase()
    if (lower === 'description' || lower === 'optional' || lower === 'additional items total (annually)') continue
    if (lower.startsWith('return to') || lower.startsWith('sub-total')) continue
    if (cnt === null && unit === null && total === null) continue

    const annual = total ?? 0
    const yearTotals: Record<string, number> = {}
    for (const y of ['2026', '2027', '2028', '2029', '2030']) yearTotals[y] = annual

    items.push({
      jp_code: null,
      scope_item: desc,
      asset_qty: cnt !== null ? Math.round(cnt) : 0,
      intervals_text: freq,
      billing_basis: 'fixed',
      cycle_costs: {},
      year_totals: yearTotals,
      due_years: {},
      labour_hours_per_asset: {},
      unit_rate_per_asset: unit ?? 0,
      notes: null,
      source_row: r,
      source_sheet: 'Additional Items',
      commercial_gap: false,
      has_bundled_scope: false,
    })
  }
  return items
}

// ── Entry point ──────────────────────────────────────────────────────────

/**
 * Parse one DELTA ELCOM commercial-sheet workbook into structured scope
 * rows + additional items. Pure function — pass in a Buffer or Uint8Array
 * read from the upload, get back typed data + warnings.
 *
 * @param buffer The xlsx bytes (Node Buffer or Uint8Array).
 * @param filename The original filename — used to extract the site hint.
 */
export async function parseCommercialSheet(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  filename: string,
): Promise<ParsedSheet> {
  const wb = new Workbook()
  try {
    // exceljs accepts Buffer / ArrayBuffer / Uint8Array at runtime, but the
    // declared signature is narrower than @types/node's modern Buffer<…>
    // shape — same workaround used in lib/import/delta-wo-parser.ts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any)
  } catch (err) {
    return {
      site_hint: extractSiteHint(filename),
      source_workbook: filename,
      scopes: [],
      additional_items: [],
      warnings: [],
      errors: [`Failed to read workbook: ${err instanceof Error ? err.message : String(err)}`],
    }
  }

  const errors: string[] = []
  const { rows, warnings } = parseSummaryCostSheet(wb)
  if (rows.length === 0 && warnings.length === 0) {
    errors.push('Summary Cost Sheet found but no priced JP rows detected. Check that the workbook follows the AU SMCA template (rows from line 12, JP code in column B).')
  }

  // Filter out unpriced rows. The Python loader uses `asset_qty > 0` as the
  // priced-vs-template heuristic. Mirror that.
  const priced = rows.filter((r) => r.asset_qty > 0)

  // Enrich each priced JP with JP-tab data.
  // commercial_gap and has_bundled_scope are NOT auto-set by the parser —
  // the audit-hit heuristic is genuinely ambiguous from data alone (E1.25
  // ACB at SY3 has 5YR labour + zero annual cost which fits the "gap"
  // pattern, but so does E1.12 Electrical Panel which is correctly a
  // 5YR-only JP). Both flags ship as false; the operator surfaces them via
  // the contract-scope edit UI when reviewing imported rows.
  const scopes: ParsedScope[] = priced.map((s) => ({
    jp_code: s.jp_code,
    scope_item: s.description,
    asset_qty: s.asset_qty,
    intervals_text: s.intervals.join('; '),
    billing_basis: 'fixed',
    cycle_costs: parseJpTabTotal(wb, s.jp_code),
    year_totals: s.year_totals,
    due_years: s.due_years,
    labour_hours_per_asset: parseJpTabLabour(wb, s.jp_code),
    unit_rate_per_asset: null,
    notes: s.comments ? s.comments.slice(0, 500) : null,
    source_row: s.source_row,
    source_sheet: 'Summary Cost Sheet',
    commercial_gap: false,
    has_bundled_scope: false,
  }))

  const additional_items = parseAdditionalItems(wb)

  return {
    site_hint: extractSiteHint(filename),
    source_workbook: filename,
    scopes,
    additional_items,
    warnings,
    errors,
  }
}
