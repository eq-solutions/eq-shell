'use client'

import { Download } from 'lucide-react'
import { Button } from './Button'

interface ExportButtonProps {
  onClick: () => void
  label?: string
}

export function ExportButton({ onClick, label = 'Export' }: ExportButtonProps) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      <Download className="w-4 h-4 mr-1" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )
}
