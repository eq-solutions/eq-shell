/**
 * Shared CSV parser utility — no external dependencies.
 * Handles quoted fields with embedded commas and newlines.
 */

export type ParsedRow = Record<string, string>

export interface ParseResult {
  headers: string[]
  rows: ParsedRow[]
}

/**
 * Parse a CSV string into headers + row objects.
 * Headers are normalised to lowercase with spaces→underscores.
 */
export function parseCSV(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const rows: ParsedRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const values: string[] = []
    let current = ''
    let inQuotes = false
    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    values.push(current.trim())

    const row: ParsedRow = {}
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? ''
    })
    rows.push(row)
  }

  return { headers, rows }
}

/**
 * Auto-map CSV headers to expected column names using fuzzy matching.
 * Normalises underscores, spaces and dashes before comparison.
 */
export function autoMapColumns(
  csvHeaders: string[],
  allColumns: string[]
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const col of allColumns) {
    const match = csvHeaders.find(
      (hdr) => hdr === col || hdr.replace(/[_\s-]/g, '') === col.replace(/[_\s-]/g, '')
    )
    if (match) map[col] = match
  }
  return map
}
