/**
 * Logo Variants — shared helper for report generators
 *
 * Reports can render onto light (white) or dark (ink) surfaces.
 * A white-on-transparent logo looks crisp on a dark cover page but disappears
 * on a white header. Storing two variants per entity and picking the right
 * one at render time makes reports look professional on every surface.
 *
 * Surface priority (all generators):
 *   Cover page (dark surface) → logo_url_on_dark  ?? logo_url
 *   Running header/footer     → logo_url          ?? logo_url_on_dark
 *
 * Each entity can supply either variant, both, or neither. The fallback
 * chain guarantees *something* renders as long as one URL exists anywhere.
 *
 * Migration 0047 introduced the *_on_dark columns on tenants, customers,
 * sites, and tenant_settings. Existing logo_url values remain valid as the
 * light-surface variant.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type LogoSurface = 'light' | 'dark'

export interface LogoImage {
  data: Buffer
  type: 'png' | 'jpg'
  width: number
  height: number
}

export interface LogoVariants {
  onLight?: LogoImage
  onDark?: LogoImage
}

/**
 * Pick the correct logo image for a given surface, falling back to the other
 * variant if the preferred one isn't available.
 */
export function pickLogo(
  variants: LogoVariants,
  surface: LogoSurface,
): LogoImage | undefined {
  if (surface === 'dark') {
    return variants.onDark ?? variants.onLight
  }
  return variants.onLight ?? variants.onDark
}

/**
 * Read natural width/height from a PNG or JPEG buffer.
 *
 * Returns null if the buffer isn't a recognised format or is truncated.
 * Deliberately small — avoids pulling in `image-size` / `sharp` just to keep
 * logos proportional in the DOCX renderer.
 */
function readImageSize(buf: Buffer): { width: number; height: number } | null {
  // PNG: 8-byte signature, then IHDR — width at offset 16, height at 20 (BE uint32).
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 &&
    buf[2] === 0x4e && buf[3] === 0x47
  ) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    }
  }

  // JPEG: scan segments for a Start-Of-Frame marker (SOF0–SOF3, SOF5–SOF7,
  // SOF9–SOF11, SOF13–SOF15). SOF payload is length(2) precision(1) height(2) width(2).
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
          height: buf.readUInt16BE(offset + 5),
          width:  buf.readUInt16BE(offset + 7),
        }
      }
      offset += 2 + segLen
    }
  }

  return null
}

/**
 * Resolve a logo URL → buffer. Returns undefined on any failure (404,
 * network, bad content-type). Never throws.
 *
 * The `width`/`height` opts describe the MAX box — the image is scaled to
 * fit inside it while preserving its natural aspect ratio, so a 5:1 wordmark
 * doesn't get squashed into a 3:1 slot. Falls back to the box size only if
 * the natural dimensions can't be read.
 */
export async function fetchLogoImage(
  url: string | null | undefined,
  opts: { width?: number; height?: number } = {},
): Promise<LogoImage | undefined> {
  if (!url) return undefined
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    const buf = Buffer.from(await res.arrayBuffer())
    const ct = res.headers.get('content-type') ?? ''
    const type: LogoImage['type'] = ct.includes('png') ? 'png' : 'jpg'

    const maxW = opts.width ?? 180
    const maxH = opts.height ?? 60

    // Scale to fit inside the box while preserving aspect ratio.
    const natural = readImageSize(buf)
    let width = maxW
    let height = maxH
    if (natural && natural.width > 0 && natural.height > 0) {
      const scale = Math.min(maxW / natural.width, maxH / natural.height)
      width = Math.max(1, Math.round(natural.width * scale))
      height = Math.max(1, Math.round(natural.height * scale))
    }

    return { data: buf, type, width, height }
  } catch {
    return undefined
  }
}

/**
 * Given tenant_settings, resolve the two report logo variants.
 *
 * Tenant-level logos live on `tenant_settings.logo_url` and
 * `tenant_settings.logo_url_on_dark`. The `tenants` table itself has no logo
 * columns, so the resolver takes tenant_settings only.
 *
 * Fallback chain (per surface):
 *   light: tenantSettings.report_logo_url
 *       → tenantSettings.logo_url
 *   dark : tenantSettings.report_logo_url_on_dark
 *       → tenantSettings.logo_url_on_dark
 *       → tenantSettings.report_logo_url      (light-mark fallback)
 *       → tenantSettings.logo_url             (light-mark fallback)
 *
 * The optional `_tenant` parameter is retained for call-site compatibility but
 * is unused — legacy callers that pass a tenant row won't break, and we don't
 * pretend to read logos from a column that doesn't exist.
 */
export async function resolveReportLogos(
  tenantSettings: {
    logo_url?: string | null
    logo_url_on_dark?: string | null
    report_logo_url?: string | null
    report_logo_url_on_dark?: string | null
  } | null,
  _tenant: unknown = null,
  opts: { width?: number; height?: number } = {},
): Promise<LogoVariants> {
  const lightUrl =
    tenantSettings?.report_logo_url ??
    tenantSettings?.logo_url ??
    null

  const darkUrl =
    tenantSettings?.report_logo_url_on_dark ??
    tenantSettings?.logo_url_on_dark ??
    tenantSettings?.report_logo_url ??
    tenantSettings?.logo_url ??
    null

  const [onLight, onDark] = await Promise.all([
    fetchLogoImage(lightUrl, opts),
    fetchLogoImage(darkUrl, opts),
  ])

  return { onLight, onDark }
}

/**
 * Customer-level logo variants. Used on cover pages when
 * `report_show_customer_logo` is true.
 */
export async function resolveCustomerLogos(
  customer: {
    logo_url?: string | null
    logo_url_on_dark?: string | null
  } | null,
  opts: { width?: number; height?: number } = {},
): Promise<LogoVariants> {
  const [onLight, onDark] = await Promise.all([
    fetchLogoImage(customer?.logo_url, opts),
    fetchLogoImage(customer?.logo_url_on_dark, opts),
  ])
  return { onLight, onDark }
}

/**
 * Site-level logo variants. Falls back to customer when site has none.
 */
export async function resolveSiteLogos(
  site: {
    logo_url?: string | null
    logo_url_on_dark?: string | null
  } | null,
  customer: {
    logo_url?: string | null
    logo_url_on_dark?: string | null
  } | null,
  opts: { width?: number; height?: number } = {},
): Promise<LogoVariants> {
  const lightUrl = site?.logo_url ?? customer?.logo_url ?? null
  const darkUrl  = site?.logo_url_on_dark ?? customer?.logo_url_on_dark ?? null

  const [onLight, onDark] = await Promise.all([
    fetchLogoImage(lightUrl, opts),
    fetchLogoImage(darkUrl, opts),
  ])
  return { onLight, onDark }
}

/**
 * Lightweight fetch of site_photo from media_library for cover page embed.
 * Returns the first active photo for the given site.
 */
export async function fetchSitePhoto(
  supabase: SupabaseClient,
  siteId: string,
  tenantId: string,
  opts: { width?: number; height?: number } = {},
): Promise<LogoImage | undefined> {
  try {
    const { data } = await supabase
      .from('media_library')
      .select('file_url')
      .eq('tenant_id', tenantId)
      .eq('entity_type', 'site')
      .eq('entity_id', siteId)
      .eq('category', 'site_photo')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!data?.file_url) return undefined
    return await fetchLogoImage(data.file_url, {
      width: opts.width ?? 480,
      height: opts.height ?? 270,
    })
  } catch {
    return undefined
  }
}
