/**
 * Smoke test: PM Asset Report at all three complexity levels.
 *
 * Generates a DOCX per complexity with synthetic SY1-shaped data and writes
 * each to ./tmp/smoke/ so Royce can open them to visually verify:
 *   - Summary:  collapsed one-line counts per asset, no checklist table
 *   - Standard: 4-col table (Order / Description / Completed / Notes),
 *               defects row shows "None identified." when empty
 *   - Detailed: wider Notes column, Technician Notes block after defects
 *
 * Run: npx vitest run tests/lib/reports/pm-asset-report.smoke.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { generatePMAssetReport } from '@/lib/reports/pm-asset-report'
import type { PmAssetReportInput } from '@/lib/reports/pm-asset-report'

const OUT_DIR = resolve(process.cwd(), 'tmp', 'smoke')

const fixture: Omit<PmAssetReportInput, 'complexity'> = {
  reportTitle: 'SY1 — Monthly — April PM (Smoke Test)',
  reportGeneratedDate: new Date().toISOString(),
  reportingPeriod: 'April 2026',

  siteName: 'SY1',
  siteCode: 'SY1',
  siteAddress: '639 Gardeners Rd, Mascot NSW 2020',
  customerName: 'Equinix Australia',
  supervisorName: 'Simon Bramall',
  contactEmail: 'operations@example.com.au',
  contactPhone: '+61 2 xxxx xxxx',

  startDate: '2026-04-01',
  dueDate: '2026-04-30',
  completedDate: '2026-04-18',
  outstandingAssets: 1,
  outstandingWorkOrders: 0,

  technicianName: 'Royce Milmlow',
  reviewerName: 'Simon Bramall',

  tenantProductName: 'SKS Technologies',
  primaryColour: '#3DA8D8',

  companyName: 'SKS Technologies Pty Ltd',
  companyAbn: 'ABN 12 345 678 910',
  companyPhone: '+61 3 xxxx xxxx',
  companyAddress: '123 Somewhere St, Melbourne VIC 3000',

  overallNotes: 'April PM completed. One ACB flagged for follow-up trip unit calibration.',

  showCoverPage: true,
  showContents: true,
  showExecutiveSummary: true,
  showSignOff: true,

  assets: [
    {
      assetName: 'LVACB-01',
      assetId: 'EQX-SY1-ACB-001',
      site: 'SY1',
      location: 'Main Switchroom, Level B1',
      jobPlanName: 'E1.25 — Low Voltage Air Circuit Breaker',
      // Maximo WO metadata + failure chain — exercises both new conditional
      // rendering paths added 2026-05-21 (battle-test punchlist item 1).
      workOrderNumber: '4501310',
      priority: 'high',
      workType: 'PM',
      crewId: 'NSW-A1',
      targetStart: '2026-04-15',
      targetFinish: '2026-04-18',
      classification: 'ELEC \\ LVACB',
      irScanResult: 'pass',
      failureCode: 'CONTACT-WEAR',
      problem: 'B-phase contact resistance reading 89 µΩ — outside 30% variance.',
      cause: 'Contact wear after 145 operations; pitting visible on inspection.',
      remedy: 'Strip, inspect and clean B-phase contacts. Retest before return to service.',
      technicianName: 'Royce Milmlow',
      completedDate: '2026-04-18',
      notes: 'Cleaned arc chutes. Torqued terminals to spec. Consider spare kit order — we are down to last set of contacts.',
      tasks: [
        { order: 1, description: 'Visual inspection of enclosure',  result: 'pass', notes: 'All covers intact, no signs of thermal stress.' },
        { order: 2, description: 'Check breaker in OFF position',    result: 'pass' },
        { order: 3, description: 'Contact resistance — R phase',      result: 'pass', notes: '45 µΩ — within 30% spread of other phases.' },
        { order: 4, description: 'Contact resistance — W phase',      result: 'pass', notes: '47 µΩ' },
        { order: 5, description: 'Contact resistance — B phase',      result: 'fail', notes: 'Reading 89 µΩ — outside 30% variance tolerance. Requires strip and clean before return to service. Follow-up scheduled for next PM window.' },
        { order: 6, description: 'IR test — phases to earth',         result: 'pass' },
        { order: 7, description: 'Functional trip test',              result: 'pass' },
        { order: 8, description: 'Operation counter readings',        result: 'pass', notes: 'Pre: 142  Post: 145' },
        { order: 9, description: 'Lubricate racking mechanism',       result: 'yes' },
        { order: 10, description: 'Return to service',                result: 'requires_followup', notes: 'Do not return to service until B-phase contact resistance is remediated.' },
      ],
      defectsFound: 'LVACB-01 B-phase contact resistance at 89 µΩ. Scheduled follow-up required.',
      recommendedAction: 'Strip, inspect and clean B-phase contacts. Retest before returning to service.',
    },
    {
      assetName: 'LVACB-02',
      assetId: 'EQX-SY1-ACB-002',
      site: 'SY1',
      location: 'Main Switchroom, Level B1',
      jobPlanName: 'E1.25 — Low Voltage Air Circuit Breaker',
      technicianName: 'Royce Milmlow',
      completedDate: '2026-04-18',
      notes: 'No issues. All tests passed.',
      tasks: [
        { order: 1, description: 'Visual inspection of enclosure',  result: 'pass' },
        { order: 2, description: 'Contact resistance — all phases', result: 'pass', notes: 'R 46, W 47, B 45 µΩ — tight spread.' },
        { order: 3, description: 'IR test — phases to earth',       result: 'pass' },
        { order: 4, description: 'Functional trip test',            result: 'pass' },
      ],
      // defectsFound + recommendedAction intentionally omitted — the renderer
      // should substitute "None identified." / "No follow-up action required."
    },
  ],
}

describe('PM Asset Report — complexity smoke', () => {
  beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
  })

  for (const complexity of ['summary', 'standard', 'detailed'] as const) {
    it(`renders ${complexity} complexity without throwing`, async () => {
      const buffer = await generatePMAssetReport({ ...fixture, complexity })
      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.byteLength).toBeGreaterThan(5000) // minimal DOCX is ~3-4 KB

      // Valid DOCX = zip file => starts with PK (0x50 0x4B)
      expect(buffer[0]).toBe(0x50)
      expect(buffer[1]).toBe(0x4b)

      const out = resolve(OUT_DIR, `pm-asset-report-${complexity}.docx`)
      writeFileSync(out, buffer)
      console.log(`  → ${out}  (${buffer.byteLength} bytes)`)
    })
  }
})
