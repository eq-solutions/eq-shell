'use client'

import { Button } from '@/components/ui/Button'
import { Download } from 'lucide-react'
import { toCsv, downloadCsv, type CsvCell } from '@/lib/utils/csv'

interface CsvExportButtonProps<T extends Record<string, CsvCell>> {
  filename: string
  rows: T[]
  headers: { key: keyof T & string; label?: string }[]
  size?: 'sm' | 'md'
  label?: string
  disabled?: boolean
}

export function CsvExportButton<T extends Record<string, CsvCell>>({
  filename,
  rows,
  headers,
  size = 'sm',
  label = 'Export',
  disabled,
}: CsvExportButtonProps<T>) {
  function handleClick() {
    const csv = toCsv(rows, headers)
    downloadCsv(filename, csv)
  }
  return (
    <Button variant="secondary" size={size} onClick={handleClick} disabled={disabled || rows.length === 0}>
      <Download className="w-4 h-4 mr-1" />
      {label}
    </Button>
  )
}
