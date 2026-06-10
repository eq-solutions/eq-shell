/**
 * Unit tests for the Delta-row → check_assets-insert mapping helper.
 *
 * These cover the enum normalisers (the bit that has the most room for
 * silently going wrong) and the full helper end-to-end against a
 * hand-built DeltaRow, so the existing wizards now save the wider Maximo
 * payload on every row.
 */
import { describe, it, expect } from 'vitest'
import {
  deltaRowToCheckAssetInsert,
  normalisePriority,
  normaliseWorkType,
  normaliseIrScan,
} from '@/lib/import/delta-row-mapping'
import type { DeltaRow } from '@/lib/import/delta-wo-parser'

const baseRow: DeltaRow = {
  rowNumber: 2,
  site: 'AU01-SY3',
  siteCode: 'SY3',
  workOrder: 'WO-1001',
  description: 'SY3-A1-TPL-01',
  classification: 'ELEC \\ TRNSFMR',
  location: 'SY3-GF16',
  maximoAssetId: '12345',
  jobPlanRaw: 'LVACB-A',
  jobPlanCode: 'LVACB',
  frequencySuffix: 'A',
  frequency: 'annual',
  targetStart: new Date('2026-08-15T00:00:00.000Z'),
  priority: '1',
  workType: 'PM',
  crewId: 'CREW-NSW-A',
  targetFinish: new Date('2026-08-22T00:00:00.000Z'),
  failureCode: 'FC-INSP',
  problem: 'Annual inspection due',
  cause: null,
  remedy: null,
  irScanResult: 'pass',
  maximoTaskId: 'T-001',
  warnings: [],
}

describe('normalisePriority', () => {
  it('maps Maximo "1" to urgent', () => {
    expect(normalisePriority('1')).toBe('urgent')
  })
  it('maps "p2" to high', () => {
    expect(normalisePriority('p2')).toBe('high')
  })
  it('passes through "medium" untouched', () => {
    expect(normalisePriority('medium')).toBe('medium')
  })
  it('returns null for unknown values', () => {
    expect(normalisePriority('totally bogus')).toBeNull()
  })
  it('returns null for null', () => {
    expect(normalisePriority(null)).toBeNull()
  })
  it('is case-insensitive', () => {
    expect(normalisePriority('LOW')).toBe('low')
  })
})

describe('normaliseWorkType', () => {
  it('maps short PM code', () => {
    expect(normaliseWorkType('PM')).toBe('PM')
  })
  it('maps the long "preventive_maintenance" form', () => {
    expect(normaliseWorkType('preventive_maintenance')).toBe('PM')
  })
  it('maps "calibration" to CAL', () => {
    expect(normaliseWorkType('calibration')).toBe('CAL')
  })
  it('returns null for unknown', () => {
    expect(normaliseWorkType('xyz')).toBeNull()
  })
})

describe('normaliseIrScan', () => {
  it('maps "p" to pass', () => {
    expect(normaliseIrScan('p')).toBe('pass')
  })
  it('maps "n/a" to na', () => {
    expect(normaliseIrScan('n/a')).toBe('na')
  })
  it('maps "skipped" to not_done', () => {
    expect(normaliseIrScan('skipped')).toBe('not_done')
  })
  it('returns null for unknown', () => {
    expect(normaliseIrScan('maybe')).toBeNull()
  })
})

describe('deltaRowToCheckAssetInsert', () => {
  const ctx = {
    tenantId: '11111111-1111-1111-1111-111111111111',
    checkId: '22222222-2222-2222-2222-222222222222',
    assetId: '33333333-3333-3333-3333-333333333333',
  }

  it('produces an Insert row with all the extra Maximo columns populated', () => {
    const insert = deltaRowToCheckAssetInsert(baseRow, ctx)
    expect(insert).toMatchObject({
      tenant_id: ctx.tenantId,
      check_id: ctx.checkId,
      asset_id: ctx.assetId,
      status: 'pending',
      work_order_number: 'WO-1001',
      priority: 'urgent',
      work_type: 'PM',
      crew_id: 'CREW-NSW-A',
      target_start: '2026-08-15T00:00:00.000Z',
      target_finish: '2026-08-22T00:00:00.000Z',
      failure_code: 'FC-INSP',
      problem: 'Annual inspection due',
      cause: null,
      remedy: null,
      classification: 'ELEC \\ TRNSFMR',
      ir_scan_result: 'pass',
    })
  })

  it('passes null through for absent fields rather than dropping them', () => {
    const sparse: DeltaRow = {
      ...baseRow,
      priority: null,
      workType: null,
      crewId: null,
      targetFinish: null,
      failureCode: null,
      problem: null,
      cause: null,
      remedy: null,
      classification: null,
      irScanResult: null,
    }
    const insert = deltaRowToCheckAssetInsert(sparse, ctx)
    expect(insert.priority).toBeNull()
    expect(insert.work_type).toBeNull()
    expect(insert.crew_id).toBeNull()
    expect(insert.target_finish).toBeNull()
    expect(insert.failure_code).toBeNull()
    expect(insert.problem).toBeNull()
    expect(insert.cause).toBeNull()
    expect(insert.remedy).toBeNull()
    expect(insert.classification).toBeNull()
    expect(insert.ir_scan_result).toBeNull()
    // status + WO still set
    expect(insert.status).toBe('pending')
    expect(insert.work_order_number).toBe('WO-1001')
  })

  it('drops priority values it cannot recognise rather than persisting garbage', () => {
    const insert = deltaRowToCheckAssetInsert(
      { ...baseRow, priority: 'NSW-CUSTOM-PRIORITY-7' },
      ctx,
    )
    expect(insert.priority).toBeNull()
  })
})
