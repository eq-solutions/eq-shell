/**
 * Shared file-size guard for client-side importers.
 *
 * Every xlsx / csv importer loads the whole file into memory via exceljs
 * or papaparse. A user dropping in a 50MB workbook silently consumes RAM,
 * occasionally OOMs the page, and sometimes wedges the server when the
 * preview action gets the whole buffer. A single 10MB ceiling per file
 * is the cheap defence — well above any real Equinix Delta / ACB / RCD /
 * commercial workbook (largest we've seen: ~2MB) and well below the
 * danger zone.
 *
 * Server-side guards still apply where they exist (route handlers may
 * reject larger bodies); this is the first line of defence.
 */

/** Max import file size in bytes. 10 MB. */
export const IMPORT_FILE_SIZE_LIMIT = 10 * 1024 * 1024

/** Pretty-print bytes for error messages and previews. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Check a File against the import size ceiling. Returns null if the file
 * is acceptable, or a plain-language error message if it isn't.
 */
export function checkImportFileSize(file: File): string | null {
  if (file.size > IMPORT_FILE_SIZE_LIMIT) {
    return `File "${file.name}" is ${formatBytes(file.size)} — over the ${formatBytes(IMPORT_FILE_SIZE_LIMIT)} import limit. Split the workbook into smaller files.`
  }
  return null
}

/**
 * Check multiple Files (multi-file importer). Returns null if all are
 * acceptable, or a combined error message naming each over-limit file.
 */
export function checkImportFileSizes(files: File[]): string | null {
  const tooBig = files.filter((f) => f.size > IMPORT_FILE_SIZE_LIMIT)
  if (tooBig.length === 0) return null
  const names = tooBig.map((f) => `"${f.name}" (${formatBytes(f.size)})`).join(', ')
  return `${tooBig.length === 1 ? 'File' : 'Files'} ${names} ${tooBig.length === 1 ? 'is' : 'are'} over the ${formatBytes(IMPORT_FILE_SIZE_LIMIT)} import limit. Split into smaller files.`
}
