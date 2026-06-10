/**
 * generate-all-sample-reports.ts
 *
 * Produces a sample of every report type the platform can output, across
 * every complexity / format option. Asset naming mirrors the
 * Equinix-style Maximo monthly scope (SY6-shaped) but customer + site +
 * tech names are anonymised per IP rules.
 *
 * Inline mock data — re-run after material report-template changes.
 *
 * Run:
 *   npx tsx scripts/generate-all-sample-reports.ts
 *
 * Outputs (in ./tmp/samples/all-options):
 *   ACB Test Report - Summary.docx
 *   ACB Test Report - Standard.docx
 *   ACB Test Report - Detailed.docx
 *   NSX Test Report - Summary.docx
 *   NSX Test Report - Standard.docx
 *   NSX Test Report - Detailed.docx
 *   Compliance Report - Summary.docx
 *   Compliance Report - Standard.docx
 *   Compliance Report - Detailed.docx
 *   PM Asset Report - Summary.docx
 *   PM Asset Report - Standard.docx
 *   PM Asset Report - Detailed.docx
 *   PM Check Report.docx
 *   Maintenance Checklist - Simple.docx
 *   Maintenance Checklist - Detailed.docx
 */

import {
  generateAcbReport,
  type AcbReportInput,
  type AcbReportTest,
  type AcbReportReading,
} from '../lib/reports/acb-report'
import {
  generateNsxReport,
  type NsxReportInput,
  type NsxReportTest,
  type NsxReportReading,
} from '../lib/reports/nsx-report'
import {
  generateComplianceReport,
  type ComplianceReportInput,
} from '../lib/reports/compliance-report'
import {
  generatePMAssetReport,
  type PmAssetReportInput,
  type PmAssetSection,
} from '../lib/reports/pm-asset-report'
import {
  generatePMCheckReport,
  type PmCheckReportInput,
  type PmCheckReportItem,
} from '../lib/reports/pm-check-report'
import {
  generateMaintenanceChecklist,
  type MaintenanceChecklistInput,
  type ChecklistAsset,
} from '../lib/reports/maintenance-checklist'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ─────────── shared anonymised demo context ───────────

const TENANT_PRODUCT = 'EQ Solves'
const PRIMARY_COLOUR = '3DA8D8'

const COMPANY = {
  companyName: 'Demo Electrical',
  companyAbn: '12 345 678 901',
  companyPhone: '1300 000 000',
  companyAddress: '100 Innovation Drive, Sydney NSW 2000',
}

const CUSTOMER = {
  customerName: 'Pinnacle Datacentres Pty Ltd',
  siteName: 'Harborview Data Centre',
  siteCode: 'PIN-HBV',
  siteAddress: 'Unit 5, 200 Industrial Way, Sydney NSW 2000',
  supervisor: 'Sample Supervisor',
  contactEmail: 'site-ops@example.com',
  contactPhone: '02 5550 1234',
}

// ─────────── ACB readings (re-used from existing sample script) ───────────

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

function buildAcbReadings(variant: 'pass-a' | 'pass-b' | 'defect'): AcbReportReading[] {
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

// SY6-style asset naming pattern: <SITE>-<BLOCK>-<BOARD>-<POSITION>_<KIND>-<DESCRIPTION>
const acbTests: AcbReportTest[] = [
  {
    assetName: 'HBV-BLK2-MSB-2-1_ACB-INCOMING MAINS',
    assetType: 'Air Circuit Breaker',
    location: 'MSB Room — Block 2, Level B1',
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
    readings: buildAcbReadings('pass-a'),
  },
  {
    assetName: 'HBV-BLK2-MSB-2-2_ACB-BUS-TIE',
    assetType: 'Air Circuit Breaker',
    location: 'MSB Room — Block 2, Level B1',
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
    readings: buildAcbReadings('pass-b'),
  },
  {
    assetName: 'HBV-BLK1-GEN-1-3_ACB-GENERATOR FEED',
    assetType: 'Air Circuit Breaker',
    location: 'Generator Room — Block 1, Level B1',
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
    readings: buildAcbReadings('defect'),
  },
]

// ─────────── NSX readings ───────────

function buildNsxReadings(variant: 'pass' | 'defect'): NsxReportReading[] {
  const cr = variant === 'pass' ? ['180', '185', '182', '178'] : ['320', '188', '182', '178']
  const readings: NsxReportReading[] = [
    { label: 'General Condition', value: variant === 'pass' ? 'Good' : 'Acceptable', unit: null, isPass: true, sortOrder: 10 },
    { label: 'Casing condition', value: 'OK', unit: null, isPass: true, sortOrder: 20 },
    { label: 'Trip indicator', value: 'OK', unit: null, isPass: true, sortOrder: 30 },
    { label: 'Mechanical operation', value: 'OK', unit: null, isPass: true, sortOrder: 40 },
    { label: 'Auxiliary contacts', value: 'OK', unit: null, isPass: true, sortOrder: 50 },
    { label: 'Service sticker applied', value: 'Applied', unit: null, isPass: true, sortOrder: 60 },
    { label: 'Contact Resistance Red', value: cr[0], unit: 'µΩ', isPass: variant === 'pass', sortOrder: 300 },
    { label: 'Contact Resistance White', value: cr[1], unit: 'µΩ', isPass: true, sortOrder: 301 },
    { label: 'Contact Resistance Blue', value: cr[2], unit: 'µΩ', isPass: true, sortOrder: 302 },
    { label: 'Contact Resistance Neutral', value: cr[3], unit: 'µΩ', isPass: true, sortOrder: 303 },
    { label: 'IR Closed R-W', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 310 },
    { label: 'IR Closed R-B', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 311 },
    { label: 'IR Closed W-B', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 312 },
    { label: 'IR Closed R-E', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 313 },
    { label: 'IR Closed W-E', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 314 },
    { label: 'IR Closed B-E', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 315 },
    { label: 'IR Open R-R', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 320 },
    { label: 'IR Open W-W', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 321 },
    { label: 'IR Open B-B', value: '>1000', unit: 'MΩ', isPass: true, sortOrder: 322 },
    { label: 'Secondary Injection', value: 'Test complete - within spec', unit: '', isPass: true, sortOrder: 330 },
  ]
  return readings
}

const nsxTests: NsxReportTest[] = [
  {
    assetName: 'HBV-BLK2-DB-2-1_NSX-DB-A',
    assetType: 'Moulded Case Circuit Breaker',
    location: 'DB Room — Block 2, Level 1',
    assetId: 'HBV-DB-CB01',
    testDate: '2026-03-18',
    testedBy: 'Demo Technician',
    testType: 'Preventive Maintenance',
    cbMake: 'Schneider',
    cbModel: 'Compact NSX 250',
    cbSerial: 'NSX-2024-001',
    cbRating: '250 A',
    cbPoles: '4P',
    tripUnit: 'Micrologic 2.2',
    overallResult: 'Pass',
    notes: 'Routine PM complete.',
    readings: buildNsxReadings('pass'),
  },
  {
    assetName: 'HBV-BLK2-DB-2-2_NSX-DB-B',
    assetType: 'Moulded Case Circuit Breaker',
    location: 'DB Room — Block 2, Level 1',
    assetId: 'HBV-DB-CB02',
    testDate: '2026-03-18',
    testedBy: 'Demo Technician',
    testType: 'Preventive Maintenance',
    cbMake: 'Schneider',
    cbModel: 'Compact NSX 400',
    cbSerial: 'NSX-2024-002',
    cbRating: '400 A',
    cbPoles: '4P',
    tripUnit: 'Micrologic 2.3',
    overallResult: 'Defect',
    notes: 'Red phase contact resistance high (320µΩ). Recommend service or replace.',
    readings: buildNsxReadings('defect'),
  },
]

// ─────────── Compliance ───────────

function buildCompliance(complexity: 'summary' | 'standard' | 'detailed'): ComplianceReportInput {
  return {
    filterDescription: 'All customers — FY 2026',
    generatedDate: '22 April 2026',
    tenantProductName: TENANT_PRODUCT,
    primaryColour: PRIMARY_COLOUR,
    complexity,
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
      { site: 'Southbank Exchange',     total: 3, complete: 1, overdue: 1, rate: 33 },
      { site: 'Goldfields Power Hub',   total: 3, complete: 1, overdue: 1, rate: 33 },
      { site: 'Torrens Substation',     total: 3, complete: 1, overdue: 0, rate: 33 },
      { site: 'Coral Gateway Facility', total: 3, complete: 1, overdue: 1, rate: 33 },
      { site: 'Top End Processing Centre', total: 2, complete: 0, overdue: 1, rate: 0 },
      { site: 'Capital Grid Station',   total: 2, complete: 0, overdue: 1, rate: 0 },
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
}

// ─────────── PM Asset (mirrors a Maximo PM run on a site) ───────────

const PM_ACB_TASKS = [
  { order: 1, description: 'Verify CB is racked-out and locked off', result: 'pass' as const },
  { order: 2, description: 'Inspect main contacts for wear', result: 'pass' as const },
  { order: 3, description: 'Check ARC chute condition', result: 'pass' as const },
  { order: 4, description: 'Test mechanical close/open', result: 'pass' as const },
  { order: 5, description: 'Verify trip unit settings against schedule', result: 'pass' as const },
  { order: 6, description: 'Grease connection pads and clusters', result: 'pass' as const },
  { order: 7, description: 'Reset operation counter reading', result: 'pass' as const },
  { order: 8, description: 'Apply service sticker with date', result: 'pass' as const },
]

const pmAssetSections: PmAssetSection[] = [
  {
    assetName: 'HBV-BLK2-MSB-2-1_ACB-INCOMING MAINS',
    assetId: 'HBV-MSB-CB01',
    site: CUSTOMER.siteName,
    location: 'MSB Room — Block 2, Level B1',
    jobPlanName: 'E1.25 - Low Voltage Air Circuit Breaker',
    workOrderNumber: 'WO-2026-04-1001',
    tasks: PM_ACB_TASKS,
    technicianName: 'Demo Technician',
    completedDate: '2026-04-14',
    notes: 'PM complete. No remedial work.',
  },
  {
    assetName: 'HBV-BLK2-MSB-2-2_ACB-BUS-TIE',
    assetId: 'HBV-MSB-CB02',
    site: CUSTOMER.siteName,
    location: 'MSB Room — Block 2, Level B1',
    jobPlanName: 'E1.25 - Low Voltage Air Circuit Breaker',
    workOrderNumber: 'WO-2026-04-1002',
    tasks: PM_ACB_TASKS,
    technicianName: 'Demo Technician',
    completedDate: '2026-04-14',
    notes: 'PM complete. Dust removed from chute.',
  },
  {
    assetName: 'HBV-BLK1-GEN-1-3_ACB-GENERATOR FEED',
    assetId: 'HBV-GEN-CB01',
    site: CUSTOMER.siteName,
    location: 'Generator Room — Block 1, Level B1',
    jobPlanName: 'E1.25 - Low Voltage Air Circuit Breaker',
    workOrderNumber: 'WO-2026-04-1003',
    tasks: [
      ...PM_ACB_TASKS.slice(0, 2),
      { order: 3, description: 'Check ARC chute condition', result: 'fail' as const, notes: 'Excessive carbon deposit on Red phase ARC chute' },
      ...PM_ACB_TASKS.slice(3),
    ],
    defectsFound: 'Red phase main contact resistance 71µΩ (other phases 44–46µΩ). ARC chute carbon deposit.',
    recommendedAction: 'Replace Red phase main contact and clean ARC chute. Re-test before return to service.',
    technicianName: 'Demo Technician',
    completedDate: '2026-04-15',
    notes: 'Defect raised — CB-2026-003.',
  },
]

function buildPmAsset(complexity: 'summary' | 'standard' | 'detailed'): PmAssetReportInput {
  return {
    complexity,
    reportTitle: `${CUSTOMER.siteCode} — Annual PM — April 2026`,
    reportGeneratedDate: '2026-04-22',
    reportingPeriod: 'April 2026',
    siteName: CUSTOMER.siteName,
    siteCode: CUSTOMER.siteCode,
    siteAddress: CUSTOMER.siteAddress,
    customerName: CUSTOMER.customerName,
    supervisorName: CUSTOMER.supervisor,
    contactEmail: CUSTOMER.contactEmail,
    contactPhone: CUSTOMER.contactPhone,
    startDate: '2026-04-12',
    dueDate: '2026-04-30',
    completedDate: '2026-04-15',
    outstandingAssets: 1,
    outstandingWorkOrders: 1,
    technicianName: 'Demo Technician',
    reviewerName: 'Sample Supervisor',
    tenantProductName: TENANT_PRODUCT,
    primaryColour: PRIMARY_COLOUR,
    assets: pmAssetSections,
    overallNotes: 'One CB defect raised (CB-2026-003). All other ACBs returned to service.',
    showCoverPage: true,
    showContents: true,
    showExecutiveSummary: true,
    showAssetSummary: true,
    showDefectsRegister: true,
    showSignOff: true,
    signOffFields: ['Technician Signature', 'Supervisor Signature', 'Customer Sign-off'],
    ...COMPANY,
  }
}

// ─────────── PM Check (single check, item-level) ───────────

const pmCheckItems: PmCheckReportItem[] = [
  { number: 1,  description: 'Visually inspect MSB room — no signs of arcing, water ingress, or rodent activity', result: 'pass', notes: null, completedBy: 'Demo Technician', completedAt: '2026-04-14T08:15:00+10:00' },
  { number: 2,  description: 'Check IR thermography of all bus connections', result: 'pass', notes: 'Hottest bus joint 38°C, ambient 24°C', completedBy: 'Demo Technician', completedAt: '2026-04-14T08:45:00+10:00' },
  { number: 3,  description: 'Verify all CB schedules match panel labels', result: 'pass', notes: null, completedBy: 'Demo Technician', completedAt: '2026-04-14T09:05:00+10:00' },
  { number: 4,  description: 'Operate each CB through close/open cycle (off-load)', result: 'pass', notes: null, completedBy: 'Demo Technician', completedAt: '2026-04-14T10:20:00+10:00' },
  { number: 5,  description: 'Test indication lamps and metering', result: 'pass', notes: 'Replaced 1 LED on incoming bay', completedBy: 'Demo Technician', completedAt: '2026-04-14T10:40:00+10:00' },
  { number: 6,  description: 'Check generator changeover scheme', result: 'pass', notes: null, completedBy: 'Demo Technician', completedAt: '2026-04-14T11:15:00+10:00' },
  { number: 7,  description: 'Inspect cable terminations for tightness (sample 10%)', result: 'pass', notes: null, completedBy: 'Demo Technician', completedAt: '2026-04-14T13:00:00+10:00' },
  { number: 8,  description: 'Verify earth bar continuity', result: 'pass', notes: null, completedBy: 'Demo Technician', completedAt: '2026-04-14T13:30:00+10:00' },
  { number: 9,  description: 'Check PFC bank operation', result: 'fail', notes: 'Step 3 contactor not pulling in — capacitor isolated, defect raised PFC-2026-002', completedBy: 'Demo Technician', completedAt: '2026-04-14T14:10:00+10:00' },
  { number: 10, description: 'Update on-site logbook', result: 'pass', notes: null, completedBy: 'Demo Technician', completedAt: '2026-04-14T15:00:00+10:00' },
]

const pmCheckInput: PmCheckReportInput = {
  checkId: 'CHK-2026-04-0042',
  siteName: CUSTOMER.siteName,
  jobPlanName: 'E1.10 - Site PM Check',
  checkDate: '2026-04-14',
  dueDate: '2026-04-30',
  startedAt: '2026-04-14T08:00:00+10:00',
  completedAt: '2026-04-14T15:30:00+10:00',
  status: 'Completed',
  assignedTo: 'Demo Technician',
  tenantProductName: TENANT_PRODUCT,
  primaryColour: PRIMARY_COLOUR,
  items: pmCheckItems,
}

// ─────────── Maintenance Checklist (printable) ───────────

const checklistAssets: ChecklistAsset[] = pmAssetSections.map((a) => ({
  assetName: a.assetName,
  assetId: a.assetId,
  location: a.location,
  workOrderNumber: a.workOrderNumber ?? null,
  tasks: PM_ACB_TASKS.map((t) => ({ order: t.order, description: t.description })),
  notes: null,
}))

function buildChecklist(format: 'simple' | 'detailed'): MaintenanceChecklistInput {
  return {
    companyName: COMPANY.companyName,
    checkName: 'HBV — Annual PM April 2026',
    siteName: CUSTOMER.siteName,
    dueDate: '30 April 2026',
    frequency: 'Annual',
    assignedTo: 'Demo Technician',
    maximoWONumber: 'WO-2026-04-1001',
    maximoPMNumber: 'PM-HBV-A-2026',
    printedDate: '22 April 2026',
    assets: checklistAssets,
    tenantProductName: TENANT_PRODUCT,
    format,
  }
}

// ─────────── ACB / NSX input builders ───────────

function buildAcbInput(complexity: 'summary' | 'standard' | 'detailed'): AcbReportInput {
  return {
    siteName: CUSTOMER.siteName,
    siteCode: CUSTOMER.siteCode,
    tenantProductName: TENANT_PRODUCT,
    primaryColour: PRIMARY_COLOUR,
    complexity,
    tests: acbTests,
    customerName: CUSTOMER.customerName,
    showCoverPage: true,
    showContents: true,
    showExecutiveSummary: true,
    showSignOff: true,
    signOffFields: ['Technician Signature', 'Supervisor Signature'],
    ...COMPANY,
  }
}

function buildNsxInput(complexity: 'summary' | 'standard' | 'detailed'): NsxReportInput {
  return {
    siteName: CUSTOMER.siteName,
    siteCode: CUSTOMER.siteCode,
    tenantProductName: TENANT_PRODUCT,
    primaryColour: PRIMARY_COLOUR,
    complexity,
    tests: nsxTests,
    showCoverPage: true,
    showContents: true,
    showExecutiveSummary: true,
    showSignOff: true,
    signOffFields: ['Technician Signature', 'Supervisor Signature'],
    ...COMPANY,
  }
}

// ─────────── runner ───────────

type Job = { name: string; build: () => Promise<Buffer> }

async function main() {
  const outDir = path.join(process.cwd(), 'tmp', 'samples', 'all-options')
  fs.mkdirSync(outDir, { recursive: true })

  const complexities: Array<'summary' | 'standard' | 'detailed'> = ['summary', 'standard', 'detailed']

  const jobs: Job[] = []

  for (const c of complexities) {
    const label = c.charAt(0).toUpperCase() + c.slice(1)
    jobs.push({ name: `ACB Test Report - ${label}.docx`, build: () => generateAcbReport(buildAcbInput(c)) })
    jobs.push({ name: `NSX Test Report - ${label}.docx`, build: () => generateNsxReport(buildNsxInput(c)) })
    jobs.push({ name: `Compliance Report - ${label}.docx`, build: () => generateComplianceReport(buildCompliance(c)) })
    jobs.push({ name: `PM Asset Report - ${label}.docx`, build: () => generatePMAssetReport(buildPmAsset(c)) })
  }

  jobs.push({ name: 'PM Check Report.docx', build: () => generatePMCheckReport(pmCheckInput) })
  jobs.push({ name: 'Maintenance Checklist - Simple.docx', build: () => generateMaintenanceChecklist(buildChecklist('simple')) })
  jobs.push({ name: 'Maintenance Checklist - Detailed.docx', build: () => generateMaintenanceChecklist(buildChecklist('detailed')) })

  let failed = 0
  for (const job of jobs) {
    try {
      process.stdout.write(`Generating ${job.name} … `)
      const buf = await job.build()
      const outPath = path.join(outDir, job.name)
      fs.writeFileSync(outPath, Buffer.from(buf))
      console.log(`${(buf.length / 1024).toFixed(1)} KB`)
    } catch (err) {
      failed++
      console.log('FAILED')
      console.error(`  ${(err as Error).message}`)
    }
  }

  console.log(`\nDone. ${jobs.length - failed} of ${jobs.length} reports written to:`)
  console.log(`  ${outDir}`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
