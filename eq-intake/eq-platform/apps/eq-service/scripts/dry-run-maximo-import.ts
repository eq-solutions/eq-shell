/**
 * dry-run-maximo-import.ts
 *
 * Dev CLI: feed one or more Maximo work-order .xlsx files through the
 * parser without touching the database. Prints rows, groups, errors,
 * and per-row warnings — same shape the import wizard sees.
 *
 * Useful for sanity-checking a new monthly Equinix scope BEFORE the
 * commit step, or for diagnosing unexpected import-wizard errors
 * against a live file.
 *
 * Usage (PowerShell):
 *   npx tsx scripts/dry-run-maximo-import.ts ".\path\to\WO Aug 2025.xlsx"
 *   npx tsx scripts/dry-run-maximo-import.ts ".\sy6-files\*.xlsx"
 */

import { parseWorkbook } from '../lib/import/delta-wo-parser'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('usage: tsx scripts/dry-run-maximo-import.ts <file.xlsx> [file2.xlsx ...]')
    process.exit(2)
  }

  let totalRows = 0
  let totalGroups = 0
  let totalErrors = 0

  for (const f of files) {
    const buf = await readFile(f)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const result = await parseWorkbook(ab)

    totalRows += result.rows.length
    totalGroups += result.groups.length
    totalErrors += result.errors.length

    console.log(`\n=== ${basename(f)} ===`)
    console.log(
      `  rows: ${result.rows.length} | groups: ${result.groups.length} | errors: ${result.errors.length}`,
    )

    if (result.errors.length) {
      for (const e of result.errors.slice(0, 10)) {
        console.log(`    [R${e.rowNumber}] ${e.message}`)
      }
      if (result.errors.length > 10) {
        console.log(`    ... and ${result.errors.length - 10} more`)
      }
    }

    for (const g of result.groups) {
      const date = g.startDate.toISOString().slice(0, 10)
      console.log(
        `    Group ${g.siteCode} ${g.jobPlanCode}-${g.frequencySuffix}=${g.frequency} ${date} (${g.rows.length} assets)`,
      )
    }

    const warnedRows = result.rows.filter((r) => r.warnings.length > 0)
    if (warnedRows.length > 0) {
      console.log(`  ${warnedRows.length} row(s) with warnings:`)
      for (const r of warnedRows.slice(0, 5)) {
        console.log(`    [R${r.rowNumber}] WO ${r.workOrder}: ${r.warnings.join('; ')}`)
      }
      if (warnedRows.length > 5) {
        console.log(`    ... and ${warnedRows.length - 5} more`)
      }
    }
  }

  console.log(`\n--- TOTAL ---`)
  console.log(`  ${totalRows} rows | ${totalGroups} groups | ${totalErrors} errors`)
  process.exit(totalErrors > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
