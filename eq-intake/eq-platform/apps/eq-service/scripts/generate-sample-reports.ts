/**
 * generate-sample-reports.ts
 *
 * Produces "Demo Electrical" sample ACB + Compliance reports as DOCX files
 * for use on the EQ Solutions marketing site and inside the demo tenant.
 *
 * Inputs are inlined (pulled from demo tenant on 2026-04-19). Re-run after
 * material demo-data changes.
 *
 * Run:
 *   tsx scripts/generate-sample-reports.ts
 *
 * Outputs (in ./tmp/samples):
 *   EQ Solves - Sample ACB Test Report.docx
 *   EQ Solves - Sample Compliance Report.docx
 */

import { generateAcbReport, type AcbReportInput, type AcbReportTest, type AcbReportReading } from '../lib/reports/acb-report'
import { generateComplianceReport, type ComplianceReportInput } from '../lib/reports/compliance-report'
import * as fs from 'node:fs'
import * as path from 'node:path'

// -------- shared reading templates --------

const VF_QUICK: [string, string][] = [
  ['Operation Counter - Before', '1247'],
  ['Castle Key Fitted', 'Yes'],
  ['Functioning of the safety shutters (De-energised ONLY)', 'OK'],
]

type Check = { label: string; value: string; isPass: boolean | null; sortOrder: number }

const VF_CHECKLIST: Check[] = [
  { label: 'General Condition', value: 'Good', isPass: true, sortOrder: 10 },
  { label: 'Condition of connection pads (flags)', value: 'OK', isPass: true, sortOrder: 20 },
  { label: 'Main contact wear', value: 'Within tolerance', isPass: true, sortOrder: 30 },
  { label: 'Condition of the ARC chute', value: 'OK', isPass: true, sortOrder: 40 },
  { label: 'Connection pads degreasing', value: 'Complete', isPass: true, sortOrder: 50 },
  { label: 'Castel key operational', value: 'OK', isPass: true, sortOrder: 60 },
  { label: 'Functioning of the operational counter', value: 'OK', isPass: true, sortOrder: 70 },
  { label: 'Functioning of OF Status contacts', value: 'OK', isPass: true, sortOrder: 80 },
  { label: 'Functioning of the XF (Close coil) at minimum voltage', value: 'OK', isPass: true, sortOrder: 90 },
  { label: 'Complete closing of device', value: 'OK', isPass: true, sortOrder: 100 },
  { label: 'Functioning of the MX (Shunt trip) at minimum voltage', value: 'OK', isPass: true, sortOrder: 110 },
  { label: 'Functioning of the MX2 (Shunt trip) at minimum voltage', value: 'N/A', isPass: null, sortOrder: 115 },
  { label: 'Functioning of the pre-tripping system', value: 'OK', isPass: true, sortOrder: 120 },
  { label: 'Functioning of the MN Undervoltage coil at minimum voltage', value: 'OK', isPass: true, sortOrder: 130 },
  { label: 'Functioning of the MCH motor charge at minimum voltage', value: 'OK', isPass: true, sortOrder: 140 },
  { label: 'Manual charge test', value: 'OK', isPass: true, sortOrder: 150 },
  { label: 'Manual closing test', value: 'OK', isPass: true, sortOrder: 160 },
  { label: 'Manual opening test', value: 'OK', isPass: true, sortOrder: 170 },
  { label: 'Pull test on auxiliary wiring', value: 'OK', isPass: true, sortOrder: 180 },
  { label: 'Apply service sticker with date of service', value: 'Applied', isPass: true, sortOrder: 190 },
  { label: 'Connection pads greasing', value: 'Complete', isPass: true, sortOrder: 200 },
  { label: 'Connecting clusters and cluster supports greasing', value: 'Complete', isPass: true, sortOrder: 210 },
  { label: 'Position locking / racking into position', value: 'OK', isPass: true, sortOrder: 220 },
  { label: 'Observation of racking mechanism into cradle', value: 'OK', isPass: true, sortOrder: 230 },
  { label: 'Change battery of protection unit', value: 'N/A', isPass: null, sortOrder: 240 },
  { label: 'Replace battery', value: 'N/A', isPass: null, sortOrder: 250 },
  { label: 'Additional information / items to be actioned', value: 'Routine service complete', isPass: null, sortOrder: 260 },
]

type Elec = { label: string; value: string; unit: string | null; isPass: boolean | null; sortOrder: number }

function electricalReadings(variant: 'pass-a' | 'pass-b' | 'defect'): Elec[] {
  const cr = variant === 'pass-a'
    ? ['42', '44', '43', '40']
    : variant === 'pass-b'
      ? ['41', '45', '44', '42']
      : ['71', '46', '45', '41']
  return [
    { label: 'Contact Resistance Red', value: cr[0], unit: 'µΩ', isPass: variant !== 'defect', sortOrder: 300 },
    { label: 'Contact Resistance White', value: cr[1], unit: 'µΩ', isPass: true, sortOrder: 301 },
    { label: 'Contact Resistance Blue', value: cr[2], unit: 'µΩ', isPass: true, sortOrder: 302 },
    { label: 'Contact Resistance Neutral', value: cr[3], unit: 'µΩ', isPass: true, sortOrder: 303 },
    { label: 'IR Closed R-W', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 310 },
    { label: 'IR Closed R-B', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 311 },
    { label: 'IR Closed W-B', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 312 },
    { label: 'IR Closed R-E', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 313 },
    { label: 'IR Closed W-E', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 314 },
    { label: 'IR Closed B-E', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 315 },
    { label: 'IR Closed R-N', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 316 },
    { label: 'IR Closed W-N', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 317 },
    { label: 'IR Closed B-N', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 318 },
    { label: 'IR Open R-R', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 320 },
    { label: 'IR Open W-W', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 321 },
    { label: 'IR Open B-B', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 322 },
    { label: 'IR Open N-N', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 323 },
    { label: 'Secondary Injection', value: 'Test complete - within spec', unit: '', isPass: true, sortOrder: 330 },
    { label: 'Operation Counter - After', value: '1251', unit: '', isPass: true, sortOrder: 335 },
    { label: 'Protection Short time', value: '4000 A / 200 ms', unit: '', isPass: true, sortOrder: 340 },
    { label: 'Protection Instantaneous', value: '12000 A', unit: '', isPass: true, sortOrder: 341 },
    { label: 'Protection Long time', value: '2500 A / 12 s', unit: '', isPass: true, sortOrder: 342 },
  ]
}

function buildReadings(variant: 'pass-a' | 'pass-b' | 'defect'): AcbReportReading[] {
  const base: AcbReportReading[] = []
  VF_QUICK.forEach((r, i) =>
    base.push({ label: r[0], value: r[1], unit: null, isPass: null, sortOrder: 10000 + i }))
  VF_CHECKLIST.forEach((r) => {
    let value = r.value
    let isPass = r.isPass
    if (variant === 'defect' && r.label === 'Main contact wear') {
      value = 'Excessive wear on Red phase'
      isPass = false
    }
    if (variant === 'defect' && r.label === 'Additional information / items to be actioned') {
      value = 'Red phase main contact to be replaced - defect raised'
    }
    base.push({ label: r.label, value, unit: null, isPass, sortOrder: r.sortOrder })
  })
  electricalReadings(variant).forEach((r) => base.push(r))
  return base
}

// -------- ACB report --------

const acbTests: AcbReportTest[] = [
  {
    assetName: 'SYD-ACB-01',
    assetType: 'Air Circuit Breaker',
    location: 'MSB Room — Level B1',
    assetId: 'HBV-MSB-CB01',
    jobPlan: 'E1.25 — Low Voltage Air Circuit Breaker',
    testDate: '2026-03-14',
    testedBy: 'Demo Technician',
    testType: 'Preventive Maintenance',
    cbMake: 'Schneider',
    cbModel: 'Masterpact MTZ2',
    cbSerial: 'ACB-2024-001',
    overallResult: 'Pass',
    notes: 'Routine 12-month PM complete. No remedial actions required.',
    readings: buildReadings('pass-a'),
  },
  {
    assetName: 'SYD-ACB-02',
    assetType: 'Air Circuit Breaker',
    location: 'MSB Room — Level B1',
    assetId: 'HBV-MSB-CB02',
    jobPlan: 'E1.25 — Low Voltage Air Circuit Breaker',
    testDate: '2026-03-14',
    testedBy: 'Demo Technician',
    testType: 'Preventive Maintenance',
    cbMake: 'Schneider',
    cbModel: 'Masterpact MTZ2',
    cbSerial: 'ACB-2024-002',
    overallResult: 'Pass',
    notes: 'Routine 12-month PM complete. Minor dust build-up removed.',
    readings: buildReadings('pass-b'),
  },
  {
    assetName: 'SYD-ACB-03',
    assetType: 'Air Circuit Breaker',
    location: 'Generator Room — Level B1',
    assetId: 'HBV-GEN-CB01',
    jobPlan: 'E1.25 — Low Voltage Air Circuit Breaker',
    testDate: '2026-03-15',
    testedBy: 'Demo Technician',
    testType: 'Preventive Maintenance',
    cbMake: 'ABB',
    cbModel: 'Emax E2.2',
    cbSerial: 'ACB-2024-003',
    overallResult: 'Defect',
    notes: 'Red-phase main contact outside tolerance (71µΩ vs 44–46µΩ on other phases). Defect raised — CB-2026-003.',
    readings: buildReadings('defect'),
  },
]

const acbInput: AcbReportInput = {
  siteName: 'Harborview Data Centre',
  siteCode: 'PIN-SYD',
  tenantProductName: 'EQ Solves',
  primaryColour: '3DA8D8',
  complexity: 'standard',
  tests: acbTests,
  companyName: 'Demo Electrical',
  companyAbn: '12 345 678 901',
  companyPhone: '1300 000 000',
  companyAddress: '100 Innovation Drive, Sydney NSW 2000',
  showCoverPage: true,
  showContents: true,
  showExecutiveSummary: true,
  showSignOff: true,
  signOffFields: ['Technician Signature', 'Supervisor Signature'],
}

// -------- Compliance report --------

const complianceInput: ComplianceReportInput = {
  filterDescription: 'All customers — FY 2026',
  generatedDate: '19 April 2026',
  tenantProductName: 'EQ Solves',
  primaryColour: '3DA8D8',
  complexity: 'standard',
  maintenance: {
    total: 23,
    complete: 8,
    inProgress: 5,
    scheduled: 8,
    overdue: 7,
    cancelled: 0,
    complianceRate: Math.round((8 / 23) * 100),
  },
  testing: { total: 12, pass: 8, fail: 1, defect: 1, pending: 2, passRate: Math.round((8 / 12) * 100) },
  acb: { total: 16, complete: 9, inProgress: 4, notStarted: 3 },
  nsx: { total: 12, complete: 6, inProgress: 3, notStarted: 3 },
  defects: { total: 12, open: 6, inProgress: 2, resolved: 4, critical: 2, high: 4, medium: 4, low: 2 },
  complianceBySite: [
    { site: 'Derwent Valley Campus', total: 2, complete: 2, overdue: 0, rate: 100 },
    { site: 'Harborview Data Centre', total: 5, complete: 2, overdue: 2, rate: 40 },
    { site: 'Southbank Exchange',    total: 3, complete: 1, overdue: 1, rate: 33 },
    { site: 'Goldfields Power Hub',  total: 3, complete: 1, overdue: 1, rate: 33 },
    { site: 'Torrens Substation',    total: 3, complete: 1, overdue: 0, rate: 33 },
    { site: 'Coral Gateway Facility',total: 3, complete: 1, overdue: 1, rate: 33 },
    { site: 'Top End Processing Centre', total: 2, complete: 0, overdue: 1, rate: 0 },
    { site: 'Capital Grid Station',  total: 2, complete: 0, overdue: 1, rate: 0 },
  ],
  months: [
    { label: 'Nov 25', tests: 0, pass: 0, checks: 0, complete: 0 },
    { label: 'Dec 25', tests: 0, pass: 0, checks: 0, complete: 0 },
    { label: 'Jan 26', tests: 2, pass: 2, checks: 1, complete: 1 },
    { label: 'Feb 26', tests: 3, pass: 3, checks: 3, complete: 2 },
    { label: 'Mar 26', tests: 4, pass: 3, checks: 6, complete: 5 },
    { label: 'Apr 26', tests: 3, pass: 0, checks: 5, complete: 0 },
  ],
}

// -------- runner --------

async function main() {
  const outDir = path.join(process.cwd(), 'tmp', 'samples')
  fs.mkdirSync(outDir, { recursive: true })

  console.log('Generating ACB report…')
  const acbBuf = await generateAcbReport(acbInput)
  const acbPath = path.join(outDir, 'EQ Solves - Sample ACB Test Report.docx')
  fs.writeFileSync(acbPath, Buffer.from(acbBuf))
  console.log(`  → ${acbPath} (${(acbBuf.length / 1024).toFixed(1)} KB)`)

  console.log('Generating Compliance report…')
  const compBuf = await generateComplianceReport(complianceInput)
  const compPath = path.join(outDir, 'EQ Solves - Sample Compliance Report.docx')
  fs.writeFileSync(compPath, Buffer.from(compBuf))
  console.log(`  → ${compPath} (${(compBuf.length / 1024).toFixed(1)} KB)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
