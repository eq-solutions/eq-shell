'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FileDown } from 'lucide-react'
import { generatePortalScopeStatementAction } from './actions'

interface Props {
  /** The financial year identifier (e.g. '2026' or '2025-2026'). */
  fy: string
}

export function ScopeDownloadButton({ fy }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setBusy(true)
    setError(null)
    const result = await generatePortalScopeStatementAction(fy)
    setBusy(false)
    if (!result.success || !('data_b64' in result) || !result.data_b64) {
      setError(('error' in result && result.error) || 'Could not download scope statement.')
      return
    }
    const bytes = Uint8Array.from(atob(result.data_b64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: result.content_type ?? 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename ?? 'scope-statement.docx'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex items-center gap-3">
      <Button size="sm" variant="secondary" onClick={handleClick} loading={busy}>
        <FileDown className="w-3.5 h-3.5 mr-1.5" /> Download DOCX
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
