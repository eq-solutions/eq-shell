/**
 * Shared "Download error report" helper for client-side importers.
 *
 * The standard pattern after an import is "N succeeded, M failed". For
 * the M failures, a single CSV the tech can open in Excel + fix + re-
 * upload is the lowest-friction recovery flow. Each importer turns its
 * own per-row error shape into ImportErrorRow[] and calls
 * downloadImportErrorCsv() to ship the file.
 *
 * Used by:
 *   - /testing/acb (via its own helper in lib/utils/acb-excel.ts —
 *     predates this util, retained for backward compatibility)
 *   - /testing/rcd/import (Jemena RCD wizard)
 *   - /commercials/contract-scopes/import (DELTA ELCOM wizard)
 *   - /contract-scope CSV (via ImportCSVModal)
 *
 * The CSV is Excel-friendly: UTF-8 BOM, CRLF line endings, double-quote
 * escaping for any cell containing commas, quotes, or newlines.
 */

export interface ImportErrorRow {
  /** 1-based row / tab / sheet identifier the user can navigate to. */
  rowRef: string
  /** Friendly context — asset name, customer name, board name, etc. */
  context?: string
  /** Plain-language reason the row didn't land. */
  reason: string
}

export function buildImportErrorCsv(rows: ImportErrorRow[]): string {
  const header = 'Reference,Context,Reason'
  const lines = [header]
  for (const r of rows) {
    lines.push(
      [csvEscape(r.rowRef), csvEscape(r.context ?? ''), csvEscape(r.reason)].join(','),
    )
  }
  // CRLF + leading UTF-8 BOM so Excel renders Unicode and treats the
  // file as a proper CSV instead of a plain text file on first open.
  return '﻿' + lines.join('\r\n') + '\r\n'
}

export function downloadImportErrorCsv(
  rows: ImportErrorRow[],
  filename: string,
): void {
  const csv = buildImportErrorCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function csvEscape(value: string): string {
  if (value === '') return ''
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}
