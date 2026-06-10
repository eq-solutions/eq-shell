/**
 * PM Asset Report — DOCX Generator
 *
 * Professional preventive maintenance report per site with:
 * - Cover page with site info + photo
 * - Site overview section
 * - Table of contents with internal links
 * - Executive summary with KPI stats
 * - Per-asset report sections (page break between each)
 * - Maintenance checklist tables per asset
 * - Final sign-off page
 * - White-label branding
 *
 * Inspired by the Equinix/SKS PM Asset Report format.
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
  Bookmark,
  InternalHyperlink,
  ImageRun,
  TabStopType,
  TabStopPosition,
} from 'docx'
import { buildMasthead } from '@/lib/reports/report-branding'
import {
  buildHeader as buildShellHeader,
  buildFooter as buildShellFooter,
  prepareShell,
  resolveShellSettings,
} from '@/lib/reports/report-shell'
import { FONT_BODY, FONT_HEADING as FONT_HEADING_TOKEN } from '@/lib/reports/typography'
import {
  EQ_INK,
  EQ_MID_GREY,
  EQ_BORDER,
  EQ_WHITE,
  STATUS_PASS,
  STATUS_FAIL,
  STATUS_WARN,
  mixWithWhite,
} from '@/lib/reports/colours'

// ─────────── Types ───────────

export interface PmAssetReportInput {
  // Complexity level
  complexity?: 'summary' | 'standard' | 'detailed'

  // Report metadata
  reportTitle: string               // e.g. "SY2 - Annual - 04/2026 - April PM"
  reportGeneratedDate: string       // ISO date
  reportingPeriod: string           // e.g. "April 2026" or "Q1 2026"

  // Site info
  siteName: string
  siteCode: string
  siteAddress: string
  customerName: string
  supervisorName: string
  contactEmail: string
  contactPhone: string

  // Check info
  startDate: string
  dueDate: string
  completedDate: string | null
  outstandingAssets: number
  /**
   * Count of check_assets that don't have a Maximo WO number linked.
   * Only meaningful for Maximo-style imported checks; manually-created
   * checks have no WO numbers at all and rendering "5 of 5 outstanding"
   * is more confusing than useful. Pass null to hide the row entirely.
   */
  outstandingWorkOrders: number | null

  // Technician / prepared by
  technicianName: string
  reviewerName: string | null

  // Branding
  tenantProductName: string
  primaryColour: string             // hex e.g. "#1B4F72" or "1B4F72"
  reportTypeLabel?: string          // Phase 1: report type for masthead (e.g. "Per-Asset PM Report")

  // Site photo (optional)
  sitePhoto?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }

  /**
   * Tenant/report logo variants. Cover page (dark surface) prefers `onDark`;
   * running header/body (light surface) prefers `onLight`. Either can fall
   * back to the other — see {@link pickLogo}.
   *
   * @deprecated — pass `logoImageOnLight` / `logoImageOnDark` explicitly.
   *              Kept as an alias so old call sites still compile.
   */
  logoImage?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  logoImageOnLight?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  logoImageOnDark?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }

  /** Customer logo variants (rendered on cover when toggle is on). */
  customerLogoOnLight?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }
  customerLogoOnDark?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }

  // Company details (from report settings)
  companyName?: string
  companyAddress?: string
  companyAbn?: string
  companyPhone?: string

  // Assets
  assets: PmAssetSection[]

  // Linked test records (ACB / NSX / RCD) — Phase 5 of Testing
  // simplification. Optional; renders the Test Records section only when
  // any kind has rows. See AcbTestSummary / NsxTestSummary / RcdTestSummary.
  linkedTests?: LinkedTestsBundle

  // Overall notes
  overallNotes?: string

  // Report template config
  // showSiteOverview field removed 26-Apr-2026 (audit item 7) — site overview
  // is now always rendered. Was only consumed by this generator, never propagated.
  showCoverPage?: boolean        // default true
  showContents?: boolean         // default true
  showExecutiveSummary?: boolean // default true
  showAssetSummary?: boolean     // default true — one-row-per-asset register with progress
  showDefectsRegister?: boolean  // default true — only renders when defects exist
  showSignOff?: boolean          // default true
  customHeaderText?: string      // overrides default header
  customFooterText?: string      // overrides default footer
  signOffFields?: string[]       // default ['Technician Signature', 'Supervisor Signature']
}

export interface PmAssetSection {
  assetName: string
  assetId: string                   // Maximo ID
  site: string
  location: string
  jobPlanName: string               // e.g. "M14.5 - Load banks"
  workOrderNumber?: string | null   // Maximo work order #, if captured via Delta import

  // Maximo WO metadata persisted on check_assets via PR #178. Rendered in the
  // per-asset info grid (priority/work_type/target dates/classification/IR scan)
  // and the failure-chain block below it (failure/problem/cause/remedy — only
  // surfaces when at least one is populated).
  priority?: string | null
  workType?: string | null
  crewId?: string | null
  targetStart?: string | null
  targetFinish?: string | null
  classification?: string | null
  irScanResult?: string | null
  failureCode?: string | null
  problem?: string | null
  cause?: string | null
  remedy?: string | null

  tasks: PmAssetTask[]
  defectsFound?: string
  recommendedAction?: string
  technicianName: string
  completedDate: string | null
  notes?: string
  photos?: { data: Buffer; type: 'png' | 'jpg'; width: number; height: number }[]
}

export interface PmAssetTask {
  order: number
  description: string
  result: 'pass' | 'fail' | 'na' | 'yes' | 'no' | 'requires_followup' | null
  notes?: string
}

/**
 * Per-asset summary rows for ACB / NSX / RCD tests linked to the same
 * maintenance check. Surfaced under a "Test Records" section in the report
 * so a single PDF reflects all the work done at a site visit (Phase 5 of
 * the Testing simplification — 2026-04-28).
 *
 * MVP shape: one row per asset with overall result + light progress info.
 * Full per-circuit / per-reading detail is deferred to a follow-up.
 */
export interface BreakerTestReading {
  label: string                    // e.g. "Contact Resistance R-phase"
  value: string                    // raw text — preserved exactly
  unit: string | null              // e.g. "µΩ" / "MΩ" / "°C"
  isPass: boolean | null           // null = not assessed
}

export interface AcbTestDetail {
  /** Compact breaker-info card (bands of key/value pairs). */
  cbMake: string | null
  cbModel: string | null
  cbSerial: string | null
  cbRating: string | null          // e.g. "1600A"
  poles: string | null             // e.g. "3" / "4"
  tripUnit: string | null
  performanceLevel: string | null  // e.g. "N1" / "H1"
  fixedWithdrawable: string | null
  /** Numerical readings (Visual + Electrical entries on acb_test_readings). */
  readings: BreakerTestReading[]
}

export interface AcbTestSummary {
  assetName: string
  cbMakeModel: string
  testType: string                // 'Initial' / 'Routine' / 'Special'
  testDate: string                // ISO
  stepsDone: number               // 0..3
  stepsTotal: number              // always 3 for current ACB/NSX workflow
  overallResult: 'Pass' | 'Fail' | 'Defect' | 'Pending'
  /**
   * Phase 5 follow-up (PR Q — 2026-04-28): when supplied, the report
   * renders a deep "Test Detail" section per ACB with breaker info +
   * readings table. Absent → just the summary row.
   */
  detail?: AcbTestDetail
}

export interface NsxTestSummary {
  assetName: string
  cbMakeModel: string
  testType: string
  testDate: string
  stepsDone: number
  stepsTotal: number
  overallResult: 'Pass' | 'Fail' | 'Defect' | 'Pending'
  /** Same shape as ACB — see AcbTestDetail. */
  detail?: AcbTestDetail
}

export interface RcdTestSummary {
  assetName: string                  // board name
  jemenaAssetId: string | null
  testDate: string
  circuitCount: number               // total circuits tested
  status: 'draft' | 'complete' | 'archived'
  /**
   * Phase 5 follow-up (PR O — 2026-04-28): when supplied, the report
   * renders a deep "Circuit Timing" section per board with the full
   * per-circuit timing table. Absent → just the summary row.
   */
  circuits?: RcdCircuitRow[]
}

export interface RcdCircuitRow {
  sectionLabel: string | null
  circuitNo: string
  normalTripCurrentMa: number
  jemenaCircuitAssetId: string | null
  x1NoTrip0Ms: string | null
  x1NoTrip180Ms: string | null
  x1Trip0Ms: string | null
  x1Trip180Ms: string | null
  x5Fast0Ms: string | null
  x5Fast180Ms: string | null
  tripTestButtonOk: boolean
  isCriticalLoad: boolean
  actionTaken: string | null
}

export interface LinkedTestsBundle {
  acb?: AcbTestSummary[]
  nsx?: NsxTestSummary[]
  rcd?: RcdTestSummary[]
}

// ─────────── Constants ───────────

const PAGE_WIDTH = 11906  // A4 DXA
const PAGE_HEIGHT = 16838
const MARGIN = 1134       // ~0.79 inch (20mm)
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2  // ~9638

// Local aliases keep the existing inline references readable; sources of
// truth are FONT_BODY / FONT_HEADING_TOKEN from lib/reports/typography.ts
// per Brief v1.3 §6.2.
const FONT = FONT_BODY
const FONT_HEADING = FONT_HEADING_TOKEN

const BORDER_LIGHT = { style: BorderStyle.SINGLE, size: 1, color: EQ_BORDER } as const
const BORDERS_LIGHT = { top: BORDER_LIGHT, bottom: BORDER_LIGHT, left: BORDER_LIGHT, right: BORDER_LIGHT }
// `BorderStyle.NONE` works as a runtime value but the docx type narrows
// to non-NONE for ITableCellBorders — `as const` + cast keeps type-
// checking on the rest of the literal without `any`.
const BORDER_NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const
const BORDERS_NONE: typeof BORDERS_LIGHT = {
  top: BORDER_NONE as unknown as typeof BORDER_LIGHT,
  bottom: BORDER_NONE as unknown as typeof BORDER_LIGHT,
  left: BORDER_NONE as unknown as typeof BORDER_LIGHT,
  right: BORDER_NONE as unknown as typeof BORDER_LIGHT,
}
// Cell padding bumped 2026-04-28 (Royce review issue 9 — "improve sexiness").
// More breathing room across every table cell makes the report read like a
// modern document rather than a municipal-tender form. Vertical 60→90,
// horizontal 100→140. Tight variant left alone — used for nested grids.
const CELL_PAD = { top: 90, bottom: 90, left: 140, right: 140 }
const CELL_PAD_TIGHT = { top: 40, bottom: 40, left: 80, right: 80 }

// ─────────── Helpers ───────────

function getBrand(input: PmAssetReportInput): string {
  return input.primaryColour.replace('#', '')
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    return `${String(d.getDate()).padStart(2, '0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getFullYear()}`
  } catch {
    return dateStr
  }
}

function resultText(r: PmAssetTask['result']): string {
  switch (r) {
    case 'pass': case 'yes': return 'Yes'
    case 'fail': case 'no': return 'No'
    case 'na': return 'N/A'
    case 'requires_followup': return 'Follow-up'
    default: return '—'
  }
}

function resultShading(r: PmAssetTask['result']): string | undefined {
  switch (r) {
    case 'pass': case 'yes': return 'E8F5E9'
    case 'fail': case 'no': return 'FFEBEE'
    case 'requires_followup': return 'FFF8E1'
    default: return undefined
  }
}

function anchorId(assetName: string, assetId: string): string {
  return `asset_${assetId}_${assetName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}`
}

/**
 * Pick the appropriate tenant/report logo image for a given surface.
 *
 * - `light` surface (white cover, running header, body) prefers `logoImageOnLight`
 * - `dark` surface (dark cover variant, ink banners) prefers `logoImageOnDark`
 *
 * Falls back through:
 *   requested variant → other variant → legacy `logoImage` alias
 *
 * Guarantees something renders as long as *any* logo was supplied.
 */
function pickReportLogo(
  input: PmAssetReportInput,
  surface: 'light' | 'dark',
): { data: Buffer; type: 'png' | 'jpg'; width: number; height: number } | undefined {
  if (surface === 'dark') {
    return input.logoImageOnDark ?? input.logoImageOnLight ?? input.logoImage
  }
  return input.logoImageOnLight ?? input.logoImage ?? input.logoImageOnDark
}

/**
 * Pick customer logo for the cover page. Rendered when either variant is
 * provided by the caller — the picker falls back between variants.
 */
function pickCustomerLogo(
  input: PmAssetReportInput,
  surface: 'light' | 'dark',
): { data: Buffer; type: 'png' | 'jpg'; width: number; height: number } | undefined {
  if (surface === 'dark') {
    return input.customerLogoOnDark ?? input.customerLogoOnLight
  }
  return input.customerLogoOnLight ?? input.customerLogoOnDark
}

function makeCell(text: string, width: number, opts?: {
  bold?: boolean; size?: number; color?: string; shading?: string;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  borders?: typeof BORDERS_LIGHT; font?: string; italics?: boolean
}): TableCell {
  return new TableCell({
    borders: opts?.borders ?? BORDERS_LIGHT,
    width: { size: width, type: WidthType.DXA },
    shading: opts?.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: CELL_PAD,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: opts?.align,
      children: [new TextRun({
        text: text || '—',
        bold: opts?.bold,
        size: opts?.size ?? 18,
        font: opts?.font ?? FONT,
        color: opts?.color,
        italics: opts?.italics,
      })]
    })],
  })
}

function makeHeaderCell(text: string, width: number, brand: string): TableCell {
  return new TableCell({
    borders: BORDERS_LIGHT,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: brand, type: ShadingType.CLEAR },
    margins: CELL_PAD,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 18, font: FONT, color: EQ_WHITE })]
    })],
  })
}

function spacer(pts = 200): Paragraph {
  return new Paragraph({ spacing: { before: pts } })
}

function divider(brand: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: brand, space: 1 } },
  })
}

// ─────────── Section Builders ───────────

function buildCoverPage(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const children: (Paragraph | Table)[] = []

  // Masthead with tenant logo + report type label only. Customer logo was
  // dropped here on 2026-05-13 (battle test follow-up): it duplicated the
  // customer name already in headline type on the cover, and PR #39 had
  // already removed it from the cover lockup.
  const customerLogo = pickCustomerLogo(input, 'light')
  const tenantLogo = pickReportLogo(input, 'light')
  if (tenantLogo || input.reportTypeLabel) {
    children.push(
      buildMasthead({
        tenantLogo: tenantLogo ?? undefined,
        reportTypeLabel: input.reportTypeLabel || 'Per-Asset PM Report',
      }),
    )
  }

  // 2026-04-28 (Royce review issue 9): cover redesign. Dropped the second
  // cover-logo block (masthead already has the tenant logo — was rendering
  // it twice). Bumped headline size + spacing for more whitespace. Removed
  // the italic subtitle line — its content is repeated by the report-type
  // label in the masthead.

  // Top accent bar
  children.push(new Paragraph({
    spacing: { after: 800 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: brand, space: 1 } },
  }))

  // Spacer
  children.push(spacer(1600))

  // Report title — uses tenant brand colour so the cover anchors on the
  // tenant's identity, not a generic ink. Larger headline = stronger lede.
  children.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 200 },
    children: [new TextRun({
      text: input.reportTitle,
      bold: true, size: 56, font: FONT_HEADING, color: brand,
    })],
  }))

  // Generated date — kept, italic subtitle dropped.
  children.push(new Paragraph({
    spacing: { after: 800 },
    children: [new TextRun({
      text: `Report Generated: ${fmtDate(input.reportGeneratedDate)}`,
      size: 20, font: FONT, color: EQ_MID_GREY,
    })],
  }))

  // Customer logo — "Prepared for" lockup (only if not already in masthead)
  if (customerLogo && !input.reportTypeLabel) {
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({
        text: 'Prepared for',
        size: 18, font: FONT, color: EQ_MID_GREY,
      })],
    }))
    children.push(new Paragraph({
      spacing: { after: 400 },
      children: [new ImageRun({
        type: customerLogo.type,
        data: customerLogo.data,
        transformation: { width: customerLogo.width, height: customerLogo.height },
        altText: { title: 'Customer Logo', description: `Logo for ${input.customerName}`, name: 'customer-logo' },
      })],
    }))
  }

  // Site photo
  if (input.sitePhoto) {
    children.push(new Paragraph({
      spacing: { after: 400 },
      children: [new ImageRun({
        type: input.sitePhoto.type,
        data: input.sitePhoto.data,
        transformation: { width: input.sitePhoto.width, height: input.sitePhoto.height },
        altText: { title: 'Site Photo', description: `Photo of ${input.siteName}`, name: 'site-photo' },
      })],
    }))
  }

  // Info grid
  const c1 = 2400
  const c2 = 7238
  const tw = c1 + c2

  // Info grid carries the operational metadata (who the report is for and
  // who prepared it). Company name + ABN intentionally NOT listed here —
  // they're rendered in the brand-coloured footer below this grid, which
  // is the visual anchor for tenant identity. Putting them in both places
  // duplicates "SKS Technologies" twice in close proximity on the cover.
  const infoRows: [string, string][] = [
    ['Site', input.siteName],
    ['Customer', input.customerName],
    ['Reporting Period', input.reportingPeriod],
    ['Prepared By', input.technicianName],
    ['Supervisor', input.supervisorName],
  ]

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [c1, c2],
    rows: infoRows.map(([label, value]) =>
      new TableRow({
        children: [
          makeCell(label, c1, { bold: true, color: EQ_MID_GREY, borders: BORDERS_NONE, size: 20 }),
          makeCell(value, c2, { borders: BORDERS_NONE, size: 20 }),
        ],
      })
    ),
  }))

  // Footer branding — the visual anchor for tenant identity on the cover.
  // Left: company name + ABN line in brand colour (this is where the
  // company info from the previous info-grid rows now lives). Right:
  // product attribution in small grey text.
  children.push(spacer(1600))
  const companyText = input.companyName ?? input.tenantProductName
  const companyAbnSuffix = input.companyAbn ? `  ·  ABN ${input.companyAbn}` : ''
  children.push(new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 3, color: brand, space: 1 } },
    spacing: { before: 200 },
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    children: [
      new TextRun({
        text: companyText,
        bold: true, size: 18, font: FONT, color: brand,
      }),
      new TextRun({
        text: companyAbnSuffix,
        size: 16, font: FONT, color: EQ_MID_GREY,
      }),
      new TextRun({ text: '\t' }),
      new TextRun({
        text: input.tenantProductName,
        size: 14, font: FONT, color: EQ_MID_GREY,
      }),
    ],
  }))

  return children
}

function buildSiteOverview(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({
      id: 'site_overview',
      children: [new TextRun({ text: 'Site Overview', bold: true, size: 28, font: FONT_HEADING, color: brand })],
    })],
  }))

  children.push(divider(brand))

  const c1 = 3200
  const c2 = 6438
  const tw = c1 + c2

  const rows: [string, string][] = [
    ['Site Name / Code', `${input.siteName} (${input.siteCode})`],
    ['Address', input.siteAddress],
    ['Customer', input.customerName],
    ['Supervisor', input.supervisorName],
    ['Contact Email', input.contactEmail],
    ['Phone', input.contactPhone],
    ['Start Date', fmtDate(input.startDate)],
    ['Due Date', fmtDate(input.dueDate)],
    ['Completed Date', fmtDate(input.completedDate)],
    ['Outstanding Assets', String(input.outstandingAssets)],
  ]
  // Only surface the WO-tracking row when it's meaningful. Manual-create
  // checks don't have WO#s; rendering "5 of 5 outstanding" is noise.
  if (input.outstandingWorkOrders !== null) {
    rows.push(['Outstanding Work Orders', String(input.outstandingWorkOrders)])
  }

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [c1, c2],
    rows: rows.map(([label, value], i) =>
      new TableRow({
        children: [
          makeCell(label, c1, { bold: true, shading: i % 2 === 0 ? 'F8F9FA' : undefined }),
          makeCell(value, c2, { shading: i % 2 === 0 ? 'F8F9FA' : undefined }),
        ],
      })
    ),
  }))

  return children
}

function buildContentsPage(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({
      id: 'contents',
      children: [new TextRun({ text: 'Contents', bold: true, size: 28, font: FONT_HEADING, color: brand })],
    })],
  }))

  children.push(divider(brand))

  // Fixed sections
  const fixedSections = ['Site Overview', 'Executive Summary', 'Asset Summary']
  for (const section of fixedSections) {
    const anchor = section.toLowerCase().replace(/\s+/g, '_')
    children.push(new Paragraph({
      spacing: { before: 80, after: 80 },
      children: [new InternalHyperlink({
        anchor,
        children: [new TextRun({ text: section, style: 'Hyperlink', size: 20, font: FONT })],
      })],
    }))
  }

  // Spacer before asset list
  children.push(spacer(120))
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Asset Reports', bold: true, size: 22, font: FONT, color: EQ_INK })],
  }))

  // Asset entries
  for (const asset of input.assets) {
    const anchor = anchorId(asset.assetName, asset.assetId)
    children.push(new Paragraph({
      spacing: { before: 40, after: 40 },
      indent: { left: 360 },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new InternalHyperlink({
          anchor,
          children: [new TextRun({
            text: `${asset.assetName} — ${asset.assetId}`,
            style: 'Hyperlink', size: 20, font: FONT,
          })],
        }),
        new TextRun({ text: `\t${asset.jobPlanName}`, size: 18, font: FONT, color: EQ_MID_GREY }),
      ],
    }))
  }

  // Defects Register link
  children.push(spacer(120))
  children.push(new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [new InternalHyperlink({
      anchor: 'defects_register',
      children: [new TextRun({ text: 'Defects Register', style: 'Hyperlink', size: 20, font: FONT })],
    })],
  }))

  // Sign-off link
  children.push(new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [new InternalHyperlink({
      anchor: 'sign_off',
      children: [new TextRun({ text: 'Sign-off & Approval', style: 'Hyperlink', size: 20, font: FONT })],
    })],
  }))

  return children
}

function buildExecutiveSummary(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({
      id: 'executive_summary',
      children: [new TextRun({ text: 'Executive Summary', bold: true, size: 28, font: FONT_HEADING, color: brand })],
    })],
  }))

  children.push(divider(brand))

  // Calculate stats
  const totalAssets = input.assets.length
  let totalTasks = 0
  let passedTasks = 0
  let failedTasks = 0
  let naTasks = 0
  let followUpTasks = 0
  let assetsWithIssues = 0

  for (const asset of input.assets) {
    let assetHasIssue = false
    for (const task of asset.tasks) {
      totalTasks++
      if (task.result === 'pass' || task.result === 'yes') passedTasks++
      else if (task.result === 'fail' || task.result === 'no') { failedTasks++; assetHasIssue = true }
      else if (task.result === 'na') naTasks++
      else if (task.result === 'requires_followup') { followUpTasks++; assetHasIssue = true }
    }
    if (assetHasIssue || asset.defectsFound) assetsWithIssues++
  }

  const assetsPassed = totalAssets - assetsWithIssues
  const passRate = totalTasks > 0 ? Math.round((passedTasks / (totalTasks - naTasks)) * 100) : 0

  // KPI grid — 2x3 table
  const kpiWidth = Math.floor(CONTENT_WIDTH / 3)
  const kpiRemainder = CONTENT_WIDTH - kpiWidth * 3

  function kpiCell(label: string, value: string, color: string, width: number): TableCell {
    return new TableCell({
      borders: BORDERS_LIGHT,
      width: { size: width, type: WidthType.DXA },
      shading: { fill: 'F8F9FA', type: ShadingType.CLEAR },
      margins: { top: 120, bottom: 120, left: 160, right: 160 },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [new TextRun({ text: value, bold: true, size: 36, font: FONT_HEADING, color })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: label, size: 16, font: FONT, color: EQ_MID_GREY })],
        }),
      ],
    })
  }

  children.push(new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [kpiWidth, kpiWidth, kpiWidth + kpiRemainder],
    rows: [
      new TableRow({
        children: [
          kpiCell('Total Assets', String(totalAssets), '2C3E50', kpiWidth),
          kpiCell('Assets Passed', String(assetsPassed), '27AE60', kpiWidth),
          kpiCell('Assets with Issues', String(assetsWithIssues), assetsWithIssues > 0 ? 'E74C3C' : '27AE60', kpiWidth + kpiRemainder),
        ],
      }),
      new TableRow({
        children: [
          kpiCell('Total Tasks', String(totalTasks), '2C3E50', kpiWidth),
          kpiCell('Pass Rate', `${passRate}%`, passRate >= 80 ? '27AE60' : passRate >= 50 ? 'F39C12' : 'E74C3C', kpiWidth),
          kpiCell('Outstanding Actions', String(failedTasks + followUpTasks), failedTasks + followUpTasks > 0 ? 'E74C3C' : '27AE60', kpiWidth + kpiRemainder),
        ],
      }),
    ],
  }))

  // Breakdown table
  children.push(spacer(200))
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: 'Task Breakdown', bold: true, size: 22, font: FONT, color: EQ_INK })],
  }))

  const bc1 = 4000
  const bc2 = 2000
  const btw = bc1 + bc2

  const breakdownRows = [
    ['Passed / Yes', String(passedTasks), 'E8F5E9'],
    ['Failed / No', String(failedTasks), failedTasks > 0 ? 'FFEBEE' : undefined],
    ['N/A', String(naTasks), undefined],
    ['Requires Follow-up', String(followUpTasks), followUpTasks > 0 ? 'FFF8E1' : undefined],
  ]

  children.push(new Table({
    width: { size: btw, type: WidthType.DXA },
    columnWidths: [bc1, bc2],
    rows: [
      new TableRow({
        children: [
          makeHeaderCell('Category', bc1, brand),
          makeHeaderCell('Count', bc2, brand),
        ],
      }),
      ...breakdownRows.map(([label, value, shading]) =>
        new TableRow({
          children: [
            makeCell(label!, bc1, { bold: true, shading: shading as string | undefined }),
            makeCell(value!, bc2, { align: AlignmentType.CENTER, shading: shading as string | undefined }),
          ],
        })
      ),
    ],
  }))

  // Overall notes
  if (input.overallNotes) {
    children.push(spacer(200))
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: 'Key Findings & Notes', bold: true, size: 22, font: FONT, color: EQ_INK })],
    }))
    children.push(new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: input.overallNotes, size: 20, font: FONT, color: EQ_INK })],
    }))
  }

  return children
}

function buildAssetSection(asset: PmAssetSection, brand: string, complexity: 'summary' | 'standard' | 'detailed' = 'standard'): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []
  const anchor = anchorId(asset.assetName, asset.assetId)

  // Asset heading with bookmark
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new Bookmark({
      id: anchor,
      children: [new TextRun({
        text: `${asset.assetName} — ${asset.assetId}`,
        bold: true, size: 26, font: FONT_HEADING, color: brand,
      })],
    })],
  }))

  children.push(divider(brand))

  // Asset info grid (2 columns)
  const c1 = 2000
  const c2 = 2819
  const c3 = 2000
  const c4 = 2819
  const tw = c1 + c2 + c3 + c4

  // Capitalise enum-shaped values for display ('urgent' → 'Urgent').
  const cap = (s: string | null | undefined): string => {
    if (!s) return '—'
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  }
  const upper = (s: string | null | undefined): string => s ? s.toUpperCase() : '—'

  // Whether we have any Maximo metadata to surface. Suppresses the
  // metadata rows entirely for non-Maximo checks so the grid stays clean.
  const hasMaximoMeta = Boolean(
    asset.priority || asset.workType || asset.targetStart ||
    asset.targetFinish || asset.classification || asset.irScanResult,
  )

  // Whether any of the failure-chain fields are populated. These are
  // typically blank on scheduling and only fill in post-completion when
  // a defect was logged, so we render the block conditionally.
  const hasFailureChain = Boolean(
    asset.failureCode || asset.problem || asset.cause || asset.remedy,
  )

  const infoRows: TableRow[] = [
    new TableRow({
      children: [
        makeCell('Site', c1, { bold: true, color: EQ_MID_GREY, size: 16 }),
        makeCell(asset.site, c2, { size: 18, bold: true }),
        makeCell('Asset', c3, { bold: true, color: EQ_MID_GREY, size: 16 }),
        makeCell(asset.assetName, c4, { size: 18, bold: true }),
      ],
    }),
    new TableRow({
      children: [
        makeCell('Location', c1, { bold: true, color: EQ_MID_GREY, size: 16 }),
        makeCell(asset.location, c2, { size: 18 }),
        makeCell('Maximo ID', c3, { bold: true, color: EQ_MID_GREY, size: 16 }),
        makeCell(asset.assetId, c4, { size: 18 }),
      ],
    }),
    new TableRow({
      children: [
        makeCell('Work Order #', c1, { bold: true, color: EQ_MID_GREY, size: 16 }),
        makeCell(asset.workOrderNumber ?? '—', c2, { size: 18 }),
        makeCell('Job Plan', c3, { bold: true, color: EQ_MID_GREY, size: 16 }),
        makeCell(asset.jobPlanName, c4, { size: 18 }),
      ],
    }),
  ]

  if (hasMaximoMeta) {
    infoRows.push(
      new TableRow({
        children: [
          makeCell('Priority', c1, { bold: true, color: EQ_MID_GREY, size: 16 }),
          makeCell(cap(asset.priority), c2, { size: 18 }),
          makeCell('Work Type', c3, { bold: true, color: EQ_MID_GREY, size: 16 }),
          makeCell(upper(asset.workType), c4, { size: 18 }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('Target Start', c1, { bold: true, color: EQ_MID_GREY, size: 16 }),
          makeCell(fmtDate(asset.targetStart ?? null), c2, { size: 18 }),
          makeCell('Target Finish', c3, { bold: true, color: EQ_MID_GREY, size: 16 }),
          makeCell(fmtDate(asset.targetFinish ?? null), c4, { size: 18 }),
        ],
      }),
      new TableRow({
        children: [
          makeCell('Classification', c1, { bold: true, color: EQ_MID_GREY, size: 16 }),
          makeCell(asset.classification ?? '—', c2, { size: 18 }),
          makeCell('IR Scan Result', c3, { bold: true, color: EQ_MID_GREY, size: 16 }),
          makeCell(cap(asset.irScanResult), c4, { size: 18 }),
        ],
      }),
    )
  }

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [c1, c2, c3, c4],
    rows: infoRows,
  }))

  if (hasFailureChain) {
    children.push(spacer(120))
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text: 'Failure Analysis',
        bold: true, size: 20, font: FONT, color: 'C0392B',
      })],
    }))
    const chainRows: TableRow[] = []
    const chain: [string, string | null | undefined][] = [
      ['Failure Code', asset.failureCode],
      ['Problem', asset.problem],
      ['Cause', asset.cause],
      ['Remedy', asset.remedy],
    ]
    for (const [label, value] of chain) {
      if (!value) continue
      chainRows.push(new TableRow({
        children: [
          makeCell(label, c1, { bold: true, color: EQ_MID_GREY, size: 16 }),
          makeCell(value, c2 + c3 + c4, { size: 18 }),
        ],
      }))
    }
    children.push(new Table({
      width: { size: tw, type: WidthType.DXA },
      columnWidths: [c1, c2 + c3 + c4],
      rows: chainRows,
    }))
  }

  if (complexity === 'summary') {
    // Summary: just show pass/fail counts instead of full checklist
    const passed = asset.tasks.filter(t => t.result === 'pass' || t.result === 'yes').length
    const failed = asset.tasks.filter(t => t.result === 'fail' || t.result === 'no').length
    const na = asset.tasks.filter(t => t.result === 'na').length
    const pending = asset.tasks.length - passed - failed - na

    children.push(spacer(120))
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({ text: `${asset.tasks.length} tasks: `, size: 20, font: FONT, color: EQ_INK }),
        new TextRun({ text: `${passed} pass`, bold: true, size: 20, font: FONT, color: STATUS_PASS }),
        new TextRun({ text: ' · ', size: 20, font: FONT, color: EQ_MID_GREY }),
        new TextRun({ text: `${failed} fail`, bold: true, size: 20, font: FONT, color: failed > 0 ? 'C0392B' : '95A5A6' }),
        ...(pending > 0 ? [
          new TextRun({ text: ' · ', size: 20, font: FONT, color: EQ_MID_GREY }),
          new TextRun({ text: `${pending} pending`, size: 20, font: FONT, color: STATUS_WARN }),
        ] : []),
        ...(na > 0 ? [
          new TextRun({ text: ' · ', size: 20, font: FONT, color: EQ_MID_GREY }),
          new TextRun({ text: `${na} N/A`, size: 20, font: FONT, color: EQ_MID_GREY }),
        ] : []),
      ],
    }))

    // Still show defects in summary
    if (asset.defectsFound) {
      children.push(new Paragraph({
        spacing: { after: 60 },
        border: { left: { style: BorderStyle.SINGLE, size: 8, color: STATUS_FAIL, space: 8 } },
        indent: { left: 200 },
        children: [new TextRun({ text: asset.defectsFound, size: 18, font: FONT, color: STATUS_FAIL })],
      }))
    }
  } else {
    // Standard + Detailed: full task checklist
    children.push(spacer(200))
    children.push(new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: 'Maintenance Checklist', bold: true, size: 22, font: FONT, color: EQ_INK })],
    }))

    // Column widths differ by complexity — Detailed gives more room to Notes
    // so longer inspection commentary reads naturally instead of wrapping.
    const tc1 = 700                                      // Order
    const tc3 = 1400                                     // Result
    const tc4 = complexity === 'detailed' ? 3600 : 2800  // Notes
    const tc2 = CONTENT_WIDTH - tc1 - tc3 - tc4          // Description (fills remainder)
    const ttw = tc1 + tc2 + tc3 + tc4

    const taskRows = asset.tasks.map(task => {
      const noteText = task.notes?.trim()
      const hasNote = !!noteText
      // Detailed shows the raw note; Standard trims very long notes to keep
      // the table readable on a single page.
      const displayNote = hasNote
        ? (complexity === 'detailed' || noteText!.length <= 200
            ? noteText!
            : noteText!.slice(0, 200).trimEnd() + '…')
        : '—'

      return new TableRow({
        children: [
          makeCell(String(task.order), tc1, { align: AlignmentType.CENTER, size: 18 }),
          makeCell(task.description, tc2, { size: 18 }),
          makeCell(resultText(task.result), tc3, {
            align: AlignmentType.CENTER,
            bold: true,
            size: 18,
            shading: resultShading(task.result),
            color: task.result === 'fail' || task.result === 'no' ? 'C0392B' : undefined,
          }),
          makeCell(displayNote, tc4, {
            size: 17,
            color: hasNote ? '34495E' : '95A5A6',
            italics: !hasNote,
          }),
        ],
      })
    })

    children.push(new Table({
      width: { size: ttw, type: WidthType.DXA },
      columnWidths: [tc1, tc2, tc3, tc4],
      rows: [
        new TableRow({
          tableHeader: true,
          children: [
            makeHeaderCell('Order', tc1, brand),
            makeHeaderCell('Description', tc2, brand),
            makeHeaderCell('Completed', tc3, brand),
            makeHeaderCell('Notes', tc4, brand),
          ],
        }),
        ...taskRows,
      ],
    }))

    // Defects / issues — always rendered so the reader can see at a glance
    // that a section was reviewed and nothing was flagged.
    const defectText = asset.defectsFound?.trim() || 'None identified.'
    const hasDefect = !!asset.defectsFound?.trim()
    children.push(spacer(160))
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text: 'Defects / Issues Found',
        bold: true, size: 20, font: FONT,
        color: hasDefect ? 'C0392B' : '2C3E50',
      })],
    }))
    children.push(new Paragraph({
      spacing: { after: 80 },
      border: {
        left: {
          style: BorderStyle.SINGLE,
          size: 8,
          color: hasDefect ? 'E74C3C' : 'BDC3C7',
          space: 8,
        },
      },
      indent: { left: 200 },
      children: [new TextRun({
        text: defectText,
        size: 18, font: FONT,
        color: hasDefect ? '34495E' : '7F8C8D',
        italics: !hasDefect,
      })],
    }))

    // Recommended action — always rendered, same pattern as defects
    const actionText = asset.recommendedAction?.trim() || 'No follow-up action required.'
    const hasAction = !!asset.recommendedAction?.trim()
    children.push(spacer(100))
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text: 'Recommended Action',
        bold: true, size: 20, font: FONT,
        color: hasAction ? brand : '2C3E50',
      })],
    }))
    children.push(new Paragraph({
      spacing: { after: 80 },
      border: {
        left: {
          style: BorderStyle.SINGLE,
          size: 8,
          color: hasAction ? brand : 'BDC3C7',
          space: 8,
        },
      },
      indent: { left: 200 },
      children: [new TextRun({
        text: actionText,
        size: 18, font: FONT,
        color: hasAction ? '34495E' : '7F8C8D',
        italics: !hasAction,
      })],
    }))

    // Detailed-only: asset-level notes block (the overall `asset.notes` field)
    if (complexity === 'detailed' && asset.notes?.trim()) {
      children.push(spacer(120))
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: 'Technician Notes', bold: true, size: 20, font: FONT, color: EQ_INK })],
      }))
      children.push(new Paragraph({
        spacing: { after: 80 },
        border: { left: { style: BorderStyle.SINGLE, size: 8, color: EQ_BORDER, space: 8 } },
        indent: { left: 200 },
        children: [new TextRun({ text: asset.notes, size: 18, font: FONT, color: EQ_INK })],
      }))
    }

    // Asset photos (detailed only)
    if (complexity === 'detailed' && asset.photos && asset.photos.length > 0) {
      children.push(spacer(160))
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: 'Asset Photos', bold: true, size: 20, font: FONT, color: EQ_INK })],
      }))
      for (const photo of asset.photos) {
        children.push(new Paragraph({
          spacing: { after: 120 },
          children: [new ImageRun({
            type: photo.type,
            data: photo.data,
            transformation: { width: photo.width, height: photo.height },
            altText: { title: `${asset.assetName} photo`, description: `Photo of ${asset.assetName}`, name: `photo-${asset.assetId}` },
          })],
        }))
      }
    }
  }

  // Confirmation statement
  children.push(spacer(200))
  children.push(new Paragraph({
    spacing: { after: 40 },
    border: { top: { style: BorderStyle.SINGLE, size: 1, color: EQ_BORDER, space: 4 } },
    children: [new TextRun({
      text: 'I confirm that the above work has been carried out successfully as required.',
      italics: true, size: 18, font: FONT, color: EQ_MID_GREY,
    })],
  }))

  // Name and date row
  const sc1 = 4819
  const sc2 = 4819
  const stw = sc1 + sc2

  children.push(new Table({
    width: { size: stw, type: WidthType.DXA },
    columnWidths: [sc1, sc2],
    rows: [
      new TableRow({
        children: [
          makeCell(`Name: ${asset.technicianName}`, sc1, { borders: BORDERS_NONE, size: 18 }),
          makeCell(`Date: ${fmtDate(asset.completedDate)}`, sc2, { borders: BORDERS_NONE, size: 18, align: AlignmentType.RIGHT }),
        ],
      }),
    ],
  }))

  return children
}

function buildSignOff(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({
      id: 'sign_off',
      children: [new TextRun({ text: 'Sign-off & Approval', bold: true, size: 28, font: FONT_HEADING, color: brand })],
    })],
  }))

  children.push(divider(brand))

  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({
      text: 'This report documents the preventive maintenance activities completed for the assets listed above. All work was carried out in accordance with applicable maintenance procedures and safety requirements.',
      size: 20, font: FONT, color: EQ_INK,
    })],
  }))

  // Sign-off table
  const sc1 = 3200
  const sc2 = 6438
  const stw = sc1 + sc2

  const signRows = [
    ['Technician', input.technicianName],
    ['Supervisor / Reviewer', input.reviewerName ?? ''],
    ['Completion Date', fmtDate(input.completedDate)],
    ['Approval Status', input.completedDate ? 'Complete' : 'Pending'],
  ]

  children.push(new Table({
    width: { size: stw, type: WidthType.DXA },
    columnWidths: [sc1, sc2],
    rows: signRows.map(([label, value]) =>
      new TableRow({
        height: { value: 600, rule: 'atLeast' as never },
        children: [
          makeCell(label, sc1, { bold: true, shading: 'F8F9FA' }),
          makeCell(value, sc2),
        ],
      })
    ),
  }))

  // Signature lines (dynamic from settings)
  children.push(spacer(600))

  const fields = input.signOffFields?.length ? input.signOffFields : ['Technician Signature', 'Supervisor Signature']
  // Pair fields into rows of 2
  for (let i = 0; i < fields.length; i += 2) {
    const pair = fields.slice(i, i + 2)
    const sigColW = Math.floor(CONTENT_WIDTH / 2)

    children.push(new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: pair.length === 2 ? [sigColW, CONTENT_WIDTH - sigColW] : [CONTENT_WIDTH],
      rows: [
        new TableRow({
          height: { value: 1200, rule: 'atLeast' as never },
          children: pair.map((label, idx) =>
            new TableCell({
              borders: BORDERS_NONE,
              width: { size: pair.length === 2 ? (idx === 0 ? sigColW : CONTENT_WIDTH - sigColW) : CONTENT_WIDTH, type: WidthType.DXA },
              margins: CELL_PAD,
              children: [
                spacer(400),
                new Paragraph({
                  border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: EQ_INK, space: 1 } },
                  children: [],
                }),
                new Paragraph({
                  spacing: { before: 40 },
                  children: [new TextRun({ text: label, size: 16, font: FONT, color: EQ_MID_GREY })],
                }),
              ],
            })
          ),
        }),
      ],
    }))
  }

  return children
}

// ─────────── Asset status classification ───────────

type AssetStatus = 'complete' | 'defect' | 'in_progress' | 'pending'

interface AssetStats {
  status: AssetStatus
  done: number
  total: number
  failed: number
  followUp: number
}

/**
 * Classify a single asset for the summary/register.
 *
 * - `complete`: every task answered, no fails, no follow-ups
 * - `defect`: any task failed or flagged for follow-up (takes precedence)
 * - `in_progress`: some tasks answered, none failed
 * - `pending`: no tasks answered yet
 */
function classifyAsset(asset: PmAssetSection): AssetStats {
  let done = 0
  let failed = 0
  let followUp = 0
  for (const t of asset.tasks) {
    if (t.result === 'pass' || t.result === 'yes' || t.result === 'na') done++
    else if (t.result === 'fail' || t.result === 'no') { done++; failed++ }
    else if (t.result === 'requires_followup') { done++; followUp++ }
  }
  const total = asset.tasks.length
  let status: AssetStatus
  if (failed > 0 || followUp > 0 || (asset.defectsFound && asset.defectsFound.trim())) status = 'defect'
  else if (done === 0) status = 'pending'
  else if (done < total) status = 'in_progress'
  else status = 'complete'
  return { status, done, total, failed, followUp }
}

function statusBadgeCell(status: AssetStatus, width: number, brand: string): TableCell {
  const text = status === 'complete' ? 'Complete'
    : status === 'defect' ? 'Defect'
    : status === 'in_progress' ? 'In Progress'
    : 'Pending'
  // Pass/fail use semantic status fills (cross-tenant constants); the
  // in-progress badge picks up the tenant brand so SKS reports highlight
  // in-progress in SKS purple, not EQ blue.
  const fill = status === 'complete' ? 'DCFCE7'
    : status === 'defect' ? 'FEF3C7'
    : status === 'in_progress' ? mixWithWhite(brand, 0.85)
    : 'F3F4F6'
  const color = status === 'complete' ? STATUS_PASS
    : status === 'defect' ? STATUS_WARN
    : status === 'in_progress' ? brand
    : EQ_MID_GREY
  return makeCell(text, width, {
    align: AlignmentType.CENTER,
    bold: true,
    size: 16,
    shading: fill,
    color,
  })
}

/**
 * Render a text-only "progress bar" for DOCX — percentage + filled blocks.
 * Actual graphical bars in docx require drawing primitives; the block
 * glyphs give a clean visual in a single cell and print reliably.
 */
function progressCell(done: number, total: number, width: number, brand: string): TableCell {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const segments = 10
  const filled = Math.round((pct / 100) * segments)
  const bar = '█'.repeat(filled) + '░'.repeat(segments - filled)
  // Bar colour: pass-green at 100%, tenant brand for in-progress, light
  // border-grey for empty. Previously hardcoded EQ Sky for in-progress
  // which leaked EQ branding into SKS reports.
  const barColour = pct === 100 ? STATUS_PASS : pct > 0 ? brand : EQ_BORDER
  return new TableCell({
    borders: BORDERS_LIGHT,
    width: { size: width, type: WidthType.DXA },
    margins: CELL_PAD_TIGHT,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({ text: bar, size: 14, font: FONT, color: barColour }),
        new TextRun({ text: `  ${pct}%`, size: 14, font: FONT, color: EQ_MID_GREY }),
      ],
    })],
  })
}

function buildAssetSummary(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({
      id: 'asset_summary',
      children: [new TextRun({ text: 'Asset Summary', bold: true, size: 28, font: FONT_HEADING, color: brand })],
    })],
  }))

  children.push(divider(brand))

  // Column widths — total ≈ CONTENT_WIDTH (9638)
  const wAsset   = 1900
  const wMaximo  = 1500
  const wLoc     = 1800
  const wWO      = 1300
  const wTasks   = 900
  const wProg    = 1300
  const wStatus  = CONTENT_WIDTH - (wAsset + wMaximo + wLoc + wWO + wTasks + wProg)
  const tw = wAsset + wMaximo + wLoc + wWO + wTasks + wProg + wStatus

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      makeHeaderCell('Asset', wAsset, brand),
      makeHeaderCell('Maximo ID', wMaximo, brand),
      makeHeaderCell('Location', wLoc, brand),
      makeHeaderCell('WO #', wWO, brand),
      makeHeaderCell('Tasks', wTasks, brand),
      makeHeaderCell('Progress', wProg, brand),
      makeHeaderCell('Status', wStatus, brand),
    ],
  })

  const dataRows = input.assets.map(asset => {
    const s = classifyAsset(asset)
    return new TableRow({
      children: [
        makeCell(asset.assetName, wAsset, { bold: true, size: 17 }),
        makeCell(asset.assetId, wMaximo, { size: 17 }),
        makeCell(asset.location, wLoc, { size: 17 }),
        makeCell(asset.workOrderNumber ?? '—', wWO, { size: 17 }),
        makeCell(`${s.done}/${s.total}`, wTasks, { size: 17, align: AlignmentType.CENTER }),
        progressCell(s.done, s.total, wProg, brand),
        statusBadgeCell(s.status, wStatus, brand),
      ],
    })
  })

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [wAsset, wMaximo, wLoc, wWO, wTasks, wProg, wStatus],
    rows: [headerRow, ...dataRows],
  }))

  return children
}

/**
 * Test Records section — one summary table per linked test type
 * (ACB / NSX / RCD). Renders nothing when no tests are linked. Phase 5
 * of the Testing simplification — single PDF reflects every kind of work
 * done at the visit, not just the maintenance items.
 */
function buildLinkedTestsSummary(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const linked = input.linkedTests ?? {}
  const acb = linked.acb ?? []
  const nsx = linked.nsx ?? []
  const rcd = linked.rcd ?? []
  if (acb.length === 0 && nsx.length === 0 && rcd.length === 0) return []

  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({
      id: 'test_records',
      children: [new TextRun({ text: 'Test Records', bold: true, size: 28, font: FONT_HEADING, color: brand })],
    })],
  }))

  children.push(divider(brand))

  children.push(new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({
      text: `${acb.length + nsx.length + rcd.length} test record${acb.length + nsx.length + rcd.length === 1 ? '' : 's'} linked to this check across ${[acb.length && 'ACB', nsx.length && 'NSX', rcd.length && 'RCD'].filter(Boolean).join(' / ')}.`,
      size: 18,
      font: FONT,
      color: EQ_MID_GREY,
    })],
  }))

  if (acb.length > 0) children.push(...buildAcbNsxSummaryTable('ACB Tests', acb, brand))
  if (nsx.length > 0) children.push(...buildAcbNsxSummaryTable('NSX Tests', nsx, brand))
  if (rcd.length > 0) children.push(...buildRcdSummaryTable(rcd, brand))

  // Phase 5 follow-up (PR Q): ACB / NSX deep detail. When any test in
  // either set carries a `detail` payload (breaker info + readings),
  // render a deep section per test below the summary tables. Mirrors
  // RCD's per-board section. Customer-facing compliance evidence.
  const acbWithDetail = acb.filter((t): t is AcbTestSummary & { detail: AcbTestDetail } => !!t.detail)
  const nsxWithDetail = nsx.filter((t): t is NsxTestSummary & { detail: AcbTestDetail } => !!t.detail)
  if (acbWithDetail.length > 0 || nsxWithDetail.length > 0) {
    children.push(new Paragraph({
      spacing: { before: 320, after: 100 },
      children: [new TextRun({
        text: 'Breaker Test Detail',
        bold: true, size: 22, font: FONT_HEADING, color: brand,
      })],
    }))
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({
        text: 'Per-breaker identification and recorded readings. Visual / functional pass-fail entries collapse into reading rows; numerical readings keep their original units.',
        size: 16, font: FONT, color: EQ_MID_GREY, italics: true,
      })],
    }))
    for (const t of acbWithDetail) {
      children.push(...buildBreakerTestDetail('ACB', t, brand))
    }
    for (const t of nsxWithDetail) {
      children.push(...buildBreakerTestDetail('NSX', t, brand))
    }
  }

  // Phase 5 follow-up (PR O): when any RCD test carries detailed circuit
  // data, render a deep section per board with the full per-circuit timing
  // table. Customer-facing compliance evidence per AS/NZS 3760.
  const rcdWithDetail = rcd.filter((r) => Array.isArray(r.circuits) && r.circuits.length > 0)
  if (rcdWithDetail.length > 0) {
    children.push(new Paragraph({
      spacing: { before: 320, after: 100 },
      children: [new TextRun({
        text: 'RCD Circuit Timing — Per Board',
        bold: true, size: 22, font: FONT_HEADING, color: brand,
      })],
    }))
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({
        text: 'All times in milliseconds. Empty / "" = no trip recorded. AS/NZS 3760 reference: x1 trip ≤ 300 ms · x5 fast ≤ 40 ms.',
        size: 16, font: FONT, color: EQ_MID_GREY, italics: true,
      })],
    }))
    for (const board of rcdWithDetail) {
      children.push(...buildRcdCircuitDetail(board, brand))
    }
  }

  return children
}

function buildRcdCircuitDetail(board: RcdTestSummary, brand: string): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []
  const circuits = board.circuits ?? []

  // Per-board heading
  const idSuffix = board.jemenaAssetId ? ` · ${board.jemenaAssetId}` : ''
  children.push(new Paragraph({
    spacing: { before: 240, after: 60 },
    children: [new TextRun({
      text: `${board.assetName}${idSuffix}`,
      bold: true, size: 18, font: FONT_HEADING, color: brand,
    })],
  }))
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({
      text: `${circuits.length} circuit${circuits.length === 1 ? '' : 's'} · tested ${fmtDate(board.testDate)}`,
      size: 14, font: FONT, color: EQ_MID_GREY,
    })],
  }))

  // Column widths — total = CONTENT_WIDTH (9638 dxa)
  const wSec = 1100   // Section
  const wCkt = 700    // Circuit #
  const wRating = 700 // Trip mA
  const wX1NT = 1300  // X1 no-trip (combined 0/180)
  const wX1T = 1300   // X1 trip
  const wX5 = 1300    // X5 fast
  const wBtn = 600    // Btn ✓
  const wAct = CONTENT_WIDTH - (wSec + wCkt + wRating + wX1NT + wX1T + wX5 + wBtn)
  const tw = wSec + wCkt + wRating + wX1NT + wX1T + wX5 + wBtn + wAct

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      makeHeaderCell('Section', wSec, brand),
      makeHeaderCell('Cct #', wCkt, brand),
      makeHeaderCell('Trip mA', wRating, brand),
      makeHeaderCell('X1 No-Trip 0°/180°', wX1NT, brand),
      makeHeaderCell('X1 Trip 0°/180°', wX1T, brand),
      makeHeaderCell('X5 Fast 0°/180°', wX5, brand),
      makeHeaderCell('Btn', wBtn, brand),
      makeHeaderCell('Action / Notes', wAct, brand),
    ],
  })

  const fmtPair = (a: string | null, b: string | null) =>
    [a, b].map((v) => (v && v.length > 0 ? v : '—')).join(' / ')

  const dataRows = circuits.map((c) =>
    new TableRow({
      children: [
        makeCell(c.sectionLabel ?? '—', wSec, { size: 14 }),
        makeCell(c.circuitNo, wCkt, { size: 14, bold: true }),
        makeCell(String(c.normalTripCurrentMa), wRating, { size: 14, align: AlignmentType.CENTER }),
        makeCell(fmtPair(c.x1NoTrip0Ms, c.x1NoTrip180Ms), wX1NT, { size: 14, align: AlignmentType.CENTER }),
        makeCell(fmtPair(c.x1Trip0Ms, c.x1Trip180Ms), wX1T, { size: 14, align: AlignmentType.CENTER }),
        makeCell(fmtPair(c.x5Fast0Ms, c.x5Fast180Ms), wX5, { size: 14, align: AlignmentType.CENTER }),
        makeCell(c.tripTestButtonOk ? '✓' : '—', wBtn, { size: 14, align: AlignmentType.CENTER, bold: c.tripTestButtonOk }),
        makeCell(
          c.isCriticalLoad
            ? `CRITICAL · ${c.actionTaken ?? '—'}`
            : (c.actionTaken ?? '—'),
          wAct,
          {
            size: 14,
            shading: c.isCriticalLoad ? 'FFF8E1' : undefined,
            color: c.isCriticalLoad ? STATUS_WARN : undefined,
          },
        ),
      ],
    }),
  )

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [wSec, wCkt, wRating, wX1NT, wX1T, wX5, wBtn, wAct],
    rows: [headerRow, ...dataRows],
  }))

  return children
}

/**
 * Per-breaker detail card — used for both ACB and NSX. Two stacked tables:
 *   1. Breaker identification grid (Brand / Model / Serial / Rating /
 *      Poles / Trip Unit / Performance Level / Fixed-Withdrawable)
 *   2. Test readings table (label, value, unit, pass/fail) — straight
 *      dump of acb_test_readings / nsx_test_readings entries.
 */
function buildBreakerTestDetail(
  kind: 'ACB' | 'NSX',
  test: (AcbTestSummary | NsxTestSummary) & { detail: AcbTestDetail },
  brand: string,
): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []
  const d = test.detail

  // Heading
  children.push(new Paragraph({
    spacing: { before: 240, after: 60 },
    children: [new TextRun({
      text: `${test.assetName}  ·  ${kind}`,
      bold: true, size: 18, font: FONT_HEADING, color: brand,
    })],
  }))
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({
      text: `Tested ${fmtDate(test.testDate)} · ${test.testType ?? '—'} · Result: ${test.overallResult}`,
      size: 14, font: FONT, color: EQ_MID_GREY,
    })],
  }))

  // Breaker info grid — 4 columns, 2 rows of pairs.
  const cLabel = 1700
  const cValue = 3119
  const tw = (cLabel + cValue) * 2
  const infoRows: Array<[string, string | null, string, string | null]> = [
    ['Brand',             d.cbMake,            'Model',             d.cbModel],
    ['Serial No',         d.cbSerial,          'Current Rating',    d.cbRating],
    ['Number of Poles',   d.poles,             'Trip Unit',         d.tripUnit],
    ['Performance Level', d.performanceLevel,  'Fixed / Withdrawable', d.fixedWithdrawable],
  ]
  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [cLabel, cValue, cLabel, cValue],
    rows: infoRows.map(([l1, v1, l2, v2]) =>
      new TableRow({
        children: [
          makeCell(l1, cLabel, { bold: true, color: EQ_MID_GREY, size: 14 }),
          makeCell(v1 ?? '—', cValue, { size: 16, bold: true }),
          makeCell(l2, cLabel, { bold: true, color: EQ_MID_GREY, size: 14 }),
          makeCell(v2 ?? '—', cValue, { size: 16, bold: true }),
        ],
      }),
    ),
  }))

  // Readings table
  if (d.readings.length > 0) {
    children.push(new Paragraph({
      spacing: { before: 160, after: 60 },
      children: [new TextRun({
        text: 'Test Readings',
        bold: true, size: 16, font: FONT_HEADING, color: brand,
      })],
    }))
    const rLabel = 4500
    const rValue = 1900
    const rUnit = 1100
    const rPass = CONTENT_WIDTH - (rLabel + rValue + rUnit)
    const rTw = rLabel + rValue + rUnit + rPass

    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        makeHeaderCell('Reading', rLabel, brand),
        makeHeaderCell('Value', rValue, brand),
        makeHeaderCell('Unit', rUnit, brand),
        makeHeaderCell('Pass / Fail', rPass, brand),
      ],
    })
    const dataRows = d.readings.map((r) =>
      new TableRow({
        children: [
          makeCell(r.label, rLabel, { size: 14 }),
          makeCell(r.value || '—', rValue, { size: 14, bold: true, align: AlignmentType.CENTER }),
          makeCell(r.unit ?? '—', rUnit, { size: 14, align: AlignmentType.CENTER, color: EQ_MID_GREY }),
          makeCell(
            r.isPass === null ? '—' : r.isPass ? 'Pass' : 'Fail',
            rPass,
            {
              size: 14,
              bold: r.isPass !== null,
              align: AlignmentType.CENTER,
              shading: r.isPass === true ? 'E8F5E9' : r.isPass === false ? 'FFEBEE' : undefined,
              color: r.isPass === true ? STATUS_PASS : r.isPass === false ? STATUS_FAIL : undefined,
            },
          ),
        ],
      }),
    )
    children.push(new Table({
      width: { size: rTw, type: WidthType.DXA },
      columnWidths: [rLabel, rValue, rUnit, rPass],
      rows: [headerRow, ...dataRows],
    }))
  } else {
    children.push(new Paragraph({
      spacing: { before: 80, after: 80 },
      children: [new TextRun({
        text: 'No readings recorded — workflow steps not yet completed.',
        size: 14, font: FONT, color: EQ_MID_GREY, italics: true,
      })],
    }))
  }

  return children
}

function buildAcbNsxSummaryTable(
  title: string,
  rows: AcbTestSummary[] | NsxTestSummary[],
  brand: string,
): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: title, bold: true, size: 22, font: FONT_HEADING, color: brand })],
  }))

  const wAsset = 2200
  const wMakeModel = 2400
  const wType = 1200
  const wDate = 1500
  const wProgress = 1100
  const wResult = CONTENT_WIDTH - (wAsset + wMakeModel + wType + wDate + wProgress)
  const tw = wAsset + wMakeModel + wType + wDate + wProgress + wResult

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      makeHeaderCell('Asset', wAsset, brand),
      makeHeaderCell('Breaker', wMakeModel, brand),
      makeHeaderCell('Type', wType, brand),
      makeHeaderCell('Date', wDate, brand),
      makeHeaderCell('Steps', wProgress, brand),
      makeHeaderCell('Result', wResult, brand),
    ],
  })

  const dataRows = rows.map((r) =>
    new TableRow({
      children: [
        makeCell(r.assetName, wAsset, { bold: true, size: 17 }),
        makeCell(r.cbMakeModel || '—', wMakeModel, { size: 17 }),
        makeCell(r.testType || '—', wType, { size: 17 }),
        makeCell(fmtDate(r.testDate), wDate, { size: 17 }),
        makeCell(`${r.stepsDone}/${r.stepsTotal}`, wProgress, { size: 17, align: AlignmentType.CENTER }),
        makeCell(r.overallResult, wResult, {
          size: 17,
          bold: true,
          shading: resultShadingForTest(r.overallResult),
          color: resultColorForTest(r.overallResult),
        }),
      ],
    }),
  )

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [wAsset, wMakeModel, wType, wDate, wProgress, wResult],
    rows: [headerRow, ...dataRows],
  }))

  return children
}

function buildRcdSummaryTable(
  rows: RcdTestSummary[],
  brand: string,
): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: 'RCD Tests', bold: true, size: 22, font: FONT_HEADING, color: brand })],
  }))

  const wBoard = 2600
  const wJemena = 1700
  const wDate = 1700
  const wCircuits = 1400
  const wStatus = CONTENT_WIDTH - (wBoard + wJemena + wDate + wCircuits)
  const tw = wBoard + wJemena + wDate + wCircuits + wStatus

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      makeHeaderCell('Board', wBoard, brand),
      makeHeaderCell('Jemena ID', wJemena, brand),
      makeHeaderCell('Date', wDate, brand),
      makeHeaderCell('Circuits', wCircuits, brand),
      makeHeaderCell('Status', wStatus, brand),
    ],
  })

  const dataRows = rows.map((r) =>
    new TableRow({
      children: [
        makeCell(r.assetName, wBoard, { bold: true, size: 17 }),
        makeCell(r.jemenaAssetId ?? '—', wJemena, { size: 17, font: FONT }),
        makeCell(fmtDate(r.testDate), wDate, { size: 17 }),
        makeCell(String(r.circuitCount), wCircuits, { size: 17, align: AlignmentType.CENTER }),
        makeCell(rcdStatusLabel(r.status), wStatus, {
          size: 17,
          bold: true,
          shading: rcdStatusShading(r.status),
          color: rcdStatusColor(r.status),
        }),
      ],
    }),
  )

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [wBoard, wJemena, wDate, wCircuits, wStatus],
    rows: [headerRow, ...dataRows],
  }))

  return children
}

function resultShadingForTest(r: 'Pass' | 'Fail' | 'Defect' | 'Pending'): string | undefined {
  if (r === 'Pass') return 'E8F5E9'
  if (r === 'Fail' || r === 'Defect') return 'FFEBEE'
  return undefined
}

function resultColorForTest(r: 'Pass' | 'Fail' | 'Defect' | 'Pending'): string | undefined {
  if (r === 'Pass') return STATUS_PASS
  if (r === 'Fail' || r === 'Defect') return STATUS_FAIL
  return EQ_INK
}

function rcdStatusLabel(s: 'draft' | 'complete' | 'archived'): string {
  if (s === 'complete') return 'Complete'
  if (s === 'archived') return 'Archived'
  return 'Draft'
}

function rcdStatusShading(s: 'draft' | 'complete' | 'archived'): string | undefined {
  if (s === 'complete') return 'E8F5E9'
  if (s === 'archived') return undefined
  return 'FFF8E1'
}

function rcdStatusColor(s: 'draft' | 'complete' | 'archived'): string | undefined {
  if (s === 'complete') return STATUS_PASS
  if (s === 'draft') return STATUS_WARN
  return EQ_MID_GREY
}

function buildDefectsRegister(input: PmAssetReportInput): (Paragraph | Table)[] {
  const brand = getBrand(input)
  const children: (Paragraph | Table)[] = []

  // Collect defect rows from failed/follow-up tasks + asset-level defectsFound.
  interface DefectRow {
    assetName: string
    description: string
    raisedBy: string
    date: string
    severity: 'high' | 'medium' | 'low'
  }
  const rows: DefectRow[] = []

  for (const asset of input.assets) {
    const failedTasks = asset.tasks.filter(t => t.result === 'fail' || t.result === 'no')
    const followUpTasks = asset.tasks.filter(t => t.result === 'requires_followup')

    for (const t of failedTasks) {
      const desc = t.notes?.trim()
        ? `${t.description} — ${t.notes.trim()}`
        : t.description
      rows.push({
        assetName: asset.assetName,
        description: desc,
        raisedBy: asset.technicianName,
        date: fmtDate(asset.completedDate),
        severity: 'high',
      })
    }
    for (const t of followUpTasks) {
      const desc = t.notes?.trim()
        ? `${t.description} — ${t.notes.trim()}`
        : t.description
      rows.push({
        assetName: asset.assetName,
        description: desc,
        raisedBy: asset.technicianName,
        date: fmtDate(asset.completedDate),
        severity: 'medium',
      })
    }
    // Asset-level defectsFound catches anything not already covered by a task row
    if (asset.defectsFound?.trim() && failedTasks.length === 0 && followUpTasks.length === 0) {
      rows.push({
        assetName: asset.assetName,
        description: asset.defectsFound.trim(),
        raisedBy: asset.technicianName,
        date: fmtDate(asset.completedDate),
        severity: 'medium',
      })
    }
  }

  // No defects? Render an empty-state instead of suppressing, so the reader
  // has positive confirmation nothing was flagged.
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new Bookmark({
      id: 'defects_register',
      children: [new TextRun({ text: 'Defects Register', bold: true, size: 28, font: FONT_HEADING, color: brand })],
    })],
  }))

  children.push(divider(brand))

  if (rows.length === 0) {
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({
        text: 'No defects identified during this maintenance check.',
        italics: true, size: 20, font: FONT, color: STATUS_PASS,
      })],
    }))
    return children
  }

  const wSev    = 1200
  const wAsset  = 1800
  const wDesc   = CONTENT_WIDTH - (1200 + 1800 + 1600 + 1400 + 1200)
  const wBy     = 1600
  const wDate   = 1400
  const wStat   = 1200
  const tw = wSev + wAsset + wDesc + wBy + wDate + wStat

  const sevCell = (sev: 'high' | 'medium' | 'low', width: number) => {
    const label = sev === 'high' ? 'High' : sev === 'medium' ? 'Medium' : 'Low'
    const fill = sev === 'high' ? 'FEE2E2' : sev === 'medium' ? 'FEF3C7' : 'EAF5FB'
    const color = sev === 'high' ? 'B91C1C' : sev === 'medium' ? 'B45309' : '2986B4'
    return makeCell(label, width, {
      align: AlignmentType.CENTER,
      bold: true,
      size: 16,
      shading: fill,
      color,
    })
  }

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      makeHeaderCell('Severity', wSev, brand),
      makeHeaderCell('Asset', wAsset, brand),
      makeHeaderCell('Description', wDesc, brand),
      makeHeaderCell('Raised By', wBy, brand),
      makeHeaderCell('Date', wDate, brand),
      makeHeaderCell('Status', wStat, brand),
    ],
  })

  const dataRows = rows.map(r =>
    new TableRow({
      children: [
        sevCell(r.severity, wSev),
        makeCell(r.assetName, wAsset, { bold: true, size: 17 }),
        makeCell(r.description, wDesc, { size: 17 }),
        makeCell(r.raisedBy, wBy, { size: 17 }),
        makeCell(r.date, wDate, { size: 17 }),
        makeCell('Open', wStat, {
          align: AlignmentType.CENTER,
          bold: true,
          size: 16,
          shading: 'FEF3C7',
          color: STATUS_WARN,
        }),
      ],
    })
  )

  children.push(new Table({
    width: { size: tw, type: WidthType.DXA },
    columnWidths: [wSev, wAsset, wDesc, wBy, wDate, wStat],
    rows: [headerRow, ...dataRows],
  }))

  return children
}

// ─────────── Main Export ───────────

export async function generatePMAssetReport(input: PmAssetReportInput): Promise<Buffer> {
  const brand = getBrand(input)

  const complexity = input.complexity ?? 'standard'

  // Resolve section toggles (default all true)
  const showCover = input.showCoverPage !== false
  // Site overview always rendered — toggle removed 26-Apr-2026 (audit item 7).
  const showOverview = true
  // Summary skips TOC and executive summary unless explicitly enabled
  const showContents = complexity === 'summary' ? false : input.showContents !== false
  const showSummary = input.showExecutiveSummary !== false
  const showAssetSummary = input.showAssetSummary !== false
  const showDefectsRegister = input.showDefectsRegister !== false
  const showSignOff = input.showSignOff !== false

  // Custom header / footer text
  const headerText = input.customHeaderText || input.reportTitle
  const footerText = input.customFooterText || `${input.companyName || input.tenantProductName} — Per-Asset PM Report — rev 3.1`

  // Sprint 2.3 (26-Apr-2026): adopt shared ReportShell for header/footer.
  const shell = await prepareShell(
    resolveShellSettings({
      companyName: input.companyName ?? input.tenantProductName,
      productName: input.tenantProductName,
      primaryColour: input.primaryColour,
      complexity,
      headerText,
      footerText,
    }),
    {
      reportType: 'maintenance_check',
      reportDate: new Date().toLocaleDateString('en-AU'),
      customerName: input.companyName ?? null,
      siteName: input.siteName ?? null,
      siteAddress: null,
      customerLogoUrl: null,
      sitePhotoUrl: null,
    },
  )

  // Build all per-asset sections with page breaks
  const assetSectionChildren: (Paragraph | Table)[] = []
  for (let i = 0; i < input.assets.length; i++) {
    if (i > 0) {
      assetSectionChildren.push(new Paragraph({ children: [new PageBreak()] }))
    }
    assetSectionChildren.push(...buildAssetSection(input.assets[i], brand, complexity))
  }

  // Build body content (conditionally include sections)
  const bodyChildren: (Paragraph | Table)[] = []

  if (showOverview) {
    bodyChildren.push(...buildSiteOverview(input))
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
  }
  if (showContents) {
    bodyChildren.push(...buildContentsPage(input))
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
  }
  if (showSummary) {
    bodyChildren.push(...buildExecutiveSummary(input))
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
  }
  if (showAssetSummary && input.assets.length > 0) {
    bodyChildren.push(...buildAssetSummary(input))
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
  }

  bodyChildren.push(...assetSectionChildren)

  // Phase 5: Test Records section. Renders only when linkedTests has rows
  // (returns [] otherwise). Sits after per-asset detail and before the
  // defects register so the PDF flows: maintenance work → test work →
  // defects → sign-off.
  const testRecordsSection = buildLinkedTestsSummary(input)
  if (testRecordsSection.length > 0) {
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
    bodyChildren.push(...testRecordsSection)
  }

  if (showDefectsRegister) {
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
    bodyChildren.push(...buildDefectsRegister(input))
  }

  if (showSignOff) {
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }))
    bodyChildren.push(...buildSignOff(input))
  }

  const sections = []

  // Cover page section (separate — no header/footer)
  if (showCover) {
    sections.push({
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      children: buildCoverPage(input),
    })
  }

  // Body section with header/footer
  sections.push({
    properties: {
      page: {
        size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    },
    headers: { default: buildShellHeader(shell) },
    footers: { default: buildShellFooter(shell) },
    children: bodyChildren,
  })

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 20 } },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: FONT_HEADING, color: brand },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, font: FONT_HEADING, color: brand },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 },
        },
      ],
    },
    sections,
  })

  const buffer = await Packer.toBuffer(doc)
  return buffer as Buffer
}
