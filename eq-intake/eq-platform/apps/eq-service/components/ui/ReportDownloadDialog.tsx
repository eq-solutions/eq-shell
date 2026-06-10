'use client'

import { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { FileText, Download, Loader2 } from 'lucide-react'

export type ReportComplexity = 'summary' | 'standard' | 'detailed'

interface ReportDownloadDialogProps {
  open: boolean
  onClose: () => void
  /** Pre-selected complexity from tenant settings */
  defaultComplexity?: ReportComplexity
  /** Called with the chosen complexity — caller handles the actual download */
  onDownload: (complexity: ReportComplexity) => Promise<void>
  /** Optional title override */
  title?: string
  /** Optional description shown below the title */
  description?: string
}

const COMPLEXITY_OPTIONS: { value: ReportComplexity; label: string; desc: string }[] = [
  { value: 'summary', label: 'Summary', desc: 'KPIs, pass/fail counts, and high-level overview' },
  { value: 'standard', label: 'Standard', desc: 'Asset details, test results, and recommendations' },
  { value: 'detailed', label: 'Detailed', desc: 'Full data including all readings and commentary' },
]

export function ReportDownloadDialog({
  open,
  onClose,
  defaultComplexity = 'standard',
  onDownload,
  title = 'Generate Report',
  description,
}: ReportDownloadDialogProps) {
  const [complexity, setComplexity] = useState<ReportComplexity>(defaultComplexity)
  const [loading, setLoading] = useState(false)

  async function handleDownload() {
    setLoading(true)
    try {
      await onDownload(complexity)
      onClose()
    } catch {
      // Caller handles error display
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div>
          {description && <p className="text-xs text-eq-grey mb-2">{description}</p>}
          <p className="text-xs text-eq-grey mb-3">Choose report detail level</p>
          <div className="grid grid-cols-3 gap-2">
            {COMPLEXITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setComplexity(opt.value)}
                className="flex flex-col items-start p-3 rounded-lg border transition-colors text-left hover:bg-gray-50"
                style={{ borderColor: complexity === opt.value ? 'var(--eq-sky, #3DA8D8)' : '#e5e7eb' }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <FileText className={`w-3.5 h-3.5 ${complexity === opt.value ? 'text-eq-sky' : 'text-gray-300'}`} />
                  <p className="text-sm font-medium text-eq-ink">{opt.label}</p>
                </div>
                <p className="text-[11px] text-eq-grey leading-tight">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleDownload} disabled={loading}>
            {loading ? (
              <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Generating…</>
            ) : (
              <><Download className="w-4 h-4 mr-1.5" /> Download</>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
