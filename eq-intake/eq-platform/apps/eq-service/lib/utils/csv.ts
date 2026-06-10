// Lightweight CSV utilities — no external deps.
// Used by export/import buttons across Calendar, Customers, Sites, Assets.

export type CsvCell = string | number | boolean | null | undefined

/** Escape a single CSV cell per RFC 4180. */
export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Serialize rows (array of objects) to a CSV string using the given headers. */
export function toCsv<T extends Record<string, CsvCell>>(
  rows: T[],
  headers: { key: keyof T & string; label?: string }[],
): string {
  const headerLine = headers.map((h) => escapeCsvCell(h.label ?? h.key)).join(',')
  const lines = rows.map((row) =>
    headers.map((h) => escapeCsvCell(row[h.key])).join(','),
  )
  return [headerLine, ...lines].join('\r\n')
}

/** Trigger a browser download of a CSV string. Safe to call from client components only. */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === 'undefined') return
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Parse a CSV string into an array of row objects keyed by header.
 * Handles quoted cells, escaped quotes, and CRLF/LF line endings.
 */
export function parseCsv(input: string): Record<string, string>[] {
  const text = input.replace(/^\ufeff/, '') // strip BOM
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else {
      if (c === '"') {
        inQuotes = true
      } else if (c === ',') {
        cur.push(field)
        field = ''
      } else if (c === '\n' || c === '\r') {
        // handle CRLF
        if (c === '\r' && text[i + 1] === '\n') i++
        cur.push(field)
        rows.push(cur)
        cur = []
        field = ''
      } else {
        field += c
      }
    }
  }
  // flush last field/row
  if (field.length > 0 || cur.length > 0) {
    cur.push(field)
    rows.push(cur)
  }

  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim())
  const out: Record<string, string>[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.length === 1 && row[0] === '') continue // skip blank line
    const obj: Record<string, string> = {}
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (row[c] ?? '').trim()
    }
    out.push(obj)
  }
  return out
}
