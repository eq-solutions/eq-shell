/**
 * Report colour tokens — single source of truth.
 *
 * Sourced from EQ Solutions Design Brief v1.3 (17 April 2026), §6.1
 * (colour tokens) and §6.7 (accessibility/contrast pairings).
 *
 * Hex values are stored without the leading `#` because the docx library
 * expects bare hex (e.g. 'D5E8F0' not '#D5E8F0'). The `WITH_HASH` map
 * exports the same values with `#` for HTML/CSS contexts.
 *
 * Semantic status colours (pass/fail/warn) are NOT defined in v1.3 of
 * the brief — they're a documented extension pending v1.4. Captured here
 * so they're discoverable, used consistently, and easy to update if the
 * brief locks in different values.
 *
 * If you find yourself reaching for a hex literal in a report generator,
 * import from here instead. New generators must not introduce new colour
 * values without amending the brief or adding a token here with a clear
 * justification comment.
 */

// ─────────── EQ brand tokens (v1.3 §6.1) ───────────

/** EQ Sky Blue — Primary. Logo, headlines, CTAs, icon fills. */
export const EQ_SKY = '3DA8D8'

/** EQ Deep Blue — Accent. Hover, borders, secondary headings. */
export const EQ_DEEP = '2986B4'

/** EQ Ice Blue — Light tint. Page and card backgrounds. */
export const EQ_ICE = 'EAF5FB'

/** EQ Ink — Primary body text. */
export const EQ_INK = '1A1A2E'

/** EQ Mid Grey — Secondary text, labels, metadata. */
export const EQ_MID_GREY = '666666'

/** White — Reversed text on blue surfaces. */
export const EQ_WHITE = 'FFFFFF'

// ─────────── Semantic status colours (extension — pending brief v1.4) ───────────

/** Pass / success / complete. Greenish — readable on white. */
export const STATUS_PASS = '16A34A'

/** Fail / error / critical. Red — readable on white. */
export const STATUS_FAIL = 'DC2626'

/** Warn / defect / attention. Amber — readable on white. */
export const STATUS_WARN = 'D97706'

// ─────────── Surface colours ───────────

/**
 * Border / divider colour for tables and cards.
 * Brief doesn't specify a border token; this matches the "Linear/Notion
 * hairline" aesthetic per §6.6 (no shadows, no gradients).
 */
export const EQ_BORDER = 'E5E7EB'

// ─────────── Convenience: same tokens with leading # for HTML/CSS ───────────

export const HASH = {
  EQ_SKY: `#${EQ_SKY}`,
  EQ_DEEP: `#${EQ_DEEP}`,
  EQ_ICE: `#${EQ_ICE}`,
  EQ_INK: `#${EQ_INK}`,
  EQ_MID_GREY: `#${EQ_MID_GREY}`,
  EQ_WHITE: `#${EQ_WHITE}`,
  STATUS_PASS: `#${STATUS_PASS}`,
  STATUS_FAIL: `#${STATUS_FAIL}`,
  STATUS_WARN: `#${STATUS_WARN}`,
  EQ_BORDER: `#${EQ_BORDER}`,
} as const

// ─────────── Helpers ───────────

/**
 * Strip a leading '#' from a hex string. Safe for already-bare hex.
 * Used at module boundaries where callers may pass either format.
 */
export function bareHex(hex: string): string {
  return hex.replace(/^#/, '')
}

/**
 * Lighten a hex colour by mixing with white. `ratio` is how much white to
 * blend in (0 = original colour, 1 = pure white). Used to derive the
 * "ice" variant of any tenant brand colour for table headers and card
 * backgrounds — see S2 in the 2026-04-26 reports design audit.
 */
export function mixWithWhite(hex: string, ratio: number): string {
  const cleaned = bareHex(hex)
  const r = parseInt(cleaned.slice(0, 2), 16)
  const g = parseInt(cleaned.slice(2, 4), 16)
  const b = parseInt(cleaned.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * ratio)
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
  return `${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

/**
 * Darken a hex colour. `delta` is signed: negative darkens, positive
 * lightens. Used to derive the "deep" variant of any tenant brand colour
 * for hover states / accent borders.
 */
export function adjustHex(hex: string, delta: number): string {
  const cleaned = bareHex(hex)
  const r = parseInt(cleaned.slice(0, 2), 16)
  const g = parseInt(cleaned.slice(2, 4), 16)
  const b = parseInt(cleaned.slice(4, 6), 16)
  const adjust = (c: number) => Math.max(0, Math.min(255, Math.round(c + 255 * delta)))
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
  return `${toHex(adjust(r))}${toHex(adjust(g))}${toHex(adjust(b))}`
}

/**
 * Resolve a tenant-flavoured "ice" surface colour.
 *
 * Resolution order:
 *   1. Explicit `override` (the value the tenant set via Admin → Tenant
 *      Settings → Branding → Ice Colour, picked off the logo by the
 *      Extract Colours flow). Always wins when supplied.
 *   2. Derived from `primaryColour` by mixing 88% with white.
 *   3. EQ Ice Blue as last-resort default.
 *
 * Use for table header fills, card backgrounds, and "soft accent"
 * surfaces.
 */
export function tenantIce(primaryColour: string | null | undefined, override?: string | null): string {
  if (override) return bareHex(override)
  if (!primaryColour) return EQ_ICE
  try {
    return mixWithWhite(primaryColour, 0.88)
  } catch {
    return EQ_ICE
  }
}

/**
 * Resolve a tenant-flavoured "deep" accent colour. Same resolution
 * order as tenantIce.
 */
export function tenantDeep(primaryColour: string | null | undefined, override?: string | null): string {
  if (override) return bareHex(override)
  if (!primaryColour) return EQ_DEEP
  try {
    return adjustHex(primaryColour, -0.18)
  } catch {
    return EQ_DEEP
  }
}

/**
 * Resolve a tenant-flavoured ink (body text) colour. Almost always falls
 * back to EQ_INK because explicit per-tenant ink overrides are rare —
 * but supported for tenants whose brand has a deliberately tinted
 * dark text (e.g. Royce's SKS Ink #26223a, slightly purple-leaning).
 */
export function tenantInk(override?: string | null): string {
  if (override) return bareHex(override)
  return EQ_INK
}
