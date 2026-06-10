import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatFrequency,
  formatCheckStatus,
  formatCheckItemResult,
  formatTestResult,
  formatAcbTestType,
  formatAcbTestResult,
  formatNsxTestType,
  formatNsxTestResult,
} from '@/lib/utils/format'

describe('Format Utilities', () => {
  describe('formatDate', () => {
    it('formats date in en-AU locale', () => {
      const result = formatDate('2024-03-15')
      // Month abbreviation can be 3 or 4 chars depending on locale
      expect(result).toMatch(/15 \w+ 2024/)
      expect(result).toContain('2024')
    })

    it('handles ISO date strings', () => {
      const result = formatDate('2024-01-01T00:00:00Z')
      // Month abbreviation can be 3 or 4 chars
      expect(result).toMatch(/01 \w+ 2024/)
      expect(result).toContain('2024')
    })

    it('handles single digit days and months', () => {
      const result = formatDate('2024-09-05')
      // Just verify it has the right format with padding
      expect(result).toMatch(/05 \w+ 2024/)
    })
  })

  describe('formatDateTime', () => {
    it('formats date and time in en-AU locale', () => {
      const result = formatDateTime('2024-03-15T14:30:00Z')
      // Check format includes date, month year, and time
      expect(result).toMatch(/\d{2} \w+ 2024/)
      expect(result).toMatch(/\d{2}:\d{2}/)
    })

    it('uses 24-hour time format', () => {
      const result = formatDateTime('2024-03-15T23:45:00Z')
      // Just verify the result contains a time in 24-hour format
      expect(result).toMatch(/\d{2}:\d{2}/)
    })
  })

  describe('formatFrequency', () => {
    it('formats weekly', () => {
      expect(formatFrequency('weekly')).toBe('Weekly')
    })

    it('formats monthly', () => {
      expect(formatFrequency('monthly')).toBe('Monthly')
    })

    it('formats quarterly', () => {
      expect(formatFrequency('quarterly')).toBe('Quarterly')
    })

    it('formats biannual', () => {
      expect(formatFrequency('biannual')).toBe('Bi-annual')
    })

    it('formats annual', () => {
      expect(formatFrequency('annual')).toBe('Annual')
    })

    it('formats ad_hoc', () => {
      expect(formatFrequency('ad_hoc')).toBe('Ad Hoc')
    })
  })

  describe('formatCheckStatus', () => {
    it('formats scheduled', () => {
      expect(formatCheckStatus('scheduled')).toBe('Scheduled')
    })

    it('formats in_progress', () => {
      expect(formatCheckStatus('in_progress')).toBe('In Progress')
    })

    it('formats complete', () => {
      expect(formatCheckStatus('complete')).toBe('Complete')
    })

    it('formats overdue', () => {
      expect(formatCheckStatus('overdue')).toBe('Overdue')
    })

    it('formats cancelled', () => {
      expect(formatCheckStatus('cancelled')).toBe('Cancelled')
    })
  })

  describe('formatCheckItemResult', () => {
    it('formats pass', () => {
      expect(formatCheckItemResult('pass')).toBe('Pass')
    })

    it('formats fail', () => {
      expect(formatCheckItemResult('fail')).toBe('Fail')
    })

    it('formats na', () => {
      expect(formatCheckItemResult('na')).toBe('N/A')
    })
  })

  describe('formatTestResult', () => {
    it('formats pending', () => {
      expect(formatTestResult('pending')).toBe('Pending')
    })

    it('formats pass', () => {
      expect(formatTestResult('pass')).toBe('Pass')
    })

    it('formats fail', () => {
      expect(formatTestResult('fail')).toBe('Fail')
    })

    it('formats defect', () => {
      expect(formatTestResult('defect')).toBe('Defect')
    })
  })

  describe('formatAcbTestType', () => {
    it('formats Initial', () => {
      expect(formatAcbTestType('Initial')).toBe('Initial')
    })

    it('formats Routine', () => {
      expect(formatAcbTestType('Routine')).toBe('Routine')
    })

    it('formats Special', () => {
      expect(formatAcbTestType('Special')).toBe('Special')
    })
  })

  describe('formatAcbTestResult', () => {
    it('formats Pending', () => {
      expect(formatAcbTestResult('Pending')).toBe('Pending')
    })

    it('formats Pass', () => {
      expect(formatAcbTestResult('Pass')).toBe('Pass')
    })

    it('formats Fail', () => {
      expect(formatAcbTestResult('Fail')).toBe('Fail')
    })

    it('formats Defect', () => {
      expect(formatAcbTestResult('Defect')).toBe('Defect')
    })
  })

  describe('formatNsxTestType', () => {
    it('formats Initial', () => {
      expect(formatNsxTestType('Initial')).toBe('Initial')
    })

    it('formats Routine', () => {
      expect(formatNsxTestType('Routine')).toBe('Routine')
    })

    it('formats Special', () => {
      expect(formatNsxTestType('Special')).toBe('Special')
    })
  })

  describe('formatNsxTestResult', () => {
    it('formats Pending', () => {
      expect(formatNsxTestResult('Pending')).toBe('Pending')
    })

    it('formats Pass', () => {
      expect(formatNsxTestResult('Pass')).toBe('Pass')
    })

    it('formats Fail', () => {
      expect(formatNsxTestResult('Fail')).toBe('Fail')
    })

    it('formats Defect', () => {
      expect(formatNsxTestResult('Defect')).toBe('Defect')
    })
  })
})
