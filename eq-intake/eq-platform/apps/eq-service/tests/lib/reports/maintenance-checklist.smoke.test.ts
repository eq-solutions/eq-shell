/**
 * Smoke test: Maintenance Checklist (Field Run-Sheet) at all three formats.
 *
 * Generates a DOCX per format with synthetic SY3-shaped data and writes each
 * to ./tmp/smoke/ so Royce can open them to visually verify the 2026-04-28
 * run-sheet changes (PR K — #55):
 *   - simple   : master register only (one-page hand-out)
 *   - standard : NEW DEFAULT — master register + per-asset detail cards.
 *                Cover sits on its own page; first asset starts on page 2.
 *   - detailed : per-asset detail cards only (no master)
 *
 * Brand strip uses auto-darkened primaryColour — the smoke uses SKS purple
 * (#7C77B9) so the strip should render as a darker purple with the white
 * report-type label readable on top.
 *
 * Run: npx vitest run tests/lib/reports/maintenance-checklist.smoke.test.ts
 *
 * Output: tmp/smoke/run-sheet-{simple,standard,detailed}.docx
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateMaintenanceChecklist } from '@/lib/reports/maintenance-checklist'
import type {
  MaintenanceChecklistInput,
  ChecklistAsset,
} from '@/lib/reports/maintenance-checklist'

const OUT_DIR = resolve(process.cwd(), 'tmp', 'smoke')

// Three SY3-shaped breakers — enough to see the master-register row count
// + per-asset card pagination work the way you expect.
const assets: ChecklistAsset[] = [
  {
    assetName: 'SY3-M1-MSB-01-ACB-CB5-Gen Supply',
    assetId: '2719',
    location: 'SY3-LG31 — Lower Ground Floor LV Switchroom MSB M1',
    workOrderNumber: 'WO-100345',
    tasks: [
      { order: 1, description: 'Breaker (Brand / Model / Serial): _______________________________________________' },
      { order: 2, description: 'Visual & Functional checks (record anomalies in comment)' },
      { order: 3, description: 'Electrical readings — Contact resistance R/W/B (µΩ), IR closed/open (MΩ), temperature (°C)' },
      { order: 4, description: 'Overall result: Pass / Fail / Defect (circle one)' },
      { order: 5, description: 'Notes / follow-up' },
    ],
    notes: null,
  },
  {
    assetName: 'SY3-M1-GSB-01, ACB-CB2-Feeder',
    assetId: '2638',
    location: 'SY3-GF-PR — Ground Floor Plant Room',
    workOrderNumber: null,
    tasks: [
      { order: 1, description: 'Breaker (Brand / Model / Serial): _______________________________________________' },
      { order: 2, description: 'Visual & Functional checks (record anomalies in comment)' },
      { order: 3, description: 'Electrical readings — Contact resistance R/W/B (µΩ), IR closed/open (MΩ), temperature (°C)' },
      { order: 4, description: 'Overall result: Pass / Fail / Defect (circle one)' },
      { order: 5, description: 'Notes / follow-up' },
    ],
    notes: null,
  },
  {
    assetName: 'SY3-B3-MSB-03-ACB-CB14-B3-MSB-02',
    assetId: '2822',
    location: 'SY3-GF56 — Ground Floor UPS Room B3',
    workOrderNumber: null,
    tasks: [
      { order: 1, description: 'Breaker (Brand / Model / Serial): _______________________________________________' },
      { order: 2, description: 'Visual & Functional checks (record anomalies in comment)' },
      { order: 3, description: 'Electrical readings — Contact resistance R/W/B (µΩ), IR closed/open (MΩ), temperature (°C)' },
      { order: 4, description: 'Overall result: Pass / Fail / Defect (circle one)' },
      { order: 5, description: 'Notes / follow-up' },
    ],
    notes: null,
  },
]

const baseInput: Omit<MaintenanceChecklistInput, 'format'> = {
  companyName: 'SKS Technologies Pty Ltd',
  companyAbn: '40 651 962 935',
  checkName: 'SY3 Annual LVACB April 2026 (Smoke)',
  siteName: 'SY3',
  dueDate: '01 April 2026',
  frequency: 'Annual',
  assignedTo: 'Royce Milmlow',
  maximoWONumber: null,
  maximoPMNumber: 'LVACB',
  printedDate: new Date().toLocaleDateString('en-AU', {
    day: '2-digit', month: 'long', year: 'numeric',
  }),
  assets,
  tenantProductName: 'SKS Technologies',
  // SKS brand purple — should render as a darker purple on the strip.
  primaryColour: '#7C77B9',
  // deepColour intentionally NOT set so the strip auto-darkens the primary
  // (the new behaviour from PR K — flat-colour-pop fix).
  deepColour: null,
  iceColour: null,
  inkColour: null,
  tenantLogoImage: null,
  customerLogoImage: null,
}

beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true })
})

describe('Maintenance Checklist smoke test', () => {
  it('generates the simple (master-only) format', async () => {
    const buf = await generateMaintenanceChecklist({ ...baseInput, format: 'simple' })
    const out = resolve(OUT_DIR, 'run-sheet-simple.docx')
    writeFileSync(out, buf)
    expect(buf.length).toBeGreaterThan(5000)
  })

  it('generates the standard (master + cards) format — NEW DEFAULT', async () => {
    const buf = await generateMaintenanceChecklist({ ...baseInput, format: 'standard' })
    const out = resolve(OUT_DIR, 'run-sheet-standard.docx')
    writeFileSync(out, buf)
    expect(buf.length).toBeGreaterThan(10000)
  })

  it('generates the detailed (cards-only) format', async () => {
    const buf = await generateMaintenanceChecklist({ ...baseInput, format: 'detailed' })
    const out = resolve(OUT_DIR, 'run-sheet-detailed.docx')
    writeFileSync(out, buf)
    expect(buf.length).toBeGreaterThan(8000)
  })
})
