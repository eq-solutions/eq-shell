import { describe, it, expect } from 'vitest'
import { parseCSV, autoMapColumns } from '@/lib/utils/csv-parser'

describe('CSV Parser', () => {
  describe('parseCSV', () => {
    it('parses simple CSV', () => {
      const csv = 'name,age,city\nJohn,30,NYC\nJane,25,LA'
      const result = parseCSV(csv)

      expect(result.headers).toEqual(['name', 'age', 'city'])
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toEqual({ name: 'John', age: '30', city: 'NYC' })
      expect(result.rows[1]).toEqual({ name: 'Jane', age: '25', city: 'LA' })
    })

    it('handles quoted fields with commas', () => {
      const csv = 'name,address,city\nJohn,"123 Main St, Apt 4",NYC'
      const result = parseCSV(csv)

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].address).toContain('123 Main St, Apt 4')
    })

    it('handles empty rows', () => {
      const csv = 'name,age\nJohn,30\n\nJane,25'
      const result = parseCSV(csv)

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].name).toBe('John')
      expect(result.rows[1].name).toBe('Jane')
    })

    it('normalizes headers with spaces to underscores', () => {
      const csv = 'first name,last name,age\nJohn,Doe,30'
      const result = parseCSV(csv)

      expect(result.headers).toEqual(['first_name', 'last_name', 'age'])
    })

    it('returns empty for files with only headers', () => {
      const csv = 'name,age,city'
      const result = parseCSV(csv)

      // parseCSV filters out lines with no content, so header-only returns empty
      expect(result.headers).toEqual([])
      expect(result.rows).toHaveLength(0)
    })

    it('returns empty for empty input', () => {
      const result = parseCSV('')

      expect(result.headers).toEqual([])
      expect(result.rows).toEqual([])
    })

    it('handles different line endings', () => {
      const csv = 'name,age\r\nJohn,30\r\nJane,25'
      const result = parseCSV(csv)

      expect(result.rows).toHaveLength(2)
    })
  })

  describe('autoMapColumns', () => {
    it('maps exact column matches', () => {
      const csvHeaders = ['name', 'age', 'city']
      const allColumns = ['name', 'age', 'city']
      const map = autoMapColumns(csvHeaders, allColumns)

      expect(map).toEqual({
        name: 'name',
        age: 'age',
        city: 'city',
      })
    })

    it('maps with fuzzy matching (underscores and spaces)', () => {
      const csvHeaders = ['first name', 'last_name']
      const allColumns = ['first_name', 'last name']
      const map = autoMapColumns(csvHeaders, allColumns)

      expect(map.first_name).toBe('first name')
      // 'last name' column in allColumns matches 'last_name' in csvHeaders
      expect(map['last name']).toEqual('last_name')
    })

    it('handles dashes in fuzzy matching', () => {
      const csvHeaders = ['user-id', 'first-name']
      const allColumns = ['user_id', 'first name']
      const map = autoMapColumns(csvHeaders, allColumns)

      expect(map['user_id']).toBe('user-id')
      expect(map['first name']).toBe('first-name')
    })

    it('returns empty map for unmatched columns', () => {
      const csvHeaders = ['name', 'age']
      const allColumns = ['first_name', 'last_name']
      const map = autoMapColumns(csvHeaders, allColumns)

      expect(map).toEqual({})
    })

    it('handles partial matches', () => {
      const csvHeaders = ['name', 'age', 'email']
      const allColumns = ['name', 'email']
      const map = autoMapColumns(csvHeaders, allColumns)

      expect(map).toEqual({
        name: 'name',
        email: 'email',
      })
    })
  })
})
