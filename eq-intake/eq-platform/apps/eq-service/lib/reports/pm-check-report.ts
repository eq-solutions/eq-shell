/**
 * PM Check Report — DOCX Generator
 *
 * Produces a preventive maintenance check report with:
 * - Cover page with check info
 * - Check summary table
 * - Check items table with results
 * - Pass/fail statistics
 * - White-label branding
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
  VerticalAlign,
  ImageRun,
  convertInchesToTwip,
} from 'docx'
import { buildMasthead } from '@/lib/reports/report-branding'
import {
  buildHeader as buildShellHeader,
  buildFooter as buildShellFooter,
  prepareShell,
  resolveShellSettings,
} from '@/lib/reports/report-shell'
import { FONT_BODY } from '@/lib/reports/typography'
import { EQ_MID_GREY, EQ_BORDER, EQ_ICE, tenantIce } from '@/lib/reports/colours'

// ---------- types ----------

export interface PmCheckReportInput {
  checkId: string
  siteName: string
  jobPlanName: string
  checkDate: string
  dueDate: string
  startedAt: string | null
  completedAt: string | null
  status: string
  assignedTo: string | null
  tenantProductName: string
  primaryColour: string // hex without #
  items: PmCheckReportItem[]

  // Phase 1 branding updates
  companyName?: string
  tenantLogoImage?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number } | null
  customerLogoImage?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number } | null
  reportTypeLabel?: string
  maximoWONumber?: string | null

  // Tenant palette overrides (from tenant_settings).
  // When supplied, table-header tints use the explicit ice colour instead
  // of the colour derived from primaryColour. Deep/Ink reserved for
  // future-use (accent borders, body text). Null/undefined falls back
  // to derive-from-primary or EQ default.
  deepColour?: string | null
  iceColour?: string | null
  inkColour?: string | null
}

export interface PmCheckReportItem {
  number: number
  description: string
  result: 'pass' | 'fail' | 'na' | null
  notes: string | null
  completedBy: string | null
  completedAt: string | null
}

// ---------- constants ----------

const PAGE_WIDTH = 11906 // A4 DXA
const PAGE_HEIGHT = 16838
const MARGIN = 1440 // 1 inch
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2 // 9026

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: EQ_BORDER }
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
const CELL_MARGINS = { top: 60, bottom: 60, left: 100, right: 100 }

// ---------- helpers ----------

/**
 * Header cell. `fill` defaults to EQ_ICE so existing call sites without
 * a brand-aware fill continue to render brief-default. New call sites
 * pass tenantIce(input.primaryColour) to get a tenant-flavoured ice.
 */
function headerCell(text: string, width: number, fill: string = EQ_ICE): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: { fill, type: ShadingType.CLEAR },
    margins: CELL_MARGINS,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, font: FONT_BODY })] })],
  })
}

function cell(text: string, width: number, opts?: { bold?: boolean; shading?: string; align?: typeof AlignmentType[keyof typeof AlignmentType] }): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: opts?.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: CELL_MARGINS,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: opts?.align,
      children: [new TextRun({ text: text || '', bold: opts?.bold, size: 18, font: FONT_BODY })]
    })],
  })
}

function resultToText(result: 'pass' | 'fail' | 'na' | null): string {
  if (result === 'pass') return 'Pass'
  if (result === 'fail') return 'Fail'
  if (result === 'na') return 'N/A'
  return 'Pending'
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

// ---------- section builders ----------

function buildCoverSection(input: PmCheckReportInput): { children: (Paragraph | Table)[] } {
  const year = new Date().getFullYear()
  const today = formatDateDDMMYYYY(new Date().toISOString())
  const brand = input.primaryColour.replace('#', '')

  return {
    children: [
      // Masthead with logos
      ...(input.customerLogoImage || input.tenantLogoImage ? [
        buildMasthead({
          customerLogo: input.customerLogoImage ?? undefined,
          tenantLogo: input.tenantLogoImage ?? undefined,
          reportTypeLabel: input.reportTypeLabel,
        }),
      ] : []),
      // spacer
      new Paragraph({ spacing: { before: 2000 } }),
      // title
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({
          text: 'Preventive Maintenance Report',
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
      // spacer
      new Paragraph({ spacing: { before: 2000 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({
          text: 'Check Information',
          bold: true,
          size: 32,
          font: FONT_BODY,
        })],
      }),
      new Paragraph({ spacing: { before: 400, after: 100 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new TextRun({
          text: `Site: ${input.siteName}`,
          size: 24,
          font: FONT_BODY,
        })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new TextRun({
          text: `Job Plan: ${input.jobPlanName}`,
          size: 24,
          font: FONT_BODY,
        })],
      }),
      ...(input.maximoWONumber ? [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({
            text: `Work Order: ${input.maximoWONumber}`,
            bold: true,
            size: 28,
            font: FONT_BODY,
            color: brand,
          })],
        }),
      ] : []),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new TextRun({
          text: `Check Date: ${formatDateDDMMYYYY(input.checkDate)}`,
          size: 24,
          font: FONT_BODY,
        })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 2000 },
        children: [new TextRun({
          text: `Due Date: ${formatDateDDMMYYYY(input.dueDate)}`,
          size: 24,
          font: FONT_BODY,
        })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 3000 },
        children: [new TextRun({
          text: input.tenantProductName,
          size: 20,
          font: FONT_BODY,
          color: EQ_MID_GREY,
        })],
      }),
    ],
  }
}

function buildCheckSummaryTable(input: PmCheckReportInput): Table {
  const c1 = 2000
  const c2 = 3600
  const totalW = c1 + c2
  const fill = tenantIce(input.primaryColour)

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2],
    rows: [
      new TableRow({
        children: [
          headerCell('Field', c1, fill),
          headerCell('Value', c2, fill),
        ],
      }),
      new TableRow({
        children: [
          cell('Job Plan', c1, { bold: true }),
          cell(input.jobPlanName, c2),
        ],
      }),
      new TableRow({
        children: [
          cell('Site', c1, { bold: true }),
          cell(input.siteName, c2),
        ],
      }),
      new TableRow({
        children: [
          cell('Due Date', c1, { bold: true }),
          cell(formatDateDDMMYYYY(input.dueDate), c2),
        ],
      }),
      new TableRow({
        children: [
          cell('Started', c1, { bold: true }),
          cell(input.startedAt ? formatDateDDMMYYYY(input.startedAt) : '—', c2),
        ],
      }),
      new TableRow({
        children: [
          cell('Completed', c1, { bold: true }),
          cell(input.completedAt ? formatDateDDMMYYYY(input.completedAt) : '—', c2),
        ],
      }),
      new TableRow({
        children: [
          cell('Status', c1, { bold: true }),
          cell(input.status.charAt(0).toUpperCase() + input.status.slice(1), c2),
        ],
      }),
      new TableRow({
        children: [
          cell('Assigned To', c1, { bold: true }),
          cell(input.assignedTo ?? '—', c2),
        ],
      }),
    ],
  })
}

function buildCheckItemsTable(input: PmCheckReportInput): Table {
  const c1 = 300 // #
  const c2 = 3500 // Description
  const c3 = 800 // Result
  const c4 = 2000 // Notes
  const c5 = 1400 // Completed By
  const c6 = 1026 // Completed At
  const totalW = c1 + c2 + c3 + c4 + c5 + c6
  const fill = tenantIce(input.primaryColour, input.iceColour)

  const itemRows = input.items.map((item) =>
    new TableRow({
      children: [
        cell(String(item.number), c1, { align: AlignmentType.CENTER }),
        cell(item.description, c2),
        cell(resultToText(item.result), c3, { align: AlignmentType.CENTER }),
        cell(item.notes ?? '', c4),
        cell(item.completedBy ?? '', c5),
        cell(item.completedAt ? formatDateDDMMYYYY(item.completedAt) : '', c6),
      ],
    }),
  )

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4, c5, c6],
    rows: [
      new TableRow({
        children: [
          headerCell('#', c1, fill),
          headerCell('Description', c2, fill),
          headerCell('Result', c3, fill),
          headerCell('Notes', c4, fill),
          headerCell('Completed By', c5, fill),
          headerCell('Completed At', c6, fill),
        ],
      }),
      ...itemRows,
    ],
  })
}

function buildStatisticsSection(input: PmCheckReportInput): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  const passCount = input.items.filter((i) => i.result === 'pass').length
  const failCount = input.items.filter((i) => i.result === 'fail').length
  const naCount = input.items.filter((i) => i.result === 'na').length
  const totalCount = input.items.length

  const passPercent = totalCount > 0 ? Math.round((passCount / totalCount) * 100) : 0
  const failPercent = totalCount > 0 ? Math.round((failCount / totalCount) * 100) : 0

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text: 'Summary Statistics', bold: true, size: 24, font: FONT_BODY })],
  }))

  const c1 = 2000
  const c2 = 1400
  const totalW = c1 + c2
  const fill = tenantIce(input.primaryColour)

  children.push(new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2],
    rows: [
      new TableRow({
        children: [
          headerCell('Metric', c1, fill),
          headerCell('Count', c2, fill),
        ],
      }),
      new TableRow({
        children: [
          cell('Total Tasks', c1, { bold: true }),
          cell(String(totalCount), c2, { align: AlignmentType.CENTER }),
        ],
      }),
      new TableRow({
        children: [
          cell('Passed', c1, { bold: true, shading: 'D4EDDA' }),
          cell(`${passCount} (${passPercent}%)`, c2, { align: AlignmentType.CENTER, shading: 'D4EDDA' }),
        ],
      }),
      new TableRow({
        children: [
          cell('Failed', c1, { bold: true, shading: 'F8D7DA' }),
          cell(`${failCount} (${failPercent}%)`, c2, { align: AlignmentType.CENTER, shading: 'F8D7DA' }),
        ],
      }),
      new TableRow({
        children: [
          cell('N/A', c1, { bold: true }),
          cell(String(naCount), c2, { align: AlignmentType.CENTER }),
        ],
      }),
    ],
  }))

  return children
}

// ---------- main export ----------

export async function generatePMCheckReport(input: PmCheckReportInput): Promise<Buffer> {
  const brand = input.primaryColour.replace('#', '')
  const coverChildren = buildCoverSection(input).children

  // Sprint 2.3 (26-Apr-2026): adopt shared ReportShell for header/footer.
  const shell = await prepareShell(
    resolveShellSettings({
      companyName: input.companyName ?? input.tenantProductName,
      productName: input.tenantProductName,
      primaryColour: input.primaryColour,
      headerText: `${input.siteName} — PM Check Report`,
      footerText: `${input.companyName || input.tenantProductName} — Preventive Maintenance Report — rev 3.1`,
    }),
    {
      reportType: 'maintenance_check',
      reportDate: new Date().toLocaleDateString('en-AU'),
      customerName: input.companyName ?? null,
      siteName: input.siteName,
      siteAddress: null,
      customerLogoUrl: null,
      sitePhotoUrl: null,
    },
  )

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT_BODY, size: 20 },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 28, bold: true, font: FONT_BODY, color: brand },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 24, bold: true, font: FONT_BODY, color: brand },
          paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [
      // Cover page
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        children: coverChildren,
      },
      // Content
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        headers: { default: buildShellHeader(shell) },
        footers: { default: buildShellFooter(shell) },
        children: [
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: 'Check Summary', bold: true, size: 28, font: FONT_BODY })],
          }),
          buildCheckSummaryTable(input),
          new Paragraph({ spacing: { before: 240 } }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: 'Check Items', bold: true, size: 28, font: FONT_BODY })],
          }),
          buildCheckItemsTable(input),
          ...buildStatisticsSection(input),
        ],
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  return buffer as Buffer
}
