/**
 * Extracts dominant colours from an image.
 * Returns 4 colours: primary, deep (darker), ice (lighter), ink (darkest).
 * Works client-side only.
 *
 * Accepts either:
 *  - A File/Blob (from file input — no CORS issues)
 *  - A URL string (will attempt crossOrigin load, then proxy fallback)
 */
export async function extractColoursFromImage(
  source: string | File
): Promise<{
  primary: string
  deep: string
  ice: string
  ink: string
} | null> {
  try {
    const imageBitmap = await loadImage(source)
    if (!imageBitmap) return null
    return analysePixels(imageBitmap)
  } catch {
    return null
  }
}

async function loadImage(source: string | File | Blob): Promise<HTMLImageElement | null> {
  // If it's a File/Blob, create a local object URL (no CORS)
  if (typeof source !== 'string') {
    const objectUrl = URL.createObjectURL(source)
    try {
      return await loadImgElement(objectUrl, false)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  // It's a URL string — try with crossOrigin first
  const img = await loadImgElement(source, true)
  if (img) return img

  // CORS blocked — fetch through a proxy blob
  try {
    const resp = await fetch(source)
    const blob = await resp.blob()
    const objectUrl = URL.createObjectURL(blob)
    try {
      return await loadImgElement(objectUrl, false)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch {
    return null
  }
}

function loadImgElement(src: string, useCors: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    if (useCors) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function analysePixels(
  img: HTMLImageElement
): {
  primary: string
  deep: string
  ice: string
  ink: string
} | null {
  const canvas = document.createElement('canvas')
  const size = 100
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(img, 0, 0, size, size)

  let imageData: ImageData
  try {
    imageData = ctx.getImageData(0, 0, size, size)
  } catch {
    // SecurityError from tainted canvas — CORS issue
    return null
  }

  const pixels = imageData.data
  const colourCounts: Record<string, { r: number; g: number; b: number; count: number }> = {}

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    const a = pixels[i + 3]

    // Skip transparent or near-white background pixels
    if (a < 128) continue
    if (r > 240 && g > 240 && b > 240) continue

    // Quantise to reduce noise (bucket by 16)
    const qr = Math.round(r / 16) * 16
    const qg = Math.round(g / 16) * 16
    const qb = Math.round(b / 16) * 16
    const key = `${qr},${qg},${qb}`

    if (!colourCounts[key]) {
      colourCounts[key] = { r: qr, g: qg, b: qb, count: 0 }
    }
    colourCounts[key].count++
  }

  const sorted = Object.values(colourCounts).sort((a, b) => b.count - a.count)
  if (sorted.length === 0) return null

  const dominant = sorted[0]

  const toHex = (c: { r: number; g: number; b: number }) =>
    '#' +
    [c.r, c.g, c.b]
      .map((v) =>
        Math.min(255, Math.max(0, v))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')

  const darken = (c: { r: number; g: number; b: number }, factor: number) => ({
    r: Math.round(c.r * factor),
    g: Math.round(c.g * factor),
    b: Math.round(c.b * factor),
  })

  const lighten = (c: { r: number; g: number; b: number }, factor: number) => ({
    r: Math.round(c.r + (255 - c.r) * factor),
    g: Math.round(c.g + (255 - c.g) * factor),
    b: Math.round(c.b + (255 - c.b) * factor),
  })

  // Try to find a secondary distinct colour for "deep"
  const secondary = sorted.find((s) => {
    const diff = Math.abs(s.r - dominant.r) + Math.abs(s.g - dominant.g) + Math.abs(s.b - dominant.b)
    return diff > 48
  })

  const deepBase = secondary ?? darken(dominant, 0.75)

  return {
    primary: toHex(dominant),
    deep: toHex(secondary ? deepBase : darken(dominant, 0.75)),
    ice: toHex(lighten(dominant, 0.75)),
    ink: toHex(darken(dominant, 0.3)),
  }
}
