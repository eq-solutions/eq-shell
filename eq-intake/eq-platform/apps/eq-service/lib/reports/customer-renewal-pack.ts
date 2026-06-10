/**
 * Customer Renewal Pack — DOCX Generator
 *
 * Phase 7 (stretch) of the contract-scope ↔ check bridge plan.
 *
 * The year-end pack a commercial manager sends to a customer alongside
 * the renewal proposal. Compiles five sections into one document:
 *
 *   1. Cover + executive summary
 *   2. Year in Review — what was contracted this year (the same data the
 *      Phase 8 scope statement covers)
 *   3. Delivery Summary — what was actually delivered (maintenance_checks
 *      completed in the year, with their site + status)
 *   4. Variations — approved + billed variations for the year
 *   5. Proposed scope for next year (lifted from contract_scopes for
 *      next_year — operator can pre-stage these as 'draft' rows before
 *      generating)
 *
 * Like Phase 8, this generator composes inside the standard report shell
 * so brand styling, headers, footers and sign-off are consistent with
 * the rest of the customer-facing PDFs.
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
  BorderStyle,
  WidthType,
  PageBreak,
  ShadingType,
  VerticalAlign,
} from 'docx'
import {
  buildCover,
  buildHeader,
  buildFooter,
  buildSignoff,
  prepareShell,
  resolveShellSettings,
  type ShellSettings,
  type ShellContext,
} from './report-shell'
import { FONT_BODY } from './typography'
import { EQ_MID_GREY, EQ_INK, bareHex } from './colours'

export interface RenewalPackInput {
  shellSettings: Partial<ShellSettings>
  shellContext: ShellContext

  /** The year being reviewed (e.g. '2026'). */
  reviewYear: string
  /** The proposed next year (e.g. '2027'). */
  nextYear: string
  /** Display labels for the years — wraps with FY/CY prefix. */
  reviewYearDisplay: string
  nextYearDisplay: string

  /** Scope rows for the review year. */
  reviewIncludedItems: Array<{ scope_item: string; site_name: string | null; notes: string | null }>
  reviewExcludedItems: Array<{ scope_item: string; site_name: string | null; notes: string | null }>

  /** Maintenance checks completed during the review year. */
  deliveredChecks: Array<{
    check_id: string
    custom_name: string | null
    site_name: string
    status: string
    completed_at: string | null
    job_plan_name: string | null
  }>

  /** Variations approved or billed in the review year. */
  variations: Array<{
    variation_number: string
    title: string
    status: string
    value: number | null
    customer_ref: string | null
  }>

  /** Proposed scope for next year (typically 'draft'-status rows). */
  proposedItems: Array<{ scope_item: string; site_name: string | null; notes: string | null }>

  /** Commercial-tone executive summary the operator can override. */
  executiveSummaryOverride?: string | null
}

const TABLE_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: bareHex(EQ_MID_GREY) },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: bareHex(EQ_MID_GREY) },
  left: { style: BorderStyle.SINGLE, size: 4, color: bareHex(EQ_MID_GREY) },
  right: { style: BorderStyle.SINGLE, size: 4, color: bareHex(EQ_MID_GREY) },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: bareHex(EQ_MID_GREY) },
  insideVertical: { style: BorderStyle.SINGLE, size: 2, color: bareHex(EQ_MID_GREY) },
}

function txt(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}) {
  return new TextRun({
    text,
    bold: opts.bold ?? false,
    size: opts.size ?? 20,
    color: opts.color ?? bareHex(EQ_INK),
    font: FONT_BODY,
  })
}

function heading(text: string, primaryColour: string, level: 1 | 2 = 1) {
  return new Paragraph({
    children: [new TextRun({
      text,
      bold: true,
      size: level === 1 ? 30 : 24,
      color: bareHex(primaryColour),
      font: FONT_BODY,
    })],
    spacing: { before: 320, after: 120 },
  })
}

function para(text: string) {
  return new Paragraph({
    children: [txt(text)],
    spacing: { after: 120 },
  })
}

function headerCell(label: string, primaryColour: string, widthPct: number): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({
      text: label,
      bold: true,
      size: 18,
      color: 'FFFFFF',
      font: FONT_BODY,
    })] })],
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.SOLID, color: bareHex(primaryColour), fill: bareHex(primaryColour) },
    verticalAlign: VerticalAlign.CENTER,
  })
}

function bodyCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [txt(text, { size: 18 })], spacing: { before: 60, after: 60 } })],
    verticalAlign: VerticalAlign.CENTER,
  })
}

function emptyRow(span: number, message: string): TableRow {
  return new TableRow({
    children: [new TableCell({
      children: [new Paragraph({ children: [txt(message, { color: EQ_MID_GREY })], alignment: AlignmentType.CENTER })],
      columnSpan: span,
      verticalAlign: VerticalAlign.CENTER,
    })],
  })
}

function buildScopeTable(
  rows: Array<{ scope_item: string; site_name: string | null; notes: string | null }>,
  primaryColour: string,
): Table {
  const header = new TableRow({
    tableHeader: true,
    children: [
      headerCell('Scope Item', primaryColour, 60),
      headerCell('Site', primaryColour, 18),
      headerCell('Notes', primaryColour, 22),
    ],
  })
  const dataRows = rows.length === 0
    ? [emptyRow(3, 'No items recorded.')]
    : rows.map(r => new TableRow({
        children: [
          bodyCell(r.scope_item),
          bodyCell(r.site_name ?? 'All sites'),
          bodyCell(r.notes ?? '—'),
        ],
      }))
  return new Table({
    rows: [header, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDER,
  })
}

function buildDeliveryTable(rows: RenewalPackInput['deliveredChecks'], primaryColour: string): Table {
  const header = new TableRow({
    tableHeader: true,
    children: [
      headerCell('Check', primaryColour, 32),
      headerCell('Site', primaryColour, 24),
      headerCell('Job Plan', primaryColour, 24),
      headerCell('Completed', primaryColour, 12),
      headerCell('Status', primaryColour, 8),
    ],
  })
  const dataRows = rows.length === 0
    ? [emptyRow(5, 'No completed checks recorded.')]
    : rows.map(r => new TableRow({
        children: [
          bodyCell(r.custom_name ?? 'Maintenance check'),
          bodyCell(r.site_name),
          bodyCell(r.job_plan_name ?? '—'),
          bodyCell(r.completed_at ? new Date(r.completed_at).toLocaleDateString('en-AU') : '—'),
          bodyCell(r.status),
        ],
      }))
  return new Table({
    rows: [header, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDER,
  })
}

function buildVariationsTable(rows: RenewalPackInput['variations'], primaryColour: string): Table {
  const header = new TableRow({
    tableHeader: true,
    children: [
      headerCell('Variation #', primaryColour, 14),
      headerCell('Description', primaryColour, 50),
      headerCell('Status', primaryColour, 12),
      headerCell('Customer Ref', primaryColour, 12),
      headerCell('Value', primaryColour, 12),
    ],
  })
  const dataRows = rows.length === 0
    ? [emptyRow(5, 'No variations in this period.')]
    : rows.map(r => new TableRow({
        children: [
          bodyCell(r.variation_number),
          bodyCell(r.title),
          bodyCell(r.status),
          bodyCell(r.customer_ref ?? '—'),
          bodyCell(
            r.value === null
              ? '—'
              : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(r.value),
          ),
        ],
      }))
  return new Table({
    rows: [header, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDER,
  })
}

const DEFAULT_EXEC_SUMMARY = (
  customerName: string,
  reviewYearDisplay: string,
  nextYearDisplay: string,
  delivered: number,
  included: number,
  variations: number,
) => (
  `This pack reviews the maintenance services delivered to ${customerName} during ` +
  `${reviewYearDisplay} and proposes the scope for the upcoming ${nextYearDisplay} period.\n\n` +
  `Of the ${included} item${included === 1 ? '' : 's'} contracted for the year, ${delivered} ` +
  `${delivered === 1 ? 'maintenance visit was' : 'maintenance visits were'} delivered, with ` +
  `${variations} variation${variations === 1 ? '' : 's'} actioned alongside the core scope. ` +
  `The proposed scope for the next period is summarised at the end of this pack.`
)

export async function generateCustomerRenewalPack(input: RenewalPackInput): Promise<Buffer> {
  const settings = resolveShellSettings(input.shellSettings)
  const shell = await prepareShell(settings, input.shellContext)
  const primaryColour = settings.primaryColour
  const customerName = input.shellContext.customerName ?? 'Customer'

  const summary = input.executiveSummaryOverride ?? DEFAULT_EXEC_SUMMARY(
    customerName,
    input.reviewYearDisplay,
    input.nextYearDisplay,
    input.deliveredChecks.length,
    input.reviewIncludedItems.length,
    input.variations.length,
  )

  const body: Array<Paragraph | Table> = []

  if (settings.showCover) {
    body.push(...buildCover(shell))
    body.push(new Paragraph({ children: [new PageBreak()] }))
  }

  // Title + executive summary
  body.push(new Paragraph({
    children: [new TextRun({
      text: `Renewal Pack — ${input.reviewYearDisplay} → ${input.nextYearDisplay}`,
      bold: true,
      size: 36,
      color: bareHex(primaryColour),
      font: FONT_BODY,
    })],
    spacing: { after: 200 },
  }))
  body.push(heading('Executive Summary', primaryColour))
  for (const line of summary.split('\n\n')) {
    body.push(para(line))
  }

  // 1. Year in review — scope
  body.push(new Paragraph({ children: [new PageBreak()] }))
  body.push(heading(`Year In Review — ${input.reviewYearDisplay}`, primaryColour))
  body.push(heading('Items In Scope', primaryColour, 2))
  body.push(buildScopeTable(input.reviewIncludedItems, primaryColour))
  body.push(heading('Items Out Of Scope', primaryColour, 2))
  body.push(buildScopeTable(input.reviewExcludedItems, primaryColour))

  // 2. Delivery summary
  body.push(heading('Delivery Summary', primaryColour))
  body.push(para(
    `${input.deliveredChecks.length} maintenance check${input.deliveredChecks.length === 1 ? '' : 's'} ` +
    `completed against the contracted scope during ${input.reviewYearDisplay}.`,
  ))
  body.push(buildDeliveryTable(input.deliveredChecks, primaryColour))

  // 3. Variations
  body.push(heading('Variations', primaryColour))
  body.push(para(
    `${input.variations.length} variation${input.variations.length === 1 ? '' : 's'} ` +
    `${input.variations.length === 1 ? 'was' : 'were'} actioned during the period.`,
  ))
  body.push(buildVariationsTable(input.variations, primaryColour))

  // 4. Proposed next year scope
  body.push(new Paragraph({ children: [new PageBreak()] }))
  body.push(heading(`Proposed Scope — ${input.nextYearDisplay}`, primaryColour))
  body.push(para(
    `The following items are proposed for inclusion in the ${input.nextYearDisplay} period. ` +
    `These have been entered as draft scope items and will be confirmed during the renewal conversation.`,
  ))
  body.push(buildScopeTable(input.proposedItems, primaryColour))

  if (settings.showSignoff) {
    body.push(...buildSignoff(shell))
  }

  const doc = new Document({
    creator: settings.companyName,
    title: `Renewal Pack — ${customerName} — ${input.reviewYearDisplay} to ${input.nextYearDisplay}`,
    sections: [{
      headers: { default: buildHeader(shell) },
      footers: { default: buildFooter(shell) },
      children: body,
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  return buffer as Buffer
}
