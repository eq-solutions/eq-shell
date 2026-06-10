/**
 * Report Branding Utilities — Shared across all generators
 *
 * Handles:
 * - Logo fetching from URLs (with graceful fallback)
 * - Masthead construction (customer + tenant logos with caption)
 * - Company name resolution (report_company_name → tenants.name)
 */

import {
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  WidthType,
  BorderStyle,
  VerticalAlign,
  ImageRun,
} from 'docx'
import { FONT_BODY } from './typography'
import { EQ_MID_GREY } from './colours'

export interface LogoImage {
  data: Buffer
  type: 'png' | 'jpg'
  width: number
  height: number
}

/**
 * Fetch a logo URL and return as a Buffer. Returns undefined on any failure.
 * Never throws.
 *
 * Scales image to fit within maxWidth × maxHeight while preserving aspect ratio.
 */
export async function fetchLogoImage(
  url: string | null | undefined,
  opts: { maxWidth?: number; maxHeight?: number } = {},
): Promise<LogoImage | undefined> {
  if (!url) return undefined

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return undefined

    const buf = Buffer.from(await res.arrayBuffer())
    const ct = res.headers.get('content-type') ?? ''
    const type: LogoImage['type'] = ct.includes('png') ? 'png' : 'jpg'

    const maxW = opts.maxWidth ?? 180
    const maxH = opts.maxHeight ?? 60

    // Read natural dimensions from PNG/JPEG headers
    const natural = readImageDimensions(buf)
    let width = maxW
    let height = maxH

    if (natural && natural.w > 0 && natural.h > 0) {
      const scale = Math.min(maxW / natural.w, maxH / natural.h)
      width = Math.max(1, Math.round(natural.w * scale))
      height = Math.max(1, Math.round(natural.h * scale))
    }

    return { data: buf, type, width, height }
  } catch {
    return undefined
  }
}

/**
 * Extract width/height from PNG or JPEG buffer headers.
 * Returns null if format not recognised or buffer too short.
 */
function readImageDimensions(buf: Buffer): { w: number; h: number } | null {
  // PNG: 8-byte signature, then IHDR — width at offset 16, height at 20 (BE uint32)
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 &&
    buf[2] === 0x4e && buf[3] === 0x47
  ) {
    return {
      w: buf.readUInt32BE(16),
      h: buf.readUInt32BE(20),
    }
  }

  // JPEG: scan for SOF marker
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2
    while (offset < buf.length - 9) {
      if (buf[offset] !== 0xff) break
      const marker = buf[offset + 1]
      const segLen = buf.readUInt16BE(offset + 2)
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      if (isSof) {
        return {
          h: buf.readUInt16BE(offset + 5),
          w: buf.readUInt16BE(offset + 7),
        }
      }
      offset += 2 + segLen
    }
  }

  return null
}

/**
 * Build a masthead with customer logo (left) and tenant logo (right) + report type caption.
 *
 * Returns a paragraph suitable for insertion near the top of a cover page.
 * Both logos are optional; missing logos are skipped gracefully.
 */
export function buildMasthead(opts: {
  customerLogo?: LogoImage
  tenantLogo?: LogoImage
  reportTypeLabel?: string
}): Paragraph {
  const { customerLogo, tenantLogo, reportTypeLabel } = opts

  const children: (TextRun | ImageRun)[] = []

  // Left: customer logo
  if (customerLogo) {
    children.push(
      new ImageRun({
        data: customerLogo.data,
        transformation: {
          width: customerLogo.width,
          height: customerLogo.height,
        },
        type: customerLogo.type,
      }),
    )
  }

  // Middle spacer (tab)
  children.push(new TextRun('\t'))

  // Center: report type (if provided)
  if (reportTypeLabel) {
    children.push(
      new TextRun({
        text: reportTypeLabel,
        bold: true,
        size: 20,
        font: FONT_BODY,
        color: '333333',
      }),
    )
  }

  // Right spacer (tab) + tenant logo
  children.push(new TextRun('\t'))

  if (tenantLogo) {
    children.push(
      new ImageRun({
        data: tenantLogo.data,
        transformation: {
          width: tenantLogo.width,
          height: tenantLogo.height,
        },
        type: tenantLogo.type,
      }),
    )
  }

  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 400 },
    children,
  })
}

/**
 * Build a 2-column footer with company name (left) and page numbering (right).
 * Format: `{companyName} — {reportType} — rev 3.1` | `Page X of Y`
 */
export function buildFooterParagraph(opts: {
  companyName: string
  reportType: string
}): Paragraph {
  const { companyName, reportType } = opts

  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    children: [
      new TextRun({
        text: `${companyName} — ${reportType} — rev 3.1`,
        size: 16,
        font: FONT_BODY,
        color: EQ_MID_GREY,
      }),
      new TextRun({
        text: '\t',
      }),
      new TextRun({
        text: 'Page ',
        size: 16,
        font: FONT_BODY,
        color: EQ_MID_GREY,
      }),
    ],
  })
}
