/**
 * Customer Scope Statement — DOCX Generator
 *
 * Phase 8 of the contract-scope ↔ check bridge plan. Generates a customer-
 * facing scope statement: "here's what your contract says we'll do this
 * year, here's what's explicitly out of scope, here are the variations
 * already approved."
 *
 * Used by commercial managers in two situations:
 *   1. Pre-year-start kick-off pack — sent to the customer to confirm
 *      what's covered for the upcoming financial year.
 *   2. Renewal-pack appendix — the year-end snapshot that goes alongside
 *      the renewal proposal.
 *
 * The document composes inside the standard report shell (cover / header /
 * footer / sign-off) so it sits visually alongside the Compliance,
 * Maintenance, and Test reports — same brand, same layout vocabulary.
 *
 * Commercial-tier feature — the server action that calls this gates on
 * tenant_settings.commercial_features_enabled.
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

export interface ScopeStatementInput {
  /** Tenant + report shell settings. Pass through from tenant_settings. */
  shellSettings: Partial<ShellSettings>
  /** Customer + report context for the cover page. */
  shellContext: ShellContext

  /** Financial year identifier as stored in contract_scopes (CY or AusFY). */
  financialYear: string
  /** Display label for the FY (e.g. "FY 2025-2026" or "CY 2026"). */
  financialYearDisplay: string

  /** Scope rows for this customer + FY. */
  includedItems: Array<{ scope_item: string; site_name: string | null; notes: string | null }>
  excludedItems: Array<{ scope_item: string; site_name: string | null; notes: string | null }>

  /**
   * Approved variations to surface on the statement. Optional — when
   * omitted we skip the variations section. (Phase 4 ships the table.)
   */
  approvedVariations?: Array<{
    variation_number: string
    title: string
    value: number | null
    customer_ref: string | null
  }>

  /** Optional intro paragraph the operator can override per-customer. */
  introOverride?: string | null
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

function heading(text: string, primaryColour: string) {
  return new Paragraph({
    children: [new TextRun({
      text,
      bold: true,
      size: 28,
      color: bareHex(primaryColour),
      font: FONT_BODY,
    })],
    spacing: { before: 280, after: 100 },
  })
}

function para(text: string) {
  return new Paragraph({
    children: [txt(text)],
    spacing: { after: 100 },
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
    ? [new TableRow({
        children: [new TableCell({
          children: [new Paragraph({ children: [txt('No items recorded.', { color: EQ_MID_GREY })], alignment: AlignmentType.CENTER })],
          columnSpan: 3,
          verticalAlign: VerticalAlign.CENTER,
        })],
      })]
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

function buildVariationsTable(
  rows: NonNullable<ScopeStatementInput['approvedVariations']>,
  primaryColour: string,
): Table {
  const header = new TableRow({
    tableHeader: true,
    children: [
      headerCell('Variation #', primaryColour, 18),
      headerCell('Description', primaryColour, 50),
      headerCell('Customer Ref', primaryColour, 16),
      headerCell('Value', primaryColour, 16),
    ],
  })
  const dataRows = rows.length === 0
    ? [new TableRow({
        children: [new TableCell({
          children: [new Paragraph({ children: [txt('No approved variations to date.', { color: EQ_MID_GREY })], alignment: AlignmentType.CENTER })],
          columnSpan: 4,
          verticalAlign: VerticalAlign.CENTER,
        })],
      })]
    : rows.map(r => new TableRow({
        children: [
          bodyCell(r.variation_number),
          bodyCell(r.title),
          bodyCell(r.customer_ref ?? '—'),
          bodyCell(
            r.value === null || r.value === undefined
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

const DEFAULT_INTRO = (customerName: string, fyDisplay: string, includedCount: number) => (
  `This statement summarises the maintenance scope agreed with ${customerName} for ${fyDisplay}. ` +
  `${includedCount} item${includedCount === 1 ? ' is' : 's are'} included under contract; ` +
  'items listed as excluded fall outside the agreed scope and would be quoted separately as variations. ' +
  'Where work falls outside this scope, please refer to the variations section or contact your account manager.'
)

/**
 * Generates the docx Buffer. Caller can pipe through pdf-conversion.ts
 * to get a PDF if a Gotenberg/CloudConvert backend is configured.
 */
export async function generateCustomerScopeStatement(
  input: ScopeStatementInput,
): Promise<Buffer> {
  const settings = resolveShellSettings(input.shellSettings)
  const shell = await prepareShell(settings, input.shellContext)
  const primaryColour = settings.primaryColour
  const customerName = input.shellContext.customerName ?? 'Customer'

  const introText = input.introOverride ?? DEFAULT_INTRO(
    customerName,
    input.financialYearDisplay,
    input.includedItems.length,
  )

  const body: Array<Paragraph | Table> = []

  if (settings.showCover) {
    body.push(...buildCover(shell))
    body.push(new Paragraph({ children: [new PageBreak()] }))
  }

  // Title + intro
  body.push(new Paragraph({
    children: [new TextRun({
      text: `Scope Statement — ${input.financialYearDisplay}`,
      bold: true,
      size: 36,
      color: bareHex(primaryColour),
      font: FONT_BODY,
    })],
    spacing: { after: 200 },
  }))
  body.push(para(introText))

  // Counts strip
  body.push(heading('Summary', primaryColour))
  body.push(new Paragraph({
    children: [
      txt(`Included items: `, { bold: true }),
      txt(String(input.includedItems.length)),
      txt('   ·   '),
      txt('Excluded items: ', { bold: true }),
      txt(String(input.excludedItems.length)),
      ...(input.approvedVariations
        ? [
            txt('   ·   '),
            txt('Approved variations: ', { bold: true }),
            txt(String(input.approvedVariations.length)),
          ]
        : []),
    ],
    spacing: { after: 200 },
  }))

  // Included
  body.push(heading('Items In Scope', primaryColour))
  body.push(buildScopeTable(input.includedItems, primaryColour))

  // Excluded
  body.push(heading('Items Out Of Scope', primaryColour))
  body.push(buildScopeTable(input.excludedItems, primaryColour))

  // Approved variations (if supplied)
  if (input.approvedVariations) {
    body.push(heading('Approved Variations', primaryColour))
    body.push(buildVariationsTable(input.approvedVariations, primaryColour))
  }

  // Sign-off
  if (settings.showSignoff) {
    body.push(...buildSignoff(shell))
  }

  const doc = new Document({
    creator: settings.companyName,
    title: `Scope Statement — ${customerName} — ${input.financialYearDisplay}`,
    sections: [{
      headers: { default: buildHeader(shell) },
      footers: { default: buildFooter(shell) },
      children: body,
    }],
  })

  // docx Packer returns a Buffer in node, ArrayBuffer in browser. We're
  // server-side here, so the cast is safe.
  const buffer = await Packer.toBuffer(doc)
  return buffer as Buffer
}
