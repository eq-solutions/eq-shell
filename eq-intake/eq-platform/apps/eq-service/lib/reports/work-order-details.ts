/**
 * Work Order Details Report — DOCX Generator
 *
 * Generates a per-asset detailed work order page with:
 * - Masthead with customer + tenant logos
 * - WO# as prominent subhead
 * - 2-column info grid (Status, Work Type, Priority, Job Plan, CrewID, etc.)
 * - Tasks table with Task ID | Description | Pass | Fail | N/A | Comments
 * - Per-asset Name/Date/Hours/Comments block
 * - Defects raised section
 * - Footer with company name + page numbering
 *
 * One page per asset, allowing multiple assets per check to produce a multi-page report.
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
} from 'docx'
import {
  buildHeader as buildShellHeader,
  buildFooter as buildShellFooter,
  prepareShell,
  resolveShellSettings,
} from '@/lib/reports/report-shell'
import { buildMasthead } from '@/lib/reports/report-branding'
import { FONT_BODY } from '@/lib/reports/typography'
import { EQ_MID_GREY, EQ_BORDER, EQ_ICE, tenantIce } from '@/lib/reports/colours'

// ---------- types ----------

export interface WorkOrderDetailsInput {
  /** Tenant palette overrides. See lib/reports/colours.ts::tenantIce. */
  deepColour?: string | null
  iceColour?: string | null
  inkColour?: string | null

  // Branding
  companyName: string
  tenantProductName: string
  primaryColour: string // hex without #
  tenantLogoImage?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number } | null
  customerLogoImage?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number } | null
  reportTypeLabel?: string

  // Assets with full WO details
  assets: WorkOrderDetailsAsset[]
}

export interface WorkOrderDetailsAsset {
  assetName: string
  location: string | null
  jobPlanType: string | null // "Low Voltage Air Circuit Breaker (ACB)"

  // Maximo / Work Order fields
  maximoWONumber: string | null
  status: string | null          // 'pending', 'in_progress', 'completed'
  workType: string | null        // 'PM', 'CM', 'EM', 'CAL', 'INSP'
  priority: string | null
  crewId: string | null
  failureCode: string | null
  problem: string | null
  cause: string | null
  remedy: string | null
  classification: string | null
  irScanResult: string | null    // 'pass', 'fail', 'na', 'not_done'

  // Timeline
  targetStart: string | null
  targetFinish: string | null
  actualStart: string | null
  actualFinish: string | null

  // Tech capture
  technicianName: string | null
  completedDate: string | null
  hoursLogged: number | null
  comments: string | null

  // Tasks for this asset
  tasks: WorkOrderTask[]

  // Defects linked to this asset on this check
  defects: WorkOrderDefect[]
}

export interface WorkOrderTask {
  taskId: string | null           // maximo_task_id if present, else sequential
  description: string
  passed: boolean | null          // pass/fail/na on check_items
  comments: string | null
}

export interface WorkOrderDefect {
  id: string
  code: string | null
  description: string
  severity: string | null
  status: string | null
  woNumber: string | null
}

// ---------- constants ----------

const PAGE_WIDTH = 11906  // A4 DXA
const PAGE_HEIGHT = 16838
const MARGIN = 1440       // 1 inch
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: EQ_BORDER }

// Per-render header fill — see nsx-report.ts for the full rationale.
let _activeIce: string = EQ_ICE
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
const CELL_MARGINS = { top: 60, bottom: 60, left: 100, right: 100 }

// ---------- helpers ----------

function formatDateDDMMYYYY(dateStr: string | null): string {
  if (!dateStr) return '—'
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

function infoCell(text: string, width: number): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    margins: CELL_MARGINS,
    children: [new Paragraph({
      children: [new TextRun({
        text: text || '—',
        size: 18,
        font: FONT_BODY,
      })],
    })],
  })
}

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: _activeIce, type: ShadingType.CLEAR },
    margins: CELL_MARGINS,
    children: [new Paragraph({
      children: [new TextRun({
        text,
        bold: true,
        size: 18,
        font: FONT_BODY,
      })],
    })],
  })
}

// ---------- section builders ----------

function buildInfoGrid(asset: WorkOrderDetailsAsset): Table {
  const c1 = 2800  // Label
  const c2 = 3113  // Value
  const totalW = c1 + c2

  return new Table({
    width: { size: totalW * 2, type: WidthType.DXA },
    columnWidths: [c1, c2, c1, c2],
    rows: [
      new TableRow({
        children: [
          infoCell('Status', c1),
          infoCell(asset.status ?? '—', c2),
          infoCell('Work Type', c1),
          infoCell(asset.workType ?? '—', c2),
        ],
      }),
      new TableRow({
        children: [
          infoCell('Priority', c1),
          infoCell(asset.priority ?? '—', c2),
          infoCell('Job Plan', c1),
          infoCell(asset.jobPlanType ?? '—', c2),
        ],
      }),
      new TableRow({
        children: [
          infoCell('Crew ID', c1),
          infoCell(asset.crewId ?? '—', c2),
          infoCell('Failure Code', c1),
          infoCell(asset.failureCode ?? '—', c2),
        ],
      }),
      new TableRow({
        children: [
          infoCell('Target Start', c1),
          infoCell(formatDateDDMMYYYY(asset.targetStart), c2),
          infoCell('Target Finish', c1),
          infoCell(formatDateDDMMYYYY(asset.targetFinish), c2),
        ],
      }),
      new TableRow({
        children: [
          infoCell('Actual Start', c1),
          infoCell(formatDateDDMMYYYY(asset.actualStart), c2),
          infoCell('Actual Finish', c1),
          infoCell(formatDateDDMMYYYY(asset.actualFinish), c2),
        ],
      }),
      new TableRow({
        children: [
          infoCell('IR Scan', c1),
          infoCell(asset.irScanResult ?? '—', c2),
          infoCell('Classification', c1),
          infoCell(asset.classification ?? '—', c2),
        ],
      }),
    ],
  })
}

function buildProblemsSection(asset: WorkOrderDetailsAsset): Paragraph[] {
  if (!asset.problem && !asset.cause && !asset.remedy) {
    return []
  }

  return [
    new Paragraph({ spacing: { before: 400, after: 100 } }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({
        text: 'Problem & Resolution',
        bold: true,
        size: 24,
        font: FONT_BODY,
      })],
    }),
    new Paragraph({
      spacing: { before: 100, after: 80 },
      children: [new TextRun({
        text: `Problem: ${asset.problem || '—'}`,
        size: 18,
        font: FONT_BODY,
      })],
    }),
    new Paragraph({
      spacing: { before: 100, after: 80 },
      children: [new TextRun({
        text: `Cause: ${asset.cause || '—'}`,
        size: 18,
        font: FONT_BODY,
      })],
    }),
    new Paragraph({
      spacing: { before: 100, after: 400 },
      children: [new TextRun({
        text: `Remedy: ${asset.remedy || '—'}`,
        size: 18,
        font: FONT_BODY,
      })],
    }),
  ]
}

function buildTasksTable(tasks: WorkOrderTask[]): Table {
  const c1 = 800   // Task ID
  const c2 = 2500  // Description
  const c3 = 600   // Pass
  const c4 = 600   // Fail
  const c5 = 600   // N/A
  const c6 = 1400  // Comments
  const totalW = c1 + c2 + c3 + c4 + c5 + c6

  const rows: TableRow[] = [
    new TableRow({
      children: [
        headerCell('Task ID', c1),
        headerCell('Description', c2),
        headerCell('Pass', c3),
        headerCell('Fail', c4),
        headerCell('N/A', c5),
        headerCell('Comments', c6),
      ],
    }),
  ]

  for (const task of tasks) {
    const passed = task.passed === true ? '✓' : task.passed === false ? '✗' : ''
    const failed = task.passed === false ? '✓' : ''
    const na = task.passed === null ? '✓' : ''

    rows.push(
      new TableRow({
        children: [
          infoCell(task.taskId ?? '—', c1),
          infoCell(task.description, c2),
          infoCell(passed, c3),
          infoCell(failed, c4),
          infoCell(na, c5),
          infoCell(task.comments ?? '', c6),
        ],
      }),
    )
  }

  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4, c5, c6],
    rows,
  })
}

function buildTechCaptureBlock(asset: WorkOrderDetailsAsset): Paragraph[] {
  return [
    new Paragraph({ spacing: { before: 400, after: 100 } }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({
        text: 'Technician Capture',
        bold: true,
        size: 24,
        font: FONT_BODY,
      })],
    }),
    new Paragraph({
      spacing: { before: 100, after: 60 },
      children: [new TextRun({
        text: `Name:  _________________________________    Date:  _________________`,
        size: 18,
        font: FONT_BODY,
      })],
    }),
    new Paragraph({
      spacing: { before: 100, after: 60 },
      children: [new TextRun({
        text: `Hours Logged:  _____________________    Signature:  _____________________`,
        size: 18,
        font: FONT_BODY,
      })],
    }),
    new Paragraph({
      spacing: { before: 200, after: 80 },
      children: [new TextRun({
        text: 'Comments:',
        bold: true,
        size: 18,
        font: FONT_BODY,
      })],
    }),
    new Paragraph({
      spacing: { before: 100, after: 100 },
      children: [new TextRun({
        text: '__________________________________________________________________________',
        size: 18,
        font: FONT_BODY,
      })],
    }),
    new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({
        text: '__________________________________________________________________________',
        size: 18,
        font: FONT_BODY,
      })],
    }),
  ]
}

function buildDefectsSection(defects: WorkOrderDefect[]): Paragraph[] {
  if (defects.length === 0) {
    return []
  }

  const content: Paragraph[] = [
    new Paragraph({ spacing: { before: 400, after: 100 } }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({
        text: 'Defects Raised',
        bold: true,
        size: 24,
        font: FONT_BODY,
      })],
    }),
  ]

  for (const defect of defects) {
    content.push(
      new Paragraph({
        spacing: { before: 100, after: 80 },
        children: [new TextRun({
          text: `${defect.code || 'N/A'}: ${defect.description}`,
          size: 18,
          font: FONT_BODY,
        })],
      }),
      new Paragraph({
        spacing: { after: 100 },
        children: [new TextRun({
          text: `Severity: ${defect.severity || '—'} | Status: ${defect.status || '—'} | WO: ${defect.woNumber || '—'}`,
          size: 16,
          font: FONT_BODY,
          italics: true,
          color: EQ_MID_GREY,
        })],
      }),
    )
  }

  return content
}

// ---------- main export ----------

export async function generateWorkOrderDetailsReport(
  input: WorkOrderDetailsInput,
): Promise<Buffer> {
  const brand = input.primaryColour.replace('#', '')
  // Set per-render header fill from tenant palette (see _activeIce comment).
  _activeIce = tenantIce(input.primaryColour, input.iceColour)

  // Sprint 2.3 (26-Apr-2026): adopt shared ReportShell for header/footer.
  const shell = await prepareShell(
    resolveShellSettings({
      companyName: input.companyName,
      productName: input.tenantProductName,
      primaryColour: input.primaryColour,
      headerText: `${input.companyName} — Work Order Details`,
      footerText: `${input.companyName} — Work Order Details — rev 3.1`,
    }),
    {
      reportType: 'maintenance_check',
      reportDate: new Date().toLocaleDateString('en-AU'),
      customerName: input.companyName ?? null,
      siteName: null,
      siteAddress: null,
      customerLogoUrl: null,
      sitePhotoUrl: null,
    },
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assetSections: any[] = []

  for (let i = 0; i < input.assets.length; i++) {
    const asset = input.assets[i]

    // Page break between assets (but not before the first)
    if (i > 0) {
      assetSections.push(new Paragraph({ children: [new PageBreak()] }))
    }

    // Masthead
    if (input.customerLogoImage || input.tenantLogoImage) {
      assetSections.push(
        buildMasthead({
          customerLogo: input.customerLogoImage ?? undefined,
          tenantLogo: input.tenantLogoImage ?? undefined,
          reportTypeLabel: input.reportTypeLabel || 'Work Order Details',
        }),
      )
    }

    // Title + WO#
    assetSections.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({
          text: 'Work Order Details',
          bold: true,
          size: 40,
          font: FONT_BODY,
          color: brand,
        })],
      }),
    )

    if (asset.maximoWONumber) {
      assetSections.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [new TextRun({
            text: `Work Order: ${asset.maximoWONumber}`,
            bold: true,
            size: 28,
            font: FONT_BODY,
            color: brand,
          })],
        }),
      )
    }

    // Asset ID + Location
    assetSections.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({
          text: `Asset: ${asset.assetName} ${asset.location ? `(${asset.location})` : ''}`,
          size: 20,
          font: FONT_BODY,
        })],
      }),
    )

    if (asset.jobPlanType) {
      assetSections.push(
        new Paragraph({
          spacing: { after: 400 },
          children: [new TextRun({
            text: `Applies To: ${asset.jobPlanType}`,
            size: 18,
            font: FONT_BODY,
            italics: true,
            color: EQ_MID_GREY,
          })],
        }),
      )
    }

    // Info grid
    assetSections.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 100 },
        children: [new TextRun({
          text: 'Work Order Information',
          bold: true,
          size: 24,
          font: FONT_BODY,
        })],
      }),
      buildInfoGrid(asset),
    )

    // Problem & Resolution
    assetSections.push(...buildProblemsSection(asset))

    // Tasks
    if (asset.tasks.length > 0) {
      assetSections.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 100 },
          children: [new TextRun({
            text: 'Tasks',
            bold: true,
            size: 24,
            font: FONT_BODY,
          })],
        }),
        buildTasksTable(asset.tasks),
      )
    }

    // Tech capture block
    assetSections.push(...buildTechCaptureBlock(asset))

    // Defects
    assetSections.push(...buildDefectsSection(asset.defects))
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        headers: { default: buildShellHeader(shell) },
        footers: { default: buildShellFooter(shell) },
        children: assetSections,
      },
    ],
  })

  const buffer = await Packer.toBuffer(doc)
  return buffer as Buffer
}
