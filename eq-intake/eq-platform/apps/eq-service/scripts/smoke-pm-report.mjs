/**
 * Smoke test runner — delegates to the vitest spec.
 *
 * The actual test that produces the three DOCX files lives at:
 *   tests/lib/reports/pm-asset-report.smoke.test.ts
 *
 * Run it with:
 *   npx vitest run tests/lib/reports/pm-asset-report.smoke.test.ts
 *
 * Output:
 *   tmp/smoke/pm-asset-report-summary.docx
 *   tmp/smoke/pm-asset-report-standard.docx
 *   tmp/smoke/pm-asset-report-detailed.docx
 *
 * Open each file and verify:
 *   Summary  — collapsed one-line counts per asset, no checklist table
 *   Standard — 4-col table (Order / Description / Completed / Notes),
 *              defects row shows "None identified." when empty
 *   Detailed — wider Notes column, Technician Notes block after defects
 */

console.log('This is a pointer file — the real smoke test is a vitest spec.')
console.log('Run: npx vitest run tests/lib/reports/pm-asset-report.smoke.test.ts')
