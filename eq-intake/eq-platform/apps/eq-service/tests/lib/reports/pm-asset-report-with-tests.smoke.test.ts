/**
 * Smoke test: PM Asset Report with full LINKED TEST DETAIL.
 *
 * Generates a single docx that exercises:
 *   - Per-asset PPM section (existing)
 *   - "Test Records" section with summary tables for ACB / NSX / RCD (PR #31)
 *   - "RCD Circuit Timing — Per Board" deep section (PR O / #63)
 *   - "Breaker Test Detail" deep section per ACB / NSX with breaker info
 *     grid + readings table (PR Q / #67)
 *
 * Output: tmp/smoke/pm-asset-report-with-linked-tests.docx
 *
 * Run: npx vitest run tests/lib/reports/pm-asset-report-with-tests.smoke.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { generatePMAssetReport } from '@/lib/reports/pm-asset-report'
import type {
  PmAssetReportInput,
  AcbTestSummary,
  NsxTestSummary,
  RcdTestSummary,
} from '@/lib/reports/pm-asset-report'

const OUT_DIR = resolve(process.cwd(), 'tmp', 'smoke')

const acb: AcbTestSummary[] = [
  {
    assetName: 'SY3-M1-MSB-01-ACB-CB5-Gen Supply',
    cbMakeModel: 'Schneider NW16',
    testType: 'Routine',
    testDate: '2026-04-15',
    stepsDone: 3,
    stepsTotal: 3,
    overallResult: 'Pass',
    detail: {
      cbMake: 'Schneider Electric',
      cbModel: 'NW16',
      cbSerial: 'SE-NW16-2719',
      cbRating: '1600A',
      poles: '4',
      tripUnit: 'Micrologic 5.0A',
      performanceLevel: 'H1',
      fixedWithdrawable: 'Withdrawable',
      readings: [
        { label: 'Visual: General condition', value: 'OK', unit: null, isPass: true },
        { label: 'Visual: Arc chute condition', value: 'OK', unit: null, isPass: true },
        { label: 'Functional: Manual close', value: 'OK', unit: null, isPass: true },
        { label: 'Functional: Manual open', value: 'OK', unit: null, isPass: true },
        { label: 'Electrical: Contact resistance R-phase', value: '46', unit: 'µΩ', isPass: true },
        { label: 'Electrical: Contact resistance W-phase', value: '47', unit: 'µΩ', isPass: true },
        { label: 'Electrical: Contact resistance B-phase', value: '45', unit: 'µΩ', isPass: true },
        { label: 'Electrical: IR closed R-W', value: '2400', unit: 'MΩ', isPass: true },
        { label: 'Electrical: IR closed R-B', value: '2350', unit: 'MΩ', isPass: true },
        { label: 'Electrical: IR closed W-B', value: '2380', unit: 'MΩ', isPass: true },
        { label: 'Electrical: Temperature', value: '24', unit: '°C', isPass: null },
      ],
    },
  },
]

const nsx: NsxTestSummary[] = [
  {
    assetName: 'SY3-B3-DB-12-NSX-CB3-Distribution',
    cbMakeModel: 'Schneider NSX 250F',
    testType: 'Routine',
    testDate: '2026-04-15',
    stepsDone: 3,
    stepsTotal: 3,
    overallResult: 'Pass',
    detail: {
      cbMake: 'Schneider Electric',
      cbModel: 'NSX 250F',
      cbSerial: 'NSX-SY3-0312',
      cbRating: '250A',
      poles: '4',
      tripUnit: 'Micrologic 2.2',
      performanceLevel: null,
      fixedWithdrawable: 'Fixed',
      readings: [
        { label: 'Visual: General condition', value: 'OK', unit: null, isPass: true },
        { label: 'Functional: Manual trip test', value: 'OK', unit: null, isPass: true },
        { label: 'Functional: Shunt trip', value: 'No response', unit: null, isPass: false },
        { label: 'Electrical: IR closed R-W', value: '1850', unit: 'MΩ', isPass: true },
        { label: 'Electrical: IR closed R-B', value: '1820', unit: 'MΩ', isPass: true },
        { label: 'Electrical: Contact resistance R-phase', value: '142', unit: 'µΩ', isPass: true },
        { label: 'Electrical: Contact resistance W-phase', value: '138', unit: 'µΩ', isPass: true },
      ],
    },
  },
]

const rcd: RcdTestSummary[] = [
  {
    assetName: 'Cardiff DB-1',
    jemenaAssetId: 'JM003534',
    testDate: '2026-05-06',
    circuitCount: 5,
    status: 'complete',
    circuits: [
      { sectionLabel: 'Lighting Section', circuitNo: '1', normalTripCurrentMa: 30,
        jemenaCircuitAssetId: '30248',
        x1NoTrip0Ms: '', x1NoTrip180Ms: '',
        x1Trip0Ms: '24', x1Trip180Ms: '26',
        x5Fast0Ms: '12', x5Fast180Ms: '13',
        tripTestButtonOk: true, isCriticalLoad: false, actionTaken: null },
      { sectionLabel: 'Lighting Section', circuitNo: '2', normalTripCurrentMa: 30,
        jemenaCircuitAssetId: '30249',
        x1NoTrip0Ms: '', x1NoTrip180Ms: '',
        x1Trip0Ms: '28', x1Trip180Ms: '29',
        x5Fast0Ms: '14', x5Fast180Ms: '14',
        tripTestButtonOk: true, isCriticalLoad: false, actionTaken: null },
      { sectionLabel: 'Power Section', circuitNo: '1', normalTripCurrentMa: 30,
        jemenaCircuitAssetId: '30260',
        x1NoTrip0Ms: '', x1NoTrip180Ms: '',
        x1Trip0Ms: '32', x1Trip180Ms: '34',
        x5Fast0Ms: '15', x5Fast180Ms: '16',
        tripTestButtonOk: true, isCriticalLoad: false, actionTaken: null },
      { sectionLabel: 'Power Section', circuitNo: '2', normalTripCurrentMa: 30,
        jemenaCircuitAssetId: '30261',
        x1NoTrip0Ms: null, x1NoTrip180Ms: null,
        x1Trip0Ms: null, x1Trip180Ms: null,
        x5Fast0Ms: null, x5Fast180Ms: null,
        tripTestButtonOk: false, isCriticalLoad: true, actionTaken: 'UPS feeder — locked, customer present' },
      { sectionLabel: 'Power Section', circuitNo: '3', normalTripCurrentMa: 30,
        jemenaCircuitAssetId: '30262',
        x1NoTrip0Ms: '', x1NoTrip180Ms: '',
        x1Trip0Ms: '305', x1Trip180Ms: '310',
        x5Fast0Ms: '42', x5Fast180Ms: '44',
        tripTestButtonOk: true, isCriticalLoad: false,
        actionTaken: 'Trip time exceeds 300 ms — flagged for replacement' },
    ],
  },
]

const fixture: PmAssetReportInput = {
  complexity: 'standard',
  reportTitle: 'SY3 — Annual — April 2026 PM (with linked tests)',
  reportGeneratedDate: new Date().toISOString(),
  reportingPeriod: 'April 2026',

  siteName: 'SY3',
  siteCode: 'SY3',
  siteAddress: '639 Gardeners Rd, Mascot NSW 2020',
  customerName: 'Equinix Australia',
  supervisorName: 'Simon Bramall',
  contactEmail: 'operations@example.com.au',
  contactPhone: '+61 2 xxxx xxxx',

  startDate: '2026-04-01',
  dueDate: '2026-04-30',
  completedDate: '2026-04-18',
  outstandingAssets: 0,
  outstandingWorkOrders: 0,

  technicianName: 'Royce Milmlow',
  reviewerName: 'Simon Bramall',

  tenantProductName: 'SKS Technologies',
  primaryColour: '#7C77B9',  // SKS purple

  companyName: 'SKS Technologies Pty Ltd',
  companyAbn: '40 651 962 935',
  companyPhone: '+61 3 xxxx xxxx',
  companyAddress: '123 Somewhere St, Melbourne VIC 3000',

  overallNotes: 'PPM completed cleanly. NSX CB3 shunt trip flagged for follow-up. Cardiff DB-1 P3 RCD over 300 ms — replace.',

  showCoverPage: true,
  showContents: true,
  showExecutiveSummary: true,
  showSignOff: true,

  assets: [
    {
      assetName: 'SY3-MSB-01',
      assetId: 'MSB-2719',
      site: 'SY3',
      location: 'SY3-LG31',
      jobPlanName: 'E1.25 - LV ACB',
      tasks: [
        { order: 1, description: 'Visual inspection', result: 'pass' },
        { order: 2, description: 'Functional test', result: 'pass' },
        { order: 3, description: 'Electrical readings', result: 'pass' },
      ],
      technicianName: 'Royce Milmlow',
      completedDate: '2026-04-15',
    },
  ],

  linkedTests: { acb, nsx, rcd },
}

describe('PM Asset Report with linked test detail — smoke', () => {
  beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
  })

  it('renders standard complexity with full ACB/NSX/RCD detail', async () => {
    const buffer = await generatePMAssetReport(fixture)
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.byteLength).toBeGreaterThan(15000)
    const out = resolve(OUT_DIR, 'pm-asset-report-with-linked-tests.docx')
    writeFileSync(out, buffer)
    console.log(`  → ${out} (${buffer.byteLength} bytes)`)
  })
})
