import { describe, it, expect } from 'vitest'
import { levenshtein, closestMatch } from '@/lib/utils/levenshtein'

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('MVSWDB', 'MVSWDB')).toBe(0)
  })

  it('is case-insensitive', () => {
    expect(levenshtein('mvswdb', 'MVSWDB')).toBe(0)
  })

  it('distance 1 for a single swap (Delta typo case)', () => {
    // MVSWBD → MVSWDB is a transposition — two substitutions in Levenshtein.
    expect(levenshtein('MVSWBD', 'MVSWDB')).toBe(2)
  })

  it('distance 1 for a single character difference', () => {
    expect(levenshtein('LVACB', 'LVACC')).toBe(1)
  })

  it('distance equals length when one side is empty', () => {
    expect(levenshtein('', 'HELLO')).toBe(5)
    expect(levenshtein('HELLO', '')).toBe(5)
  })

  it('counts insertions', () => {
    expect(levenshtein('ATS', 'ATSX')).toBe(1)
  })
})

describe('closestMatch', () => {
  const codes = ['LVACB', 'MVSWDB', 'PDU', 'ATS', 'SWBD']

  it('finds an exact match at distance 0', () => {
    expect(closestMatch('LVACB', codes)).toEqual({ value: 'LVACB', distance: 0 })
  })

  it('finds a near match for Delta MVSWBD → MVSWDB within maxDistance=2', () => {
    expect(closestMatch('MVSWBD', codes, 2)).toEqual({
      value: 'MVSWDB',
      distance: 2,
    })
  })

  it('returns null when no candidate is within maxDistance', () => {
    expect(closestMatch('XYZQRT', codes, 2)).toBeNull()
  })

  it('maxDistance=1 rejects the 2-edit MVSWBD typo', () => {
    expect(closestMatch('MVSWBD', codes, 1)).toBeNull()
  })

  it('returns first candidate on tie', () => {
    // Both "LVACC" and "LVACX" would be distance 1 from "LVACB" — input
    // order is the tiebreak.
    const result = closestMatch('LVACB', ['LVACC', 'LVACX'], 1)
    expect(result?.value).toBe('LVACC')
  })
})
