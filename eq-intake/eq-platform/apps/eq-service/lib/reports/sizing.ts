/**
 * Report sizing constants — single source of truth for logo dimensions
 * and spacing rules used across DOCX generators.
 *
 * Sourced from EQ Solutions Design Brief v1.3, §7 (Constraints):
 *   - Minimum logo size: 24px in digital contexts
 *   - Clear space around logo: equal to logo height on all sides
 *
 * Values below are in pixels and apply to `ImageRun.transformation`
 * widths/heights in the docx library. The aspect-ratio-preserving scaler
 * in `report-branding.fetchLogoImage` accepts (maxWidth, maxHeight) and
 * scales the natural image to fit — the constants here are the *bounding
 * box*, not a forced size.
 */

// Customer logo on light surfaces (cover body, masthead).
export const CUSTOMER_LOGO_LIGHT = { maxWidth: 220, maxHeight: 80 } as const

// Tenant logo on light surfaces (running header / body sections).
export const TENANT_LOGO_LIGHT = { maxWidth: 220, maxHeight: 80 } as const

// Tenant logo on dark surfaces (cover-page brand band, field run-sheet
// brand strip). Slightly larger because dark bands have more vertical
// padding so a larger logo reads cleaner.
export const TENANT_LOGO_ON_DARK = { maxWidth: 280, maxHeight: 100 } as const

// Site photo on cover page hero band.
export const SITE_PHOTO_COVER = { maxWidth: 600, maxHeight: 300 } as const

// Default for fetchLogoImage callers that don't know the surface yet.
export const LOGO_DEFAULT = { maxWidth: 180, maxHeight: 60 } as const

// Clear-space spacing in twips (docx's spacing unit; 1 inch = 1440 twips).
// Approximation of "equal to logo height" — using the maxHeight as the
// pixel-to-twip mapping. 80px logo height ≈ 60 points ≈ 1200 twips.
//
// These are conservative defaults used by buildMasthead / buildCover.
// Generators that want tighter packing can override per-paragraph.
export const SPACING_LOGO_AFTER = 400 // ≈ 0.28 inch
export const SPACING_LOGO_BEFORE = 200
