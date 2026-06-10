/**
 * Jemena RCD Test Workbook Parser
 *
 * Parses the multi-tab .xlsx that Jemena field technicians fill in
 * during RCD time-trip testing (one tab per board). Emits structured
 * data ready to land in rcd_tests + rcd_test_circuits (migration 0069).
 *
 * Spec: Jemena report study 2026-04-27 + the live 2025 deliverables in
 * OneDrive (e.g. "Cardiff - RCD Test Report (2025).xlsx").
 *
 * Workbook shape:
 *   Each sheet = one board.
 *   Row 1:  RCD TIME TESTING (title)
 *   Row 2:  Date:        | (blank) | <test date>
 *   Row 3:  Site:        | (blank) | <site label, e.g. "Jemena Cardiff">
 *   Row 4:  Location :   | (blank) | <board name, e.g. "DB-1">
 *   Row 5:  Technician Name: | (blank) | <full name>
 *   Row 6:  optional sub-section header (e.g. "Lighting Section")
 *   Row 7:  column headers row 1
 *   Row 8:  column headers row 2 (0deg / 180deg sub-headers)
 *   Row 9+: per-circuit data rows; section sub-headers may appear inline
 *   Footer: "Technician Signature: AH" + "Site Signature:"
 *
 * Per-circuit columns:
 *   A  Date of Test
 *   B  Circuit NO
 *   C  Normal Trip Current mA
 *   D  X1 No-Trip 0deg ms
 *   E  X1 No-Trip 180deg ms
 *   F  X1 Trip 0deg ms
 *   G  X1 Trip 180deg ms
 *   H  X5 Fast 0deg ms
 *   I  X5 Fast 180deg ms
 *   J  Trip Test Button (mark or blank)
 *   K  Asset ID (per-circuit Jemena ID, e.g. "30248")
 *   L  Action Taken for Unsatisfactory Results
 *   M  Name of Licence Holder
 *   N  Signature
 *
 * No DB access, no React — pure parsing. Safe to run in a server action
 * or a unit test.
 */

import { Workbook, Worksheet } from 'exceljs'

// ── Types ───────────────────────────────────────────────────────────

export interface ParsedJemenaRcdCircuit {
  rowNumber: number
  sectionLabel: string | null
  testDate: Date | null
  circuitNo: string
  normalTripCurrentMa: number
  x1NoTrip0Ms: string | null
  x1NoTrip180Ms: string | null
  x1Trip0Ms: string | null
  x1Trip180Ms: string | null
  x5Fast0Ms: string | null
  x5Fast180Ms: string | null
  tripTestButtonOk: boolean
  jemenaCircuitAssetId: string | null
  actionTaken: string | null
  technicianName: string | null
  signature: string | null
}

export interface ParsedJemenaRcdTest {
  tabName: string
  boardName: string
  siteLabel: string
  testDate: Date | null
  technicianName: string
  technicianInitials: string
  siteSignatureInitials: string
  circuits: ParsedJemenaRcdCircuit[]
}

export interface ParseError {
  tabName: string
  rowNumber: number
  message: string
}

export interface JemenaRcdParseResult {
  tests: ParsedJemenaRcdTest[]
  errors: ParseError[]
  skippedSheets: { tabName: string; reason: string }[]
}

// ── Parser ──────────────────────────────────────────────────────────

const EXPECTED_TITLE = 'rcd time testing'
const HEADER_KEYS = {
  DATE: /^date\s*:?$/i,
  SITE: /^site\s*:?$/i,
  LOCATION: /^location\s*:?$/i,
  TECH: /^technician\s+name\s*:?$/i,
}

export async function parseJemenaRcdWorkbook(
  buffer: Buffer | ArrayBuffer,
): Promise<JemenaRcdParseResult> {
  const wb = new Workbook()
  await wb.xlsx.load(buffer as ArrayBuffer)

  const tests: ParsedJemenaRcdTest[] = []
  const errors: ParseError[] = []
  const skippedSheets: { tabName: string; reason: string }[] = []

  wb.eachSheet((ws) => {
    const result = parseSheet(ws)
    if ('skipped' in result) {
      skippedSheets.push({ tabName: ws.name, reason: result.skipped })
      return
    }
    tests.push(result.test)
    for (const e of result.errors) errors.push(e)
  })

  return { tests, errors, skippedSheets }
}

interface SheetParseResult {
  test: ParsedJemenaRcdTest
  errors: ParseError[]
}
interface SheetSkipped {
  skipped: string
}

function parseSheet(ws: Worksheet): SheetParseResult | SheetSkipped {
  const titleCell = readCellText(ws, 1, 1)
  if (titleCell.toLowerCase() !== EXPECTED_TITLE) {
    return { skipped: `row 1 not "RCD TIME TESTING" (got "${titleCell || '<empty>'}")` }
  }

  let testDate: Date | null = null
  let siteLabel = ''
  let boardName = ''
  let technicianName = ''
  for (let r = 2; r <= 7; r++) {
    const key = readCellText(ws, r, 1)
    const value = readCellAny(ws, r, 3)
    if (HEADER_KEYS.DATE.test(key)) testDate = coerceDate(value)
    else if (HEADER_KEYS.SITE.test(key)) siteLabel = String(value ?? '').trim()
    else if (HEADER_KEYS.LOCATION.test(key)) boardName = String(value ?? '').trim()
    else if (HEADER_KEYS.TECH.test(key)) technicianName = String(value ?? '').trim()
  }

  if (!boardName) {
    return { skipped: `no "Location :" row found in first 7 rows` }
  }

  let headerRow = 0
  for (let r = 6; r <= 12; r++) {
    const colB = readCellText(ws, r, 2)
    if (colB.toLowerCase() === 'circuit no') {
      headerRow = r
      break
    }
  }
  if (!headerRow) {
    return { skipped: `couldn't find column-header row (Circuit NO) in rows 6-12` }
  }

  const dataStartRow = headerRow + 2

  const circuits: ParsedJemenaRcdCircuit[] = []
  const errors: ParseError[] = []
  let currentSection: string | null = null
  let consecutiveEmpty = 0
  let technicianInitials = ''
  let siteSignatureInitials = ''

  for (let r = dataStartRow; r <= ws.rowCount + 1; r++) {
    const colA = readCellAny(ws, r, 1)
    const colATxt = String(colA ?? '').trim()
    const colB = readCellAny(ws, r, 2)
    const colBTxt = String(colB ?? '').trim()
    const colALower = colATxt.toLowerCase()

    if (colALower.startsWith('technician signature') || colALower.startsWith('technician sig')) {
      technicianInitials = colATxt.split(':').slice(1).join(':').trim()
      for (let r2 = r; r2 <= Math.min(r + 6, ws.rowCount); r2++) {
        const t = readCellText(ws, r2, 1).toLowerCase()
        if (t.startsWith('site signature')) {
          siteSignatureInitials = readCellText(ws, r2, 1).split(':').slice(1).join(':').trim()
        }
      }
      break
    }
    if (colALower.startsWith('site signature')) {
      siteSignatureInitials = colATxt.split(':').slice(1).join(':').trim()
      continue
    }

    if (!colA && (colBTxt === 'Lighting Section' || colBTxt === 'Power Section')) {
      currentSection = colBTxt
      continue
    }
    if (colATxt === 'Lighting Section' || colATxt === 'Power Section') {
      currentSection = colATxt
      continue
    }

    const allEmpty = !colA && !colB && isRowEmpty(ws, r, 14)
    if (allEmpty) {
      consecutiveEmpty++
      if (consecutiveEmpty >= 5) break
      continue
    }
    consecutiveEmpty = 0

    if (colBTxt.toLowerCase() === 'circuit no') continue
    if (
      colATxt === '' &&
      (readCellText(ws, r, 4).startsWith('0') || readCellText(ws, r, 4).includes('ms'))
    ) {
      continue
    }

    const circuitNo = colBTxt
    if (!circuitNo) {
      errors.push({
        tabName: ws.name,
        rowNumber: r,
        message: `data row missing circuit number (col B)`,
      })
      continue
    }

    const tripCurrentRaw = readCellAny(ws, r, 3)
    const normalTripCurrentMa = coerceTripCurrent(tripCurrentRaw)

    circuits.push({
      rowNumber: r,
      sectionLabel: currentSection,
      testDate: coerceDate(colA) ?? testDate,
      circuitNo,
      normalTripCurrentMa,
      x1NoTrip0Ms: nullableText(readCellAny(ws, r, 4)),
      x1NoTrip180Ms: nullableText(readCellAny(ws, r, 5)),
      x1Trip0Ms: nullableText(readCellAny(ws, r, 6)),
      x1Trip180Ms: nullableText(readCellAny(ws, r, 7)),
      x5Fast0Ms: nullableText(readCellAny(ws, r, 8)),
      x5Fast180Ms: nullableText(readCellAny(ws, r, 9)),
      tripTestButtonOk: hasNonEmptyMark(readCellAny(ws, r, 10)),
      jemenaCircuitAssetId: nullableText(readCellAny(ws, r, 11)),
      actionTaken: nullableText(readCellAny(ws, r, 12)),
      technicianName: nullableText(readCellAny(ws, r, 13)),
      signature: nullableText(readCellAny(ws, r, 14)),
    })
  }

  return {
    test: {
      tabName: ws.name,
      boardName,
      siteLabel,
      testDate,
      technicianName,
      technicianInitials,
      siteSignatureInitials,
      circuits,
    },
    errors,
  }
}

// ── Cell helpers ─────────────────────────────────────────────────────

function readCellAny(ws: Worksheet, row: number, col: number): unknown {
  const cell = ws.getRow(row).getCell(col)
  if (!cell) return null
  const v = cell.value
  if (v == null) return null
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray((v as { richText?: unknown }).richText)) {
      return (v as { richText: { text: string }[] }).richText
        .map((t) => t.text)
        .join('')
    }
    if ('result' in v) return (v as { result: unknown }).result
    if ('text' in v) return (v as { text: string }).text
    if (v instanceof Date) return v
  }
  return v
}

function readCellText(ws: Worksheet, row: number, col: number): string {
  const v = readCellAny(ws, row, col)
  if (v == null) return ''
  return String(v).trim()
}

function isRowEmpty(ws: Worksheet, row: number, maxCol: number): boolean {
  for (let c = 1; c <= maxCol; c++) {
    const v = readCellAny(ws, row, c)
    if (v != null && String(v).trim() !== '') return false
  }
  return true
}

function nullableText(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function hasNonEmptyMark(v: unknown): boolean {
  if (v == null) return false
  const s = String(v).trim()
  return s !== '' && s !== '0' && s !== 'N/A' && s.toLowerCase() !== 'no'
}

function coerceDate(v: unknown): Date | null {
  if (v == null) return null
  if (v instanceof Date) return v
  if (typeof v === 'number') {
    const ms = (v - 25569) * 86400 * 1000
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return null
    return d
  }
  if (typeof v === 'string') {
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return null
    return d
  }
  return null
}

function coerceTripCurrent(v: unknown): number {
  if (v == null) return 30
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  const s = String(v).trim()
  const m = s.match(/^(\d+)/)
  if (!m) return 30
  return parseInt(m[1], 10)
}
