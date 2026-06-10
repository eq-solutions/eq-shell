import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Workbook } from 'exceljs'
import {
  parseWorkbook,
  stripSitePrefix,
  splitJobPlanCode,
  mapFrequencySuffix,
  FREQUENCY_SUFFIX_MAP,
  EXPECTED_HEADERS,
  DATA_SHEET_NAME,
} from '@/lib/import/delta-wo-parser'

const FIXTURE = join(__dirname, 'fixtures', 'WO_Aug_2025_Delta.xlsx')

describe('stripSitePrefix', () => {
  it('strips AU01- prefix', () => {
    expect(stripSitePrefix('AU01-SY3')).toBe('SY3')
  })

  it('strips AU02- prefix (generalises)', () => {
    expect(stripSitePrefix('AU02-ME1')).toBe('ME1')
  })

  it('leaves unprefixed codes alone', () => {
    expect(stripSitePrefix('SY3')).toBe('SY3')
  })

  it('trims whitespace', () => {
    expect(stripSitePrefix('  AU01-SY3  ')).toBe('SY3')
  })

  it('handles empty input', () => {
    expect(stripSitePrefix('')).toBe('')
  })
})

describe('splitJobPlanCode', () => {
  it('splits on the last dash', () => {
    expect(splitJobPlanCode('LVACB-A')).toEqual({ code: 'LVACB', suffix: 'A' })
  })

  it('handles numeric suffixes', () => {
    expect(splitJobPlanCode('ATS-3')).toEqual({ code: 'ATS', suffix: '3' })
  })

  it('keeps multi-part codes intact, only splitting the final suffix', () => {
    expect(splitJobPlanCode('LTNLTNG-AGPRO-A')).toEqual({
      code: 'LTNLTNG-AGPRO',
      suffix: 'A',
    })
  })

  it('returns empty suffix for codes without a dash', () => {
    expect(splitJobPlanCode('UHD')).toEqual({ code: 'UHD', suffix: '' })
  })
})

describe('mapFrequencySuffix', () => {
  it('A → annual', () => {
    expect(mapFrequencySuffix('A')).toBe('annual')
  })

  it('3 → quarterly (3-monthly is quarterly)', () => {
    expect(mapFrequencySuffix('3')).toBe('quarterly')
  })

  it('Q → quarterly', () => {
    expect(mapFrequencySuffix('Q')).toBe('quarterly')
  })

  it('M → monthly', () => {
    expect(mapFrequencySuffix('M')).toBe('monthly')
  })

  it('is case-insensitive', () => {
    expect(mapFrequencySuffix('a')).toBe('annual')
  })

  it('returns null for unknown suffixes (fail-closed per spec)', () => {
    expect(mapFrequencySuffix('XYZ')).toBeNull()
    expect(mapFrequencySuffix('')).toBeNull()
  })

  it('maps all documented suffixes', () => {
    // Smoke — guard against accidental deletions from the map
    expect(Object.keys(FREQUENCY_SUFFIX_MAP)).toEqual(
      expect.arrayContaining(['A', 'Q', 'M', 'S', 'W', '2', '3', '5', '6', '10']),
    )
  })
})

describe('parseWorkbook — WO Aug 2025_Delta.xlsx fixture', () => {
  it('parses exactly 250 rows with zero errors', async () => {
    const buf = readFileSync(FIXTURE)
    const result = await parseWorkbook(buf)

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(250)
  })

  it('groups rows into 16 maintenance checks', async () => {
    const buf = readFileSync(FIXTURE)
    const { groups } = await parseWorkbook(buf)

    expect(groups).toHaveLength(16)
  })

  it('all rows resolve to SY3 after prefix strip', async () => {
    const buf = readFileSync(FIXTURE)
    const { rows } = await parseWorkbook(buf)

    const uniqueSites = new Set(rows.map((r) => r.siteCode))
    expect(uniqueSites).toEqual(new Set(['SY3']))

    // And the raw still has the AU01 prefix
    expect(rows[0].site).toBe('AU01-SY3')
  })

  it('largest group is LVACB annual on 2025-08-20 with 112 assets', async () => {
    const buf = readFileSync(FIXTURE)
    const { groups } = await parseWorkbook(buf)

    const biggest = groups[0] // sort puts biggest first
    expect(biggest.jobPlanCode).toBe('LVACB')
    expect(biggest.frequency).toBe('annual')
    expect(biggest.startDate.toISOString().slice(0, 10)).toBe('2025-08-20')
    expect(biggest.rows).toHaveLength(112)
  })

  it('PDU group has 76 assets on 2025-08-02 (annual transformer round)', async () => {
    const buf = readFileSync(FIXTURE)
    const { groups } = await parseWorkbook(buf)

    const pdu = groups.find(
      (g) => g.jobPlanCode === 'PDU' && g.frequency === 'annual',
    )
    expect(pdu).toBeDefined()
    expect(pdu!.rows).toHaveLength(76)
    expect(pdu!.startDate.toISOString().slice(0, 10)).toBe('2025-08-02')
  })

  it('ATS uses quarterly suffix "3"', async () => {
    const buf = readFileSync(FIXTURE)
    const { rows } = await parseWorkbook(buf)

    const atsRows = rows.filter((r) => r.jobPlanCode === 'ATS')
    expect(atsRows.length).toBeGreaterThan(0)
    for (const r of atsRows) {
      expect(r.frequencySuffix).toBe('3')
      expect(r.frequency).toBe('quarterly')
    }
  })

  it('MVSWBD rows parse (importer will later fuzzy-match to MVSWDB)', async () => {
    const buf = readFileSync(FIXTURE)
    const { rows } = await parseWorkbook(buf)

    const mv = rows.filter((r) => r.jobPlanCode === 'MVSWBD')
    expect(mv.length).toBeGreaterThanOrEqual(1)
    // Parser stays dumb — it emits the code as-is. Fuzzy matching happens
    // in the preview server action against the tenant's job_plans list.
    expect(mv[0].frequency).toBe('annual')
  })

  it('every row has a work order number and a maximo asset id', async () => {
    const buf = readFileSync(FIXTURE)
    const { rows } = await parseWorkbook(buf)

    for (const r of rows) {
      // Work orders in Maximo are numeric strings (e.g. "3962180")
      expect(r.workOrder).toMatch(/^\d+$/)
      // Asset IDs are mostly numeric but may have an alphabetic suffix
      // (e.g. "1746A") — the parser emits the raw Maximo string unchanged.
      expect(r.maximoAssetId).toMatch(/^\d+[A-Za-z]?$/)
    }
  })

  it('expected job plan code coverage (12 distinct codes)', async () => {
    const buf = readFileSync(FIXTURE)
    const { rows } = await parseWorkbook(buf)

    const codes = new Set(rows.map((r) => r.jobPlanCode))
    expect(codes).toEqual(
      new Set([
        'LVACB',
        'PDU',
        'SWBD',
        'LTSWBD',
        'ATS',
        'MVSWBD',
        'EVCS',
        'LBS',
        'LIGHTN',
        'LCP',
        'LB',
        'LIGHTING',
      ]),
    )
  })

  it('group counts match the locked spec', async () => {
    // From project_delta_wo_import.md — the 16 groups and their sizes.
    const expected = [
      { code: 'LVACB', freq: 'annual', date: '2025-08-20', n: 112 },
      { code: 'PDU', freq: 'annual', date: '2025-08-02', n: 76 },
      { code: 'LVACB', freq: 'annual', date: '2025-08-08', n: 17 },
      { code: 'SWBD', freq: 'annual', date: '2025-08-07', n: 14 },
      { code: 'LTSWBD', freq: 'annual', date: '2025-08-07', n: 14 },
      { code: 'SWBD', freq: 'annual', date: '2025-08-20', n: 3 },
      { code: 'ATS', freq: 'quarterly', date: '2025-08-05', n: 2 },
      { code: 'ATS', freq: 'quarterly', date: '2025-08-07', n: 2 },
      { code: 'EVCS', freq: 'annual', date: '2025-08-20', n: 2 },
      { code: 'LBS', freq: 'annual', date: '2025-08-26', n: 2 },
      { code: 'LIGHTN', freq: 'annual', date: '2025-08-07', n: 1 },
      { code: 'LCP', freq: 'quarterly', date: '2025-08-07', n: 1 },
      { code: 'SWBD', freq: 'annual', date: '2025-08-08', n: 1 },
      { code: 'LB', freq: 'annual', date: '2025-08-20', n: 1 },
      { code: 'LIGHTING', freq: 'monthly', date: '2025-08-20', n: 1 },
      { code: 'MVSWBD', freq: 'annual', date: '2025-08-26', n: 1 },
    ]

    const buf = readFileSync(FIXTURE)
    const { groups } = await parseWorkbook(buf)

    for (const exp of expected) {
      const match = groups.find(
        (g) =>
          g.jobPlanCode === exp.code &&
          g.frequency === exp.freq &&
          g.startDate.toISOString().slice(0, 10) === exp.date,
      )
      expect(match, `Missing group ${exp.code}/${exp.freq}/${exp.date}`).toBeDefined()
      expect(match!.rows).toHaveLength(exp.n)
    }
  })

  it('totals — 250 rows across 16 groups, no orphans', async () => {
    const buf = readFileSync(FIXTURE)
    const { rows, groups } = await parseWorkbook(buf)

    const totalInGroups = groups.reduce((sum, g) => sum + g.rows.length, 0)
    expect(totalInGroups).toBe(rows.length)
    expect(totalInGroups).toBe(250)
  })
})

// ── Sheet selection ────────────────────────────────────────────────────
//
// The real-world Maximo export ships a pivot tab (Sheet1) as the active /
// first sheet, with the actual work-order data on a sibling tab named
// "List of Work Orders". The fixture only contains the data tab, so prior
// to 2026-04-19 the parser silently picked the data sheet by index. This
// suite exercises the multi-sheet scenarios using in-memory workbooks.

async function buildBuffer(build: (wb: Workbook) => void): Promise<Buffer> {
  const wb = new Workbook()
  build(wb)
  const ab = await wb.xlsx.writeBuffer()
  return Buffer.from(ab as ArrayBuffer)
}

function writeHeaderedDataSheet(wb: Workbook, name: string) {
  const ws = wb.addWorksheet(name)
  ws.addRow([...EXPECTED_HEADERS])
  ws.addRow([
    'AU01-SY3',
    '3962180',
    'SY3-A1-TPL-01',
    'ELEC \\ TRNSFMR',
    'N',
    'SY3-GF16',
    '1731',
    'PM',
    'INPRG',
    'LVACB-A',
    new Date(Date.UTC(2025, 7, 20)),
    new Date(Date.UTC(2025, 6, 17)),
  ])
}

// ── Equinix Maximo column-shape tolerance ──────────────────────────────
//
// Equinix ships per-classification exports with varying column shapes:
//   - ACB Breaker (14 cols):  adds `CR Required` between Classification
//                             and History; adds `Qualifications Required`
//                             at the end.
//   - HV / LV / PDU (11 cols): omits History entirely.
//
// The parser must resolve cells by header name so it tolerates both
// extra and missing optional columns. REQUIRED_HEADERS must always be
// present.

describe('parseWorkbook — Equinix column-shape variants', () => {
  it('parses an ACB-shaped sheet (14 cols, adds CR Required + Qualifications Required)', async () => {
    const buf = await buildBuffer((wb) => {
      const ws = wb.addWorksheet(DATA_SHEET_NAME)
      ws.addRow([
        'Site', 'Work Order', 'Description', 'Classification',
        'CR Required',                  // extra col, between Classification and History
        'History', 'Location', 'Asset', 'Work Type', 'Status',
        'Job Plan', 'Target Start', 'Reported Date',
        'Qualifications Required',      // extra col at the end
      ])
      ws.addRow([
        'AU01-SY6', '4406940', 'SY6-BLK2-MSB-2-3_ACB-INCOMING MAINS',
        'ELEC \\ BREAKER',
        'N',
        'N', 'SY6-GF-27', '1140', 'PM', 'INPRG',
        'LVACB-A', new Date(Date.UTC(2026, 4, 20)), new Date(Date.UTC(2026, 1, 15)),
        'N',
      ])
    })

    const result = await parseWorkbook(buf)

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      siteCode: 'SY6',
      workOrder: '4406940',
      maximoAssetId: '1140',
      jobPlanCode: 'LVACB',
      frequencySuffix: 'A',
      frequency: 'annual',
      classification: 'ELEC \\ BREAKER',
      location: 'SY6-GF-27',
    })
  })

  it('parses an HV/LV/PDU-shaped sheet (11 cols, no History column)', async () => {
    const buf = await buildBuffer((wb) => {
      const ws = wb.addWorksheet(DATA_SHEET_NAME)
      ws.addRow([
        'Site', 'Work Order', 'Description', 'Classification',
        // History intentionally absent
        'Location', 'Asset', 'Work Type', 'Status',
        'Job Plan', 'Target Start', 'Reported Date',
      ])
      ws.addRow([
        'AU01-SY6', '4385845', 'SY6-HV-DB-A 48VDC BATTERY CHARGER',
        'ELEC \\ BATT-LA',
        'SY6-GF-10', '1008', 'PM', 'INPRG',
        'BTCHGR-Q', new Date(Date.UTC(2026, 4, 11)), new Date(Date.UTC(2026, 1, 15)),
      ])
    })

    const result = await parseWorkbook(buf)

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      siteCode: 'SY6',
      workOrder: '4385845',
      maximoAssetId: '1008',
      jobPlanCode: 'BTCHGR',
      frequencySuffix: 'Q',
      frequency: 'quarterly',
      location: 'SY6-GF-10',
    })
  })

  it('rejects a sheet missing a REQUIRED column (e.g. no Asset)', async () => {
    const buf = await buildBuffer((wb) => {
      const ws = wb.addWorksheet(DATA_SHEET_NAME)
      ws.addRow([
        'Site', 'Work Order', 'Description', 'Classification', 'Location',
        // Asset intentionally absent — required
        'Work Type', 'Status', 'Job Plan', 'Target Start', 'Reported Date',
      ])
      ws.addRow([
        'AU01-SY6', '1', 'desc', 'cls', 'loc', 'PM', 'INPRG',
        'LVACB-A', new Date(Date.UTC(2026, 4, 20)), new Date(),
      ])
    })

    const result = await parseWorkbook(buf)

    // findDataSheet rejects the only sheet because Asset is missing,
    // so the failure is a workbook-level "no data tab" error.
    expect(result.rows).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].rowNumber).toBe(0)
    expect(result.errors[0].message).toMatch(/Could not find the work-order data tab/)
  })

  it('tolerates columns in non-canonical order', async () => {
    const buf = await buildBuffer((wb) => {
      const ws = wb.addWorksheet(DATA_SHEET_NAME)
      // Reorder: Job Plan first, Site last — header lookup must still work
      ws.addRow([
        'Job Plan', 'Asset', 'Work Order', 'Description',
        'Target Start', 'Site',
      ])
      ws.addRow([
        'LVACB-A', '1140', '4406940', 'SY6-BLK2-MSB-2-3_ACB',
        new Date(Date.UTC(2026, 4, 20)), 'AU01-SY6',
      ])
    })

    const result = await parseWorkbook(buf)

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      siteCode: 'SY6',
      jobPlanCode: 'LVACB',
      maximoAssetId: '1140',
    })
  })
})

describe('parseWorkbook — sheet selection', () => {
  it('finds the data tab when an unrelated sheet is first/active', async () => {
    const buf = await buildBuffer((wb) => {
      // Mimic the live Aug 2025 file: pivot first, data tab second.
      const pivot = wb.addWorksheet('Sheet1')
      pivot.addRow([null]) // empty header row — the original failure mode
      pivot.addRow(['Row Labels'])
      pivot.addRow(['LVACB-A'])
      writeHeaderedDataSheet(wb, DATA_SHEET_NAME)
    })

    const result = await parseWorkbook(buf)

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].siteCode).toBe('SY3')
  })

  it('falls back to header scan when DATA_SHEET_NAME is absent', async () => {
    const buf = await buildBuffer((wb) => {
      wb.addWorksheet('Pivot') // empty pivot
      writeHeaderedDataSheet(wb, 'WO Data') // non-standard name, but valid headers
    })

    const result = await parseWorkbook(buf)

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
  })

  it('returns a clear workbook-level error when no sheet has the right headers', async () => {
    const buf = await buildBuffer((wb) => {
      const ws = wb.addWorksheet('Sheet1')
      ws.addRow(['Some', 'Other', 'Spreadsheet'])
      ws.addRow(['1', '2', '3'])
    })

    const result = await parseWorkbook(buf)

    expect(result.rows).toEqual([])
    expect(result.groups).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].rowNumber).toBe(0)
    expect(result.errors[0].message).toMatch(/Could not find the work-order data tab/)
    expect(result.errors[0].message).toContain('"Sheet1"')
  })
})
