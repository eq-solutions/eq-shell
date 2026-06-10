/**
 * Compliance Dashboard Report — DOCX Generator
 *
 * Produces a compliance/dashboard report with:
 * - Cover page with scope and branding
 * - Maintenance compliance KPIs
 * - Maintenance breakdown by status
 * - Test results summary
 * - ACB/NSX workflow progress
 * - Defects register summary
 * - Compliance by site table
 * - 6-month trend summary
 *
 * Designed for monthly meetings — filterable by customer, site, and date range.
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
} from 'docx'
import {
  buildHeader as buildShellHeader,
  buildFooter as buildShellFooter,
  prepareShell,
  resolveShellSettings,
  type ShellSettings,
} from './report-shell'
import { FONT_BODY, FONT_HEADING } from './typography'
import { EQ_MID_GREY, EQ_BORDER, EQ_INK, EQ_WHITE, EQ_ICE, EQ_SKY, STATUS_PASS, STATUS_FAIL, STATUS_WARN, tenantIce } from './colours'

// ---------- types ----------

export interface ComplianceReportInput {
  filterDescription: string
  generatedDate: string
  tenantProductName: string
  /**
   * Tenant company name shown prominently on the cover. Falls back to
   * tenantProductName if not supplied — but the call site should always
   * pass the company name from `tenants.name` so reports identify the
   * issuing entity (e.g. "SKS Technologies"), not the product
   * ("EQ Solves Service").
   */
  companyName?: string
  /** Tenant ABN, shown on cover when present. */
  companyAbn?: string | null
  primaryColour: string // hex without #
  /** Tenant palette overrides — see lib/reports/colours.ts::tenantIce. */
  deepColour?: string | null
  iceColour?: string | null
  inkColour?: string | null
  complexity: 'summary' | 'standard' | 'detailed'

  // Maintenance
  maintenance: {
    total: number
    complete: number
    inProgress: number
    scheduled: number
    overdue: number
    cancelled: number
    complianceRate: number
  }

  // Testing
  testing: {
    total: number
    pass: number
    fail: number
    defect: number
    pending: number
    passRate: number
  }

  // ACB progress
  acb: { total: number; complete: number; inProgress: number; notStarted: number }

  // NSX progress
  nsx: { total: number; complete: number; inProgress: number; notStarted: number }

  // Defects
  defects: {
    total: number
    open: number
    inProgress: number
    resolved: number
    critical: number
    high: number
    medium: number
    low: number
  }

  // Compliance by site
  complianceBySite: { site: string; total: number; complete: number; overdue: number; rate: number }[]

  // Trend data
  months: { label: string; tests: number; pass: number; checks: number; complete: number }[]
}

// ---------- helpers ----------

const thin = { style: BorderStyle.SINGLE, size: 1, color: EQ_BORDER }
const cellBorders = { top: thin, bottom: thin, left: thin, right: thin }

// Per-render header fill — see nsx-report.ts for full rationale.
let _activeIce: string = EQ_ICE

/**
 * Header cell for compliance tables.
 *
 * Uses EQ_ICE fill + EQ_INK text per Brief v1.3 §6.7 — passes WCAG AA at
 * all sizes (16.2:1 contrast). The previous implementation used the brand
 * colour as fill with white text, which caused borderline contrast on
 * lighter brand colours (e.g. SKS purple #8070C0 on white text was
 * marginal against AA requirements). The `_colour` arg is retained for
 * call-site stability but ignored — change is intentional, not a bug.
 *
 * Closes audit finding Q4 (2026-04-26 reports design audit).
 */
function headerCell(text: string, _colour: string, widthPct?: number): TableCell {
  return new TableCell({
    borders: cellBorders,
    shading: { type: ShadingType.CLEAR, fill: _activeIce },
    verticalAlign: VerticalAlign.CENTER,
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ text, bold: true, size: 18, color: EQ_INK, font: FONT_BODY })] })],
  })
}

function dataCell(text: string, opts: { bold?: boolean; color?: string; align?: typeof AlignmentType[keyof typeof AlignmentType] } = {}): TableCell {
  return new TableCell({
    borders: cellBorders,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      spacing: { before: 30, after: 30 },
      alignment: opts.align,
      children: [new TextRun({ text, size: 18, font: FONT_BODY, bold: opts.bold, color: opts.color })],
    })],
  })
}

function sectionHeading(text: string, colour: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 100 },
    children: [new TextRun({ text, bold: true, size: 24, font: FONT_BODY, color: colour })],
  })
}

function kpiLine(label: string, value: string | number, color?: string): Paragraph {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    children: [
      new TextRun({ text: `${label}: `, size: 20, font: FONT_BODY }),
      new TextRun({ text: String(value), size: 20, font: FONT_BODY, bold: true, color }),
    ],
  })
}

// ---------- generator ----------

export async function generateComplianceReport(input: ComplianceReportInput): Promise<Buffer> {
  const colour = input.primaryColour || EQ_SKY
  // Set per-render header fill from tenant palette (see _activeIce comment).
  _activeIce = tenantIce(input.primaryColour, input.iceColour)
  const m = input.maintenance
  const t = input.testing
  const isDetailed = input.complexity === 'detailed'
  const isSummary = input.complexity === 'summary'

  const sections: Paragraph[] = []
  const company = input.companyName ?? input.tenantProductName

  // ── Cover ──
  // Brand-coloured top accent bar — gives the cover a clear visual anchor
  // that says "this report came from <tenant>" before any text.
  sections.push(
    new Paragraph({
      spacing: { after: 600 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: colour, space: 1 } },
    }),
    new Paragraph({ spacing: { before: 1200 } }),

    // Title
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: 'Compliance Report', bold: true, size: 52, color: colour, font: FONT_BODY })],
    }),

    // Filter description (e.g. "Equinix · April 2026 · All sites")
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: input.filterDescription, size: 24, font: FONT_BODY, color: EQ_MID_GREY })],
    }),

    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 800 },
      children: [new TextRun({ text: `Generated: ${input.generatedDate}`, size: 20, font: FONT_BODY, color: EQ_MID_GREY })],
    }),

    // Prominent "Prepared by" block — anchors the cover on the issuing
    // company so customers see who they're getting the report from.
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: 'Prepared by', size: 18, font: FONT_BODY, color: EQ_MID_GREY })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: company, bold: true, size: 32, font: FONT_BODY, color: EQ_INK })],
    }),
    ...(input.companyAbn ? [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: `ABN ${input.companyAbn}`, size: 18, font: FONT_BODY, color: EQ_MID_GREY })],
      }),
    ] : []),

    // Bottom accent — closes the cover with the same brand colour.
    new Paragraph({ spacing: { before: 600 } }),
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: colour, space: 1 } },
      spacing: { before: 200, after: 200 },
      children: [new TextRun({
        text: input.tenantProductName,
        size: 14, font: FONT_BODY, color: EQ_MID_GREY,
      })],
    }),

    new Paragraph({ children: [new PageBreak()] }),
  )

  // ── Maintenance Compliance ──
  sections.push(sectionHeading('Maintenance Compliance', colour))
  sections.push(kpiLine('Compliance Rate', `${m.complianceRate}%`, m.complianceRate >= 80 ? STATUS_PASS : m.complianceRate >= 50 ? STATUS_WARN : STATUS_FAIL))
  sections.push(kpiLine('Total Checks', m.total))
  sections.push(kpiLine('Complete', m.complete, STATUS_PASS))
  sections.push(kpiLine('In Progress', m.inProgress, colour))
  sections.push(kpiLine('Scheduled', m.scheduled))
  sections.push(kpiLine('Overdue', m.overdue, m.overdue > 0 ? STATUS_FAIL : STATUS_PASS))
  sections.push(kpiLine('Cancelled', m.cancelled))

  // ── Testing Results ──
  sections.push(sectionHeading('Testing Results', colour))
  sections.push(kpiLine('Pass Rate', `${t.passRate}%`, t.passRate >= 80 ? STATUS_PASS : t.passRate >= 50 ? STATUS_WARN : STATUS_FAIL))
  sections.push(kpiLine('Total Tests', t.total))
  sections.push(kpiLine('Pass', t.pass, STATUS_PASS))
  sections.push(kpiLine('Fail', t.fail, t.fail > 0 ? STATUS_FAIL : undefined))
  sections.push(kpiLine('Defect', t.defect, t.defect > 0 ? STATUS_WARN : undefined))
  sections.push(kpiLine('Pending', t.pending))

  // ── ACB / NSX Workflow Progress ──
  if (!isSummary && (input.acb.total > 0 || input.nsx.total > 0)) {
    sections.push(sectionHeading('Breaker Testing Progress', colour))

    if (input.acb.total > 0) {
      sections.push(new Paragraph({ spacing: { before: 100, after: 60 }, children: [new TextRun({ text: 'ACB (Air Circuit Breakers)', bold: true, size: 20, font: FONT_BODY })] }))
      sections.push(kpiLine('Total', input.acb.total))
      sections.push(kpiLine('Complete', input.acb.complete, STATUS_PASS))
      sections.push(kpiLine('In Progress', input.acb.inProgress, colour))
      sections.push(kpiLine('Not Started', input.acb.notStarted))
    }

    if (input.nsx.total > 0) {
      sections.push(new Paragraph({ spacing: { before: 100, after: 60 }, children: [new TextRun({ text: 'NSX / MCCB', bold: true, size: 20, font: FONT_BODY })] }))
      sections.push(kpiLine('Total', input.nsx.total))
      sections.push(kpiLine('Complete', input.nsx.complete, STATUS_PASS))
      sections.push(kpiLine('In Progress', input.nsx.inProgress, colour))
      sections.push(kpiLine('Not Started', input.nsx.notStarted))
    }
  }

  // ── Defects Register ──
  if (input.defects.total > 0) {
    sections.push(sectionHeading('Defects Register', colour))
    sections.push(kpiLine('Total Defects', input.defects.total))
    sections.push(kpiLine('Open', input.defects.open, input.defects.open > 0 ? STATUS_FAIL : undefined))
    sections.push(kpiLine('In Progress', input.defects.inProgress, STATUS_WARN))
    sections.push(kpiLine('Resolved / Closed', input.defects.resolved, STATUS_PASS))

    if (!isSummary) {
      sections.push(new Paragraph({ spacing: { before: 100, after: 60 }, children: [new TextRun({ text: 'By Severity', bold: true, size: 20, font: FONT_BODY })] }))
      sections.push(kpiLine('Critical', input.defects.critical, input.defects.critical > 0 ? STATUS_FAIL : undefined))
      sections.push(kpiLine('High', input.defects.high, input.defects.high > 0 ? STATUS_FAIL : undefined))
      sections.push(kpiLine('Medium', input.defects.medium))
      sections.push(kpiLine('Low', input.defects.low))
    }
  }

  // ── Compliance by Site table ──
  if (input.complianceBySite.length > 0 && !isSummary) {
    sections.push(sectionHeading('Compliance by Site', colour))
    const siteTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            headerCell('Site', colour, 40),
            headerCell('Total', colour, 15),
            headerCell('Complete', colour, 15),
            headerCell('Overdue', colour, 15),
            headerCell('Rate', colour, 15),
          ],
        }),
        ...input.complianceBySite.map((row) =>
          new TableRow({
            children: [
              dataCell(row.site),
              dataCell(String(row.total), { align: AlignmentType.RIGHT }),
              dataCell(String(row.complete), { align: AlignmentType.RIGHT, color: STATUS_PASS }),
              dataCell(String(row.overdue), { align: AlignmentType.RIGHT, color: row.overdue > 0 ? STATUS_WARN : undefined }),
              dataCell(`${row.rate}%`, { align: AlignmentType.RIGHT, bold: true, color: row.rate >= 80 ? STATUS_PASS : row.rate >= 50 ? STATUS_WARN : STATUS_FAIL }),
            ],
          })
        ),
      ],
    })
    sections.push(new Paragraph({ spacing: { before: 100 } }))
    sections.push(siteTable as unknown as Paragraph)
  }

  // ── 6-Month Trend table (detailed only) ──
  // Explicit column widths (sum to 100) — matches the shape of the
  // Compliance-by-Site table above. Earlier revisions left widths
  // undefined here which, on some docx/Word paths, forced the renderer
  // to fall back to content-based sizing and produced a malformed
  // column set in the .docx XML. Keep the widths explicit.
  if (isDetailed && input.months.length > 0) {
    sections.push(sectionHeading('6-Month Trend', colour))
    const trendTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            headerCell('Month', colour, 20),
            headerCell('Tests', colour, 20),
            headerCell('Pass', colour, 20),
            headerCell('Checks', colour, 20),
            headerCell('Complete', colour, 20),
          ],
        }),
        ...input.months.map((mo) =>
          new TableRow({
            children: [
              dataCell(mo.label ?? ''),
              dataCell(String(mo.tests ?? 0), { align: AlignmentType.RIGHT }),
              dataCell(String(mo.pass ?? 0), { align: AlignmentType.RIGHT, color: STATUS_PASS }),
              dataCell(String(mo.checks ?? 0), { align: AlignmentType.RIGHT }),
              dataCell(String(mo.complete ?? 0), { align: AlignmentType.RIGHT, color: STATUS_PASS }),
            ],
          })
        ),
      ],
    })
    sections.push(new Paragraph({ spacing: { before: 100 } }))
    sections.push(trendTable as unknown as Paragraph)
  }

  // ── Header / Footer via shared ReportShell ─────────────────────────────
  // Sprint 2.3 (2026-04-26): first generator to adopt report-shell.ts.
  // The shell delivers the standard EQ header/footer (sky border, brand
  // typography, "Page X of Y" right-aligned). Cover + sign-off remain
  // bespoke for compliance reports until those sections migrate too —
  // header/footer are the lowest-risk first step.
  const shellSettings: ShellSettings = resolveShellSettings({
    companyName: input.tenantProductName,
    productName: input.tenantProductName,
    primaryColour: input.primaryColour ? `#${input.primaryColour}` : '#3DA8D8',
    complexity: input.complexity,
  })
  const shell = await prepareShell(shellSettings, {
    reportType: 'compliance',
    reportDate: input.generatedDate,
    customerName: null,
    siteName: null,
    siteAddress: null,
    customerLogoUrl: null,
    sitePhotoUrl: null,
  })

  // ── Build document ──
  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1200, right: 1200 } },
      },
      headers: { default: buildShellHeader(shell) },
      footers: { default: buildShellFooter(shell) },
      children: sections,
    }],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
