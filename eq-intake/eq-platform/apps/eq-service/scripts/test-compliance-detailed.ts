/**
 * Standalone repro for Item 3 — Compliance Report Detailed download failure.
 *
 * Runs generateComplianceReport directly with mock input for each complexity
 * level and prints which one throws. Bypasses the Next.js route + Supabase
 * so we isolate the docx generation path.
 *
 * Run: npx tsx scripts/test-compliance-detailed.ts
 */

import { generateComplianceReport } from '../lib/reports/compliance-report'
import type { ComplianceReportInput } from '../lib/reports/compliance-report'

function baseInput(complexity: 'summary' | 'standard' | 'detailed'): ComplianceReportInput {
  return {
    filterDescription: 'All data',
    generatedDate: '20 April 2026',
    tenantProductName: 'EQ Solves',
    primaryColour: '3DA8D8',
    complexity,
    maintenance: {
      total: 20, complete: 15, inProgress: 3, scheduled: 1, overdue: 1, cancelled: 0, complianceRate: 75,
    },
    testing: {
      total: 50, pass: 42, fail: 3, defect: 2, pending: 3, passRate: 84,
    },
    acb: { total: 10, complete: 7, inProgress: 2, notStarted: 1 },
    nsx: { total: 5, complete: 3, inProgress: 1, notStarted: 1 },
    defects: {
      total: 8, open: 2, inProgress: 1, resolved: 5,
      critical: 0, high: 2, medium: 4, low: 2,
    },
    complianceBySite: [
      { site: 'SY1', total: 5, complete: 4, overdue: 0, rate: 80 },
      { site: 'SY2', total: 3, complete: 2, overdue: 1, rate: 66 },
    ],
    months: [
      { label: 'Nov 25', tests: 5, pass: 4, checks: 3, complete: 3 },
      { label: 'Dec 25', tests: 6, pass: 6, checks: 4, complete: 3 },
      { label: 'Jan 26', tests: 4, pass: 3, checks: 2, complete: 2 },
      { label: 'Feb 26', tests: 8, pass: 7, checks: 4, complete: 4 },
      { label: 'Mar 26', tests: 12, pass: 10, checks: 5, complete: 4 },
      { label: 'Apr 26', tests: 15, pass: 12, checks: 2, complete: 1 },
    ],
  }
}

async function tryOne(complexity: 'summary' | 'standard' | 'detailed') {
  console.log(`\n── ${complexity} ──`)
  try {
    const buf = await generateComplianceReport(baseInput(complexity))
    console.log(`  OK — ${buf.length} bytes`)
  } catch (err) {
    console.log(`  FAIL`)
    console.log(err instanceof Error ? err.stack : err)
  }
}

async function tryEdgeCases() {
  console.log(`\n── detailed, empty months ──`)
  const input = baseInput('detailed')
  input.months = []
  try {
    const buf = await generateComplianceReport(input)
    console.log(`  OK — ${buf.length} bytes`)
  } catch (err) { console.log('  FAIL'); console.log(err instanceof Error ? err.stack : err) }

  console.log(`\n── detailed, all-zero months ──`)
  const input2 = baseInput('detailed')
  input2.months = input2.months.map(m => ({ ...m, tests: 0, pass: 0, checks: 0, complete: 0 }))
  try {
    const buf = await generateComplianceReport(input2)
    console.log(`  OK — ${buf.length} bytes`)
  } catch (err) { console.log('  FAIL'); console.log(err instanceof Error ? err.stack : err) }

  console.log(`\n── detailed, empty everything ──`)
  const input3 = baseInput('detailed')
  input3.maintenance = { total: 0, complete: 0, inProgress: 0, scheduled: 0, overdue: 0, cancelled: 0, complianceRate: 0 }
  input3.testing = { total: 0, pass: 0, fail: 0, defect: 0, pending: 0, passRate: 0 }
  input3.acb = { total: 0, complete: 0, inProgress: 0, notStarted: 0 }
  input3.nsx = { total: 0, complete: 0, inProgress: 0, notStarted: 0 }
  input3.defects = { total: 0, open: 0, inProgress: 0, resolved: 0, critical: 0, high: 0, medium: 0, low: 0 }
  input3.complianceBySite = []
  try {
    const buf = await generateComplianceReport(input3)
    console.log(`  OK — ${buf.length} bytes`)
  } catch (err) { console.log('  FAIL'); console.log(err instanceof Error ? err.stack : err) }

  console.log(`\n── detailed, site with funky chars ──`)
  const input4 = baseInput('detailed')
  input4.complianceBySite = [{ site: 'SY1 — East & West (Zone 1)', total: 5, complete: 4, overdue: 0, rate: 80 }]
  try {
    const buf = await generateComplianceReport(input4)
    console.log(`  OK — ${buf.length} bytes`)
  } catch (err) { console.log('  FAIL'); console.log(err instanceof Error ? err.stack : err) }

  console.log(`\n── detailed, massive site list (100 rows) ──`)
  const input5 = baseInput('detailed')
  input5.complianceBySite = Array.from({ length: 100 }, (_, i) => ({ site: `Site ${i}`, total: 5, complete: 4, overdue: 0, rate: 80 }))
  try {
    const buf = await generateComplianceReport(input5)
    console.log(`  OK — ${buf.length} bytes`)
  } catch (err) { console.log('  FAIL'); console.log(err instanceof Error ? err.stack : err) }
}

async function main() {
  await tryOne('summary')
  await tryOne('standard')
  await tryOne('detailed')
  await tryEdgeCases()
}

main().catch((e) => {
  console.error('Harness error:', e)
  process.exit(1)
})
