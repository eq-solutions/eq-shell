/**
 * NSX Test Report — DOCX Generator
 *
 * Produces a per-site MCCB/NSX test report:
 *   Cover → TOC → per-breaker sections (CB details, visual checks,
 *   electrical testing, trip test results).
 *
 * Simpler structure than ACB — no racking, fewer visual checks.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  WidthType,
  ShadingType,
  PageBreak,
  TableOfContents,
  Bookmark,
  VerticalAlign,
  ImageRun,
} from 'docx'
import { buildMasthead } from '@/lib/reports/report-branding'
import {
  buildHeader as buildShellHeader,
  buildFooter as buildShellFooter,
  prepareShell,
  resolveShellSettings,
} from '@/lib/reports/report-shell'
import { FONT_BODY } from '@/lib/reports/typography'
import { EQ_MID_GREY, EQ_BORDER, EQ_ICE, EQ_INK, tenantIce } from '@/lib/reports/colours'

// ---------- types ----------

/**
 * Tenant palette overrides — supplied by the route from
 * tenant_settings.deep_colour / ice_colour / ink_colour. When present,
 * the generator uses these explicit values instead of deriving from
 * primaryColour. See lib/reports/colours.ts::tenantIce for resolution.
 */
export interface TenantPaletteOverrides {
  deepColour?: string | null
  iceColour?: string | null
  inkColour?: string | null
}

export interface NsxReportInput extends TenantPaletteOverrides {
  siteName: string
  siteCode: string | null
  tenantProductName: string
  primaryColour: string
  complexity?: 'summary' | 'standard' | 'detailed'
  tests: NsxReportTest[]
  reportTypeLabel?: string        // Phase 1: report type for masthead

  // Report settings (optional — all generators now read these)
  /** @deprecated Pass `logoImageOnLight` / `logoImageOnDark` instead. */
  logoImage?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  logoImageOnLight?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  logoImageOnDark?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }

  /** Customer logo variants (rendered on cover when present). */
  customerLogoOnLight?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  customerLogoOnDark?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  customerName?: string

  companyName?: string
  companyAddress?: string
  companyAbn?: string
  companyPhone?: string
  showCoverPage?: boolean
  showContents?: boolean
  showExecutiveSummary?: boolean
  showSignOff?: boolean
  customHeaderText?: string
  customFooterText?: string
  signOffFields?: string[]
}

export interface NsxReportTest {
  assetName: string
  assetType: string
  location: string | null
  assetId: string | null
  testDate: string
  testedBy: string | null
  testType: string
  cbMake: string | null
  cbModel: string | null
  cbSerial: string | null
  cbRating: string | null
  cbPoles: string | null
  tripUnit: string | null
  overallResult: string
  notes: string | null
  readings: NsxReportReading[]
}

export interface NsxReportReading {
  label: string
  value: string
  unit: string | null
  isPass: boolean | null
  sortOrder: number
}

// ---------- constants ----------

const PAGE_WIDTH = 11906
const PAGE_HEIGHT = 16838
const MARGIN = 1440
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: EQ_BORDER }
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
const CELL_MARGINS = { top: 60, bottom: 60, left: 100, right: 100 }

// Per-render header fill — set once at the top of generateNsxReport from
// tenantIce(primaryColour, iceColour). Builder functions and headerCell
// read this instead of hardcoded EQ_ICE so SKS reports get SKS-flavoured
// table headers without threading `fill` through every builder.
//
// Trade-off: assumes one render per Node process at a time. Two concurrent
// renders for different tenants could race on this value and produce a
// cosmetic mismatch (one tenant's table headers in another tenant's ice).
// Acceptable for current scale; revisit if/when concurrent generation is
// a real workload.
let _activeIce: string = EQ_ICE

// CB detail attributes (left, right)
const CB_ATTR_ROWS: [string, string][] = [
  ['Brand', 'Trip Unit'],
  ['Model', 'Current Rating'],
  ['Serial No', 'Number of Poles'],
  ['Breaker Type', 'Fixed / Withdrawable'],
  ['Performance Level', 'Long Time - Ir'],
  ['Protection Unit Fitted', 'Long Time Delay - tr'],
  ['Short-Time Pickup - Isd', 'Instantaneous Pickup - Ii'],
  ['Earth-Fault Pickup - Ig', 'Earth-Leakage Tripping Delay'],
]

// Visual/functional checklist for MCCB
const VF_CHECKLIST: { name: string; section: string }[] = [
  { name: 'General Condition', section: 'Visual Inspection' },
  { name: 'Condition of connection pads', section: 'Visual Inspection' },
  { name: 'Main contact wear indicator', section: 'Visual Inspection' },
  { name: 'Condition of the ARC chute', section: 'Visual Inspection' },
  { name: 'Connection pads cleaning', section: 'Mechanical' },
  { name: 'Manual trip test', section: 'Functional Check' },
  { name: 'Manual close test', section: 'Functional Check' },
  { name: 'Manual open test', section: 'Functional Check' },
  { name: 'OF/SD auxiliary contact check', section: 'Functional Check' },
  { name: 'Shunt trip (MX) test', section: 'Functional Check' },
  { name: 'Undervoltage (MN) test', section: 'Functional Check' },
  { name: 'Motor operator test', section: 'Functional Check' },
  { name: 'Pull test on auxiliary wiring', section: 'Auxiliaries' },
  { name: 'Apply service sticker', section: 'Completion' },
  { name: 'Connection pads greasing', section: 'Completion' },
  { name: 'Additional information / items to be actioned', section: 'Overall' },
]

// Display labels shown in the report; storage keys are the short codes saved by
// the workflow (Contact Resistance Red/White/Blue/Neutral; IR Closed R-W, R-B, …;
// IR Open R-R, W-W, B-B, N-N).
const ET_CONTACT_PHASES: Array<{ display: string; key: string }> = [
  { display: 'Red Phase', key: 'Contact Resistance Red' },
  { display: 'White Phase', key: 'Contact Resistance White' },
  { display: 'Blue Phase', key: 'Contact Resistance Blue' },
  { display: 'Neutral', key: 'Contact Resistance Neutral' },
]
const ET_IR_CLOSED: Array<{ display: string; key: string }> = [
  { display: 'Red > White', key: 'IR Closed R-W' },
  { display: 'Red > Blue', key: 'IR Closed R-B' },
  { display: 'White > Blue', key: 'IR Closed W-B' },
  { display: 'Red > Earth', key: 'IR Closed R-E' },
  { display: 'White > Earth', key: 'IR Closed W-E' },
  { display: 'Blue > Earth', key: 'IR Closed B-E' },
  { display: 'Red > Neutral', key: 'IR Closed R-N' },
  { display: 'White > Neutral', key: 'IR Closed W-N' },
  { display: 'Blue > Neutral', key: 'IR Closed B-N' },
]
const ET_IR_OPEN: Array<{ display: string; key: string }> = [
  { display: 'Red > Red', key: 'IR Open R-R' },
  { display: 'White > White', key: 'IR Open W-W' },
  { display: 'Blue > Blue', key: 'IR Open B-B' },
  { display: 'Neutral > Neutral', key: 'IR Open N-N' },
]

const TRIP_TEST_ROWS = ['Long time', 'Short time', 'Instantaneous', 'Earth fault']

// ---------- helpers ----------

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: _activeIce, type: ShadingType.CLEAR },
    margins: CELL_MARGINS,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, font: FONT_BODY })] })],
  })
}

function cell(text: string, width: number, opts?: { bold?: boolean; shading?: string }): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: opts?.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: CELL_MARGINS,
    children: [new Paragraph({ children: [new TextRun({ text: text || '', bold: opts?.bold, size: 18, font: FONT_BODY })] })],
  })
}

function passFailText(val: boolean | null): string {
  if (val === true) return 'Pass'
  if (val === false) return 'Fail'
  return 'N/A'
}

function formatDateDDMMYYYY(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    return `${dd}/${mm}/${yyyy}`
  } catch {
    return dateStr
  }
}

/** Look up a reading value by label (case-insensitive).
 *  Strips the stored category prefix (`Electrical:`, `Visual:`, `Collection:`)
 *  before comparing, so callers can pass raw labels without worrying about
 *  namespacing. Falls back to exact match, then startsWith. */
function findReading(readings: NsxReportReading[], label: string): NsxReportReading | undefined {
  const target = label.toLowerCase().trim()
  const stripPrefix = (s: string): string =>
    s.toLowerCase().replace(/^(electrical|visual|collection):\s*/, '').trim()
  return (
    readings.find((r) => stripPrefix(r.label) === target) ??
    readings.find((r) => r.label.toLowerCase() === target) ??
    readings.find((r) => stripPrefix(r.label).startsWith(target)) ??
    readings.find((r) => r.label.toLowerCase().startsWith(target))
  )
}

function cbAttrValue(test: NsxReportTest, attrName: string): string {
  const a = attrName.toLowerCase()
  if (a === 'brand') return test.cbMake ?? ''
  if (a === 'model') return test.cbModel ?? ''
  if (a === 'serial no') return test.cbSerial ?? ''
  if (a === 'current rating') return test.cbRating ?? ''
  if (a === 'number of poles') return test.cbPoles ?? ''
  if (a === 'trip unit') return test.tripUnit ?? ''
  const rdg = findReading(test.readings, attrName)
  return rdg ? rdg.value : ''
}

// ---------- section builders ----------

function buildHeaderTable(test: NsxReportTest, siteName: string): Table {
  const c1 = 1200
  const c2 = 3313
  const c3 = 900
  const c4 = 3613
  const totalW = c1 + c2 + c3 + c4

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4],
    rows: [
      new TableRow({
        children: [
          cell('Site', c1, { bold: true, shading: _activeIce }),
          cell(siteName, c2),
          cell('Asset', c3, { bold: true, shading: _activeIce }),
          cell(test.assetName, c4),
        ],
      }),
      new TableRow({
        children: [
          cell('Location', c1, { bold: true, shading: _activeIce }),
          cell(test.location ?? '', c2),
          cell('ID', c3, { bold: true, shading: _activeIce }),
          cell(test.assetId ?? '', c4),
        ],
      }),
    ],
  })
}

function buildCbDetailsTable(test: NsxReportTest): Table {
  const c1 = 2400
  const c2 = 1800
  const c3 = 2600
  const c4 = 2226
  const totalW = c1 + c2 + c3 + c4

  const rows = CB_ATTR_ROWS.map(
    ([leftAttr, rightAttr]) =>
      new TableRow({
        children: [
          cell(leftAttr, c1, { bold: true }),
          cell(cbAttrValue(test, leftAttr), c2),
          cell(rightAttr, c3, { bold: true }),
          cell(cbAttrValue(test, rightAttr), c4),
        ],
      }),
  )

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4],
    rows: [
      new TableRow({
        children: [
          headerCell('Attribute', c1),
          headerCell('Value', c2),
          headerCell('Attribute', c3),
          headerCell('Value', c4),
        ],
      }),
      ...rows,
    ],
  })
}

function buildVisualChecklistTable(test: NsxReportTest): Table {
  const c1 = 4000
  const c2 = 2200
  const c3 = 1000
  const c4 = 1826
  const totalW = c1 + c2 + c3 + c4

  const rows = VF_CHECKLIST.map((item) => {
    const rdg = findReading(test.readings, item.name)
    return new TableRow({
      children: [
        cell(item.name, c1),
        cell(item.section, c2),
        cell(rdg ? passFailText(rdg.isPass) : '', c3),
        cell(rdg && rdg.value !== passFailText(rdg.isPass) ? rdg.value : '', c4),
      ],
    })
  })

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4],
    rows: [
      new TableRow({
        children: [
          headerCell('Check Item', c1),
          headerCell('Section', c2),
          headerCell('Result', c3),
          headerCell('Comment', c4),
        ],
      }),
      ...rows,
    ],
  })
}

function buildElectricalTestingSection(test: NsxReportTest): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text: `${test.assetName} - Electrical Testing`, bold: true, size: 22, font: FONT_BODY })],
  }))

  // Contact Resistance (4 cols: Red, White, Blue, Neutral)
  const contactColW = Math.floor(CONTENT_WIDTH / 4)
  children.push(new Paragraph({
    spacing: { before: 120, after: 60 },
    children: [new TextRun({ text: 'Main Contact Resistance \u2014 All results in MicroOhms', bold: true, size: 18, font: FONT_BODY })],
  }))

  children.push(new Table({
    width: { size: contactColW * 4, type: WidthType.DXA },
    columnWidths: [contactColW, contactColW, contactColW, contactColW],
    rows: [
      new TableRow({
        children: ET_CONTACT_PHASES.map((p) => headerCell(p.display, contactColW)),
      }),
      new TableRow({
        children: ET_CONTACT_PHASES.map((phase) => {
          const rdg = findReading(test.readings, phase.key)
          return cell(rdg ? rdg.value : '', contactColW)
        }),
      }),
    ],
  }))

  // IR Closed (3 cols × 3 rows = 9 combos)
  const irColW = Math.floor(CONTENT_WIDTH / 3)
  children.push(new Paragraph({
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text: 'Insulation Resistance - Closed', bold: true, size: 18, font: FONT_BODY })],
  }))

  const irClosedRows: TableRow[] = []
  for (let row = 0; row < 3; row++) {
    const rowCells = [0, 1, 2].map((col) => {
      const combo = ET_IR_CLOSED[row * 3 + col]
      if (!combo) return cell('', irColW)
      const rdg = findReading(test.readings, combo.key)
      return cell(`${combo.display}: ${rdg ? rdg.value : ''}`, irColW)
    })
    irClosedRows.push(new TableRow({ children: rowCells }))
  }

  children.push(new Table({
    width: { size: irColW * 3, type: WidthType.DXA },
    columnWidths: [irColW, irColW, irColW],
    rows: irClosedRows,
  }))

  // IR Open (4 cols × 1 row: R-R, W-W, B-B, N-N)
  const irOpenColW = Math.floor(CONTENT_WIDTH / 4)
  children.push(new Paragraph({
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text: 'Insulation Resistance - Open', bold: true, size: 18, font: FONT_BODY })],
  }))

  const irOpenRow = new TableRow({
    children: ET_IR_OPEN.map((combo) => {
      const rdg = findReading(test.readings, combo.key)
      return cell(`${combo.display}: ${rdg ? rdg.value : ''}`, irOpenColW)
    }),
  })

  children.push(new Table({
    width: { size: irOpenColW * 4, type: WidthType.DXA },
    columnWidths: [irOpenColW, irOpenColW, irOpenColW, irOpenColW],
    rows: [irOpenRow],
  }))

  return children
}

function buildTripTestTable(test: NsxReportTest): Table {
  const c1 = 1500
  const c2 = 1700
  const c3 = 1400
  const c4 = 1500
  const c5 = 1500
  const c6 = 1426
  const totalW = c1 + c2 + c3 + c4 + c5 + c6

  const rows = TRIP_TEST_ROWS.map((protection) => {
    const rdg = findReading(test.readings, `Trip ${protection}`) ?? findReading(test.readings, protection)
    return new TableRow({
      children: [
        cell(protection, c1, { bold: true }),
        cell(rdg?.value ?? '', c2),
        cell('', c3),
        cell('', c4),
        cell('', c5),
        cell(rdg ? passFailText(rdg.isPass) : 'N/A', c6),
      ],
    })
  })

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4, c5, c6],
    rows: [
      new TableRow({
        children: [
          headerCell('Protection', c1),
          headerCell('Current Levels (A)', c2),
          headerCell('Trip Time (s)', c3),
          headerCell('Min trip time', c4),
          headerCell('Max trip time', c5),
          headerCell('Pass / Fail', c6),
        ],
      }),
      ...rows,
    ],
  })
}

// ---------- per-breaker section ----------

function buildBreakerSection(test: NsxReportTest, siteName: string, index: number, complexity: 'summary' | 'standard' | 'detailed' = 'standard'): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []
  const label = test.assetName

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: index > 0,
    children: [
      new Bookmark({
        id: `breaker_${index}`,
        children: [new TextRun({ text: label, bold: true, size: 28, font: FONT_BODY })],
      }),
    ],
  }))

  children.push(buildHeaderTable(test, siteName))
  children.push(new Paragraph({ spacing: { before: 80 } }))

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: `${label} - Circuit Breaker Details`, bold: true, size: 24, font: FONT_BODY })],
  }))
  children.push(buildCbDetailsTable(test))
  children.push(new Paragraph({ spacing: { before: 80 } }))

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: `${label} - Visual / Functional Checks`, bold: true, size: 24, font: FONT_BODY })],
  }))
  children.push(buildVisualChecklistTable(test))
  children.push(new Paragraph({ spacing: { before: 80 } }))

  children.push(...buildElectricalTestingSection(test))
  children.push(new Paragraph({ spacing: { before: 80 } }))

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text: `${label} - Trip Test Results`, bold: true, size: 24, font: FONT_BODY })],
  }))
  children.push(buildTripTestTable(test))

  // Detailed: include notes
  if (complexity === 'detailed' && test.notes) {
    children.push(new Paragraph({ spacing: { before: 120 } }))
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `${label} - Notes & Commentary`, bold: true, size: 24, font: FONT_BODY })],
    }))
    children.push(new Paragraph({
      spacing: { before: 60 },
      children: [new TextRun({ text: test.notes, size: 20, font: FONT_BODY })],
    }))
  }

  return children
}

// ---------- summary table (for summary complexity) ----------

function buildSummaryTable(input: NsxReportInput): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: 'Test Results Summary', bold: true, size: 28, font: FONT_BODY })],
  }))
  children.push(new Paragraph({
    spacing: { before: 60, after: 120 },
    children: [new TextRun({ text: `${input.tests.length} circuit breakers tested at ${input.siteName}`, size: 20, font: FONT_BODY, color: EQ_MID_GREY })],
  }))

  const total = input.tests.length
  const passed = input.tests.filter(t => t.overallResult === 'Pass').length
  const failed = input.tests.filter(t => t.overallResult === 'Fail').length
  const defect = input.tests.filter(t => t.overallResult === 'Defect').length

  children.push(new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [Math.floor(CONTENT_WIDTH / 4), Math.floor(CONTENT_WIDTH / 4), Math.floor(CONTENT_WIDTH / 4), CONTENT_WIDTH - Math.floor(CONTENT_WIDTH / 4) * 3],
    rows: [
      new TableRow({
        children: [
          kpiCell('Total', String(total), 'EAF5FB'),
          kpiCell('Pass', String(passed), 'DCFCE7'),
          kpiCell('Fail', String(failed), failed > 0 ? 'FEE2E2' : 'F3F4F6'),
          kpiCell('Defect', String(defect), defect > 0 ? 'FEF3C7' : 'F3F4F6'),
        ],
      }),
    ],
  }))

  children.push(new Paragraph({ spacing: { before: 200 } }))

  const colWidths = [3000, 1500, 1200, 1000, 1200, 1126]
  const headerRow = new TableRow({
    children: ['Asset', 'Make / Model', 'Rating', 'Date', 'Result', 'Tested By'].map((text, ci) =>
      new TableCell({
        borders: BORDERS,
        width: { size: colWidths[ci], type: WidthType.DXA },
        margins: CELL_MARGINS,
        shading: { fill: 'F3F4F6', type: ShadingType.CLEAR },
        children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, font: FONT_BODY })] })],
      })
    ),
  })

  const dataRows = input.tests.map(t => {
    const resultColour = t.overallResult === 'Pass' ? 'DCFCE7' : t.overallResult === 'Fail' ? 'FEE2E2' : t.overallResult === 'Defect' ? 'FEF3C7' : 'FFFFFF'
    return new TableRow({
      children: [
        textCell(t.assetName, colWidths[0]),
        textCell([t.cbMake, t.cbModel].filter(Boolean).join(' ') || '—', colWidths[1]),
        textCell(t.cbRating ?? '—', colWidths[2]),
        textCell(fmtDate(t.testDate), colWidths[3]),
        new TableCell({
          borders: BORDERS,
          width: { size: colWidths[4], type: WidthType.DXA },
          margins: CELL_MARGINS,
          shading: { fill: resultColour, type: ShadingType.CLEAR },
          children: [new Paragraph({ children: [new TextRun({ text: t.overallResult, bold: true, size: 18, font: FONT_BODY })] })],
        }),
        textCell(t.testedBy ?? '—', colWidths[5]),
      ],
    })
  })

  children.push(new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows],
  }))

  return children
}

function kpiCell(label: string, value: string, fill: string): TableCell {
  return new TableCell({
    borders: BORDERS,
    margins: { top: 120, bottom: 120, left: 160, right: 160 },
    shading: { fill, type: ShadingType.CLEAR },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: value, bold: true, size: 36, font: FONT_BODY })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: label, size: 16, font: FONT_BODY, color: EQ_MID_GREY })],
      }),
    ],
  })
}

function textCell(text: string, width: number): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    margins: CELL_MARGINS,
    children: [new Paragraph({ children: [new TextRun({ text, size: 18, font: FONT_BODY })] })],
  })
}

function fmtDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return d }
}

// ---------- main export ----------

export async function generateNsxReport(input: NsxReportInput): Promise<Buffer> {
  const brand = input.primaryColour.replace('#', '')
  // Set the per-render header fill from the tenant palette. Read by
  // headerCell() and the cell shading literals throughout this file.
  // See _activeIce comment near top of file for trade-offs.
  _activeIce = tenantIce(input.primaryColour, input.iceColour)
  const complexity = input.complexity ?? 'standard'
  const showCover = input.showCoverPage ?? true
  const showContents = input.showContents ?? true
  const year = new Date().getFullYear()
  const today = formatDateDDMMYYYY(new Date().toISOString())
  const footerText = input.customFooterText || `${input.companyName || input.tenantProductName} — NSX Test Report — rev 3.1`

  // Sprint 2.3 (26-Apr-2026): adopt shared ReportShell for header/footer.
  // See compliance-report.ts for the canonical worked example.
  const shell = await prepareShell(
    resolveShellSettings({
      companyName: input.companyName ?? input.tenantProductName,
      productName: input.tenantProductName,
      primaryColour: input.primaryColour,
      complexity,
      headerText: input.customHeaderText ?? `${input.siteName} — NSX / MCCB Test Report`,
      footerText,
    }),
    {
      reportType: 'nsx_test',
      reportDate: today,
      customerName: input.companyName ?? null,
      siteName: input.siteName,
      siteAddress: null,
      customerLogoUrl: null,
      sitePhotoUrl: null,
    },
  )

  const coverLogo = input.logoImageOnLight ?? input.logoImage ?? input.logoImageOnDark
  const customerLogo = input.customerLogoOnLight ?? input.customerLogoOnDark

  const coverChildren: (Paragraph | Table)[] = []

  // Masthead with customer + tenant logos (Phase 1 branding update)
  if (customerLogo || coverLogo || input.reportTypeLabel) {
    coverChildren.push(
      buildMasthead({
        customerLogo: customerLogo ?? undefined,
        tenantLogo: coverLogo ?? undefined,
        reportTypeLabel: input.reportTypeLabel || 'NSX Test Report',
      }),
    )
  }

  if (coverLogo && !input.reportTypeLabel) {
    coverChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2000, after: 400 },
      children: [new ImageRun({
        type: coverLogo.type,
        data: coverLogo.data,
        transformation: { width: coverLogo.width, height: coverLogo.height },
        altText: { title: 'Company Logo', description: 'Company logo', name: 'company-logo' },
      })],
    }))
  }

  coverChildren.push(
    new Paragraph({ spacing: { before: coverLogo ? 800 : 4000 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({
        text: `${input.siteName} - NSX / MCCB Test List - ${year}`,
        bold: true,
        size: 52,
        font: FONT_BODY,
        color: brand,
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({
        text: `Report Generated: ${today}`,
        italics: true,
        size: 24,
        font: FONT_BODY,
        color: EQ_MID_GREY,
      })],
    }),
    new Paragraph({ spacing: { before: 2000 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: input.siteName,
        bold: true,
        size: 36,
        font: FONT_BODY,
      })],
    }),
    new Paragraph({ spacing: { before: 3000 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: input.tenantProductName,
        size: 20,
        font: FONT_BODY,
        color: EQ_MID_GREY,
      })],
    }),
  )

  const tocChildren: (Paragraph | Table | TableOfContents)[] = (showContents && complexity !== 'summary') ? [
    new Paragraph({ children: [new PageBreak()] }),
    new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }),
    new Paragraph({ children: [new PageBreak()] }),
  ] : []

  const breakerChildren: (Paragraph | Table)[] = []
  if (complexity === 'summary') {
    breakerChildren.push(...buildSummaryTable(input))
  } else {
    input.tests.forEach((test, i) => {
      breakerChildren.push(...buildBreakerSection(test, input.siteName, i, complexity))
    })
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT_BODY, size: 20 } },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: FONT_BODY, color: brand },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: FONT_BODY, color: brand },
          paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 22, bold: true, font: FONT_BODY, color: EQ_INK },
          paragraph: { spacing: { before: 120, after: 80 }, outlineLevel: 2 },
        },
      ],
    },
    sections: [
      ...(showCover ? [{
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        children: coverChildren,
      }] : []),
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        headers: { default: buildShellHeader(shell) },
        footers: { default: buildShellFooter(shell) },
        children: [...tocChildren, ...breakerChildren],
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  return buffer as Buffer
}
