/**
 * Client-side CSV export utility.
 * Generates a CSV string and triggers a browser download.
 */

export interface CsvColumn<T> {
  key: string
  header: string
  /** Optional transform function to format the value */
  format?: (row: T) => string
}

export function exportToCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  filename: string
) {
  // Build header row
  const headers = columns.map((c) => escapeCell(c.header))

  // Build data rows
  const dataRows = rows.map((row) =>
    columns.map((col) => {
      if (col.format) {
        return escapeCell(col.format(row))
      }
      const val = (row as Record<string, unknown>)[col.key]
      if (val === null || val === undefined) return ''
      if (typeof val === 'boolean') return val ? 'Yes' : 'No'
      return escapeCell(String(val))
    })
  )

  // Combine into CSV string
  const csvContent = [headers, ...dataRows]
    .map((row) => row.join(','))
    .join('\n')

  // Trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function escapeCell(value: string): string {
  // If value contains comma, quote, or newline, wrap in quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
