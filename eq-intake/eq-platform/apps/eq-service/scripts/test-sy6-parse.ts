/**
 * Superseded by `scripts/dry-run-maximo-import.ts` (2026-04-22).
 *
 * The dry-run script accepts arbitrary file arguments instead of the
 * hardcoded SY6 paths this stub originally used. Delete this file when
 * convenient — left as a no-op so any cached `npx tsx` invocations
 * don't error out mid-session.
 */

console.error(
  'scripts/test-sy6-parse.ts has been replaced by ' +
    'scripts/dry-run-maximo-import.ts.\n' +
    'Run: npx tsx scripts/dry-run-maximo-import.ts <file.xlsx> [...]',
)
process.exit(2)
