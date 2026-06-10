/**
 * Report Shell — Shared cover/header/footer/sign-off scaffolding.
 *
 * Every customer-facing PDF the app generates (Compliance, ACB test, NSX test,
 * General test, Maintenance check, Defect register) should compose its body
 * inside the same shell. This module is the shell.
 *
 * Why this exists:
 *   Before this, every generator copy-pasted its own cover/header/footer in
 *   isolation. Result: 6 different looks, 6 different places to fix bugs,
 *   inconsistent customer experience. After this, all 6 reports share a
 *   single visual identity driven by Report Settings (/admin/reports).
 *
 * How it composes:
 *   Each generator imports buildCover(), buildHeader(), buildFooter(),
 *   buildSignoff() and stitches them around its own per-report body. The
 *   shell handles logo fetching, brand colours, contact blocks, dates, and
 *   sign-off lines — the body author only worries about the data tables.
 *
 * Driven by:
 *   - tenant_settings (report_company_name, report_logo_url, primary_colour,
 *     report_complexity, report_show_sections, report_signoff_*, etc.)
 *   - Per-report overrides passed via ShellOptions.
 *
 * Complexity levels (from Report Settings):
 *   - 'summary'  — just the headline numbers and pass/fail per asset.
 *   - 'standard' — summary + key readings, no per-task breakdown.
 *   - 'detailed' — everything: task-by-task results, comments, photos.
 */

import {
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  AlignmentType,
  BorderStyle,
  WidthType,
  PageNumber,
  ImageRun,
  ShadingType,
  VerticalAlign,
} from 'docx'
import { fetchLogoImage, type LogoImage } from './report-branding'
import { FONT_BODY } from './typography'
import { EQ_MID_GREY } from './colours'
import {
  CUSTOMER_LOGO_LIGHT,
  TENANT_LOGO_LIGHT,
  TENANT_LOGO_ON_DARK,
  SITE_PHOTO_COVER,
} from './sizing'

// ─────────── Types ───────────

export type ReportComplexity = 'summary' | 'standard' | 'detailed'

export type ReportType =
  | 'compliance'
  | 'acb_test'
  | 'nsx_test'
  | 'general_test'
  | 'maintenance_check'
  | 'defect_register'
  | 'customer_scope_statement'
  | 'customer_renewal_pack'

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  compliance: 'Compliance Report',
  acb_test: 'ACB Test Report',
  nsx_test: 'NSX Test Report',
  general_test: 'General Test Report',
  maintenance_check: 'Maintenance Check Report',
  defect_register: 'Defect Register',
  customer_scope_statement: 'Customer Scope Statement',
  customer_renewal_pack: 'Customer Renewal Pack',
}

export interface ShellSettings {
  /** Tenant display name on cover/footer. */
  companyName: string
  /** Tenant product name (e.g. "EQ Solves Service"). */
  productName: string
  /** Hex primary brand colour, e.g. '#3DA8D8'. */
  primaryColour: string
  /**
   * Optional tenant-set deep / ice / ink colours. When set (e.g. via the
   * Tenant Settings → Branding → Extract Colours flow), reports use these
   * exact values for accent surfaces, soft fills, and body text. When
   * null/undefined, generators derive deep/ice from primaryColour and use
   * EQ_INK for body text.
   */
  deepColour: string | null
  iceColour: string | null
  inkColour: string | null
  /** Tenant report logo (light surface — body pages). */
  tenantLogoUrl: string | null
  /** Tenant report logo (dark surface — cover page band). */
  tenantLogoOnDarkUrl: string | null

  /** Section toggles. */
  showCover: boolean
  showContents: boolean
  showSummary: boolean
  showSignoff: boolean

  /** Detail level. */
  complexity: ReportComplexity

  /** Custom header/footer strings. */
  headerText: string | null
  footerText: string | null

  /** Sign-off configuration. */
  signoffPreparedBy: string | null
  signoffApprovedBy: string | null
  signoffNotes: string | null
}

export interface ShellContext {
  /** Which report this is — drives the title and footer label. */
  reportType: ReportType
  /** Report-friendly date (e.g. "26 April 2026"). */
  reportDate: string
  /** Customer name (cover line + footer if no companyName override). */
  customerName: string | null
  /** Site name (cover subtitle). */
  siteName: string | null
  /** Address (cover detail line). */
  siteAddress: string | null
  /** Customer logo URL (light). */
  customerLogoUrl: string | null
  /** Site photo URL (cover hero image). */
  sitePhotoUrl: string | null
}

export interface ResolvedShell {
  settings: ShellSettings
  ctx: ShellContext
  customerLogo?: LogoImage
  tenantLogo?: LogoImage
  tenantLogoOnDark?: LogoImage
  sitePhoto?: LogoImage
}

// ─────────── Defaults ───────────

const DEFAULT_SETTINGS: ShellSettings = {
  companyName: 'EQ Solves',
  productName: 'EQ Solves Service',
  primaryColour: '#3DA8D8',
  deepColour: null,
  iceColour: null,
  inkColour: null,
  tenantLogoUrl: null,
  tenantLogoOnDarkUrl: null,
  showCover: true,
  showContents: true,
  showSummary: true,
  showSignoff: true,
  complexity: 'standard',
  headerText: null,
  footerText: null,
  signoffPreparedBy: null,
  signoffApprovedBy: null,
  signoffNotes: null,
}

/**
 * Merge tenant_settings + per-call overrides into a finalised ShellSettings.
 * Anywhere a value is missing, the EQ default applies.
 */
export function resolveShellSettings(partial: Partial<ShellSettings>): ShellSettings {
  return { ...DEFAULT_SETTINGS, ...stripNulls(partial) }
}

function stripNulls<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key in obj) {
    const v = obj[key]
    if (v !== undefined && v !== null && v !== '') {
      out[key] = v
    }
  }
  return out
}

/**
 * Eagerly fetch all logo/photo images used by the shell, in parallel.
 * Call this once before composing the document — passes the resulting
 * ResolvedShell into every build* function.
 *
 * Network failures are swallowed (returns undefined for that asset);
 * callers must handle the missing-asset case visually.
 */
export async function prepareShell(
  settings: ShellSettings,
  ctx: ShellContext,
): Promise<ResolvedShell> {
  // Always-fetch model — the showCustomerLogo / showSitePhoto toggles were
  // removed 26-Apr-2026 (audit items 6 + 8). fetchLogoImage tolerates null
  // URLs by returning undefined, so omitting an asset just means passing
  // null through ctx.
  const [customerLogo, tenantLogo, tenantLogoOnDark, sitePhoto] = await Promise.all([
    fetchLogoImage(ctx.customerLogoUrl, CUSTOMER_LOGO_LIGHT),
    fetchLogoImage(settings.tenantLogoUrl, TENANT_LOGO_LIGHT),
    fetchLogoImage(settings.tenantLogoOnDarkUrl, TENANT_LOGO_ON_DARK),
    fetchLogoImage(ctx.sitePhotoUrl, SITE_PHOTO_COVER),
  ])

  return { settings, ctx, customerLogo, tenantLogo, tenantLogoOnDark, sitePhoto }
}

// ─────────── Cover ───────────

/**
 * Build the standard cover page.
 *
 * Layout:
 *   Top band (dark, brand colour)
 *     - tenant logo (on-dark variant)
 *     - report type label
 *   Body
 *     - customer logo (large, centred) — if configured
 *     - report title
 *     - customer + site + date
 *     - site photo (if configured)
 *
 * Returns an array of Paragraphs ready to spread into the document body
 * (followed by a PageBreak before the contents/overview pages).
 */
export function buildCover(shell: ResolvedShell): Paragraph[] {
  const { settings, ctx, customerLogo, tenantLogoOnDark, sitePhoto } = shell
  const out: Paragraph[] = []

  // Brand band (we render this as a dark-shaded paragraph with the on-dark
  // tenant logo + report type label inline). Subtle but signals identity.
  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      shading: {
        type: ShadingType.SOLID,
        color: hexToDocxShade(settings.primaryColour),
        fill: hexToDocxShade(settings.primaryColour),
      },
      spacing: { before: 0, after: 600 },
      children: [
        ...(tenantLogoOnDark
          ? [
              new ImageRun({
                data: tenantLogoOnDark.data,
                transformation: {
                  width: tenantLogoOnDark.width,
                  height: tenantLogoOnDark.height,
                },
                type: tenantLogoOnDark.type,
              }),
              new TextRun({ text: '  ', size: 20 }),
            ]
          : [
              // No logo configured — render a visible placeholder so the
              // tenant admin notices and uploads one. Per Brief v1.3 §6.4
              // we deliberately do NOT fall back to the EQ logo because
              // that would mask tenant misconfiguration. (Audit Q1.)
              new TextRun({
                text: '⚠ Logo not configured — set in /admin/reports    ',
                italics: true,
                color: 'FFFFFF',
                size: 18,
                font: FONT_BODY,
              }),
            ]),
        new TextRun({
          text: REPORT_TYPE_LABELS[ctx.reportType],
          bold: true,
          color: 'FFFFFF',
          size: 36,
          font: FONT_BODY,
        }),
      ],
    }),
  )

  // Customer logo (centred, large)
  if (customerLogo) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 800, after: 400 },
        children: [
          new ImageRun({
            data: customerLogo.data,
            transformation: { width: customerLogo.width, height: customerLogo.height },
            type: customerLogo.type,
          }),
        ],
      }),
    )
  }

  // Customer name (huge)
  if (ctx.customerName) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 200 },
        children: [
          new TextRun({
            text: ctx.customerName,
            bold: true,
            size: 56,
            font: FONT_BODY,
            color: '1A1A2E',
          }),
        ],
      }),
    )
  }

  // Site
  if (ctx.siteName) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [
          new TextRun({
            text: ctx.siteName,
            size: 28,
            font: FONT_BODY,
            color: hexToDocxShade(settings.primaryColour),
          }),
        ],
      }),
    )
  }

  // Address
  if (ctx.siteAddress) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: ctx.siteAddress,
            size: 18,
            font: FONT_BODY,
            color: EQ_MID_GREY,
          }),
        ],
      }),
    )
  }

  // Date
  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [
        new TextRun({
          text: ctx.reportDate,
          size: 22,
          font: FONT_BODY,
          color: '1A1A2E',
        }),
      ],
    }),
  )

  // Site photo (hero image)
  if (sitePhoto) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 200 },
        children: [
          new ImageRun({
            data: sitePhoto.data,
            transformation: { width: sitePhoto.width, height: sitePhoto.height },
            type: sitePhoto.type,
          }),
        ],
      }),
    )
  }

  return out
}

// ─────────── Header / Footer ───────────

/**
 * Standard page header. Renders the report type + custom header text
 * (if Report Settings has one) on every body page.
 */
export function buildHeader(shell: ResolvedShell): Header {
  const { settings, ctx } = shell

  const brandHex = hexToDocxShade(settings.primaryColour)
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 100 },
        border: {
          bottom: { color: brandHex, style: BorderStyle.SINGLE, size: 6 },
        },
        children: [
          new TextRun({
            text: REPORT_TYPE_LABELS[ctx.reportType],
            bold: true,
            size: 18,
            font: FONT_BODY,
            color: brandHex,
          }),
          new TextRun({ text: '\t' }),
          new TextRun({
            text: settings.headerText ?? `${ctx.customerName ?? settings.companyName} — ${ctx.reportDate}`,
            size: 16,
            font: FONT_BODY,
            color: EQ_MID_GREY,
          }),
        ],
      }),
    ],
  })
}

/**
 * Standard page footer. Company name + report type + custom footer text on
 * the left, "Page X of Y" on the right.
 */
export function buildFooter(shell: ResolvedShell): Footer {
  const { settings, ctx } = shell
  const left = settings.footerText
    ?? `${settings.companyName} — ${REPORT_TYPE_LABELS[ctx.reportType]}`

  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        children: [
          new TextRun({
            text: left,
            size: 14,
            font: FONT_BODY,
            color: EQ_MID_GREY,
          }),
          new TextRun({ text: '\t' }),
          new TextRun({
            text: 'Page ',
            size: 14,
            font: FONT_BODY,
            color: EQ_MID_GREY,
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            size: 14,
            font: FONT_BODY,
            color: EQ_MID_GREY,
          }),
          new TextRun({
            text: ' of ',
            size: 14,
            font: FONT_BODY,
            color: EQ_MID_GREY,
          }),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            size: 14,
            font: FONT_BODY,
            color: EQ_MID_GREY,
          }),
        ],
      }),
    ],
  })
}

// ─────────── Sign-off ───────────

/**
 * Sign-off block — the standard "Prepared by / Approved by / Date / Signature"
 * grid that closes every customer-facing report. Honours the showSignoff
 * setting and per-tenant prefilled names.
 */
export function buildSignoff(shell: ResolvedShell): Paragraph[] {
  const { settings, ctx } = shell
  if (!settings.showSignoff) return []

  const out: Paragraph[] = []

  out.push(
    new Paragraph({
      spacing: { before: 800, after: 200 },
      children: [
        new TextRun({
          text: 'Sign-off',
          bold: true,
          size: 24,
          font: FONT_BODY,
          color: '1A1A2E',
        }),
      ],
    }),
  )

  const rows: { label: string; value: string }[] = [
    { label: 'Prepared by', value: settings.signoffPreparedBy ?? '_____________________________' },
    { label: 'Date prepared', value: ctx.reportDate },
    { label: 'Approved by', value: settings.signoffApprovedBy ?? '_____________________________' },
    { label: 'Signature', value: '_____________________________' },
  ]

  for (const row of rows) {
    out.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: `${row.label}: `,
            bold: true,
            size: 18,
            font: FONT_BODY,
            color: '1A1A2E',
          }),
          new TextRun({
            text: row.value,
            size: 18,
            font: FONT_BODY,
            color: EQ_MID_GREY,
          }),
        ],
      }),
    )
  }

  if (settings.signoffNotes) {
    out.push(
      new Paragraph({
        spacing: { before: 240, after: 100 },
        children: [
          new TextRun({
            text: settings.signoffNotes,
            italics: true,
            size: 16,
            font: FONT_BODY,
            color: EQ_MID_GREY,
          }),
        ],
      }),
    )
  }

  return out
}

// ─────────── Helpers ───────────

/** Strip leading # from hex if present, return uppercase 6-char string. */
function hexToDocxShade(hex: string): string {
  const cleaned = hex.replace(/^#/, '').toUpperCase()
  if (cleaned.length === 6) return cleaned
  if (cleaned.length === 3) {
    return cleaned
      .split('')
      .map((c) => c + c)
      .join('')
  }
  return '3DA8D8' // EQ sky as last-resort default
}

/** Get the human-readable label for a report type. Useful when a body author wants the same string the shell uses. */
export function reportTypeLabel(type: ReportType): string {
  return REPORT_TYPE_LABELS[type]
}
