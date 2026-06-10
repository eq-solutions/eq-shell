'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { ReportDownloadDialog } from '@/components/ui/ReportDownloadDialog'
import type { ReportComplexity } from '@/components/ui/ReportDownloadDialog'
import { events as analyticsEvents } from '@/lib/analytics'
import { useToast } from '@/components/ui/Toast'

interface GenerateReportButtonProps {
  customerId: string
  siteId: string
  from: string
  to: string
  filterDescription: string
}

export function GenerateReportButton({ customerId, siteId, from, to, filterDescription }: GenerateReportButtonProps) {
  const [showDialog, setShowDialog] = useState(false)
  const toast = useToast()

  async function handleDownload(complexity: ReportComplexity) {
    const params = new URLSearchParams()
    if (customerId) params.set('customer_id', customerId)
    if (siteId) params.set('site_id', siteId)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    params.set('complexity', complexity)

    const res = await fetch(`/api/compliance-report?${params.toString()}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Download failed' }))
      toast.error(err.error ?? 'Report generation failed')
      throw new Error(err.error)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const disposition = res.headers.get('Content-Disposition')
    const match = disposition?.match(/filename="(.+?)"/)
    a.download = match?.[1] ?? 'Compliance Report.docx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)

    // Asset count is unknown at this layer (compliance reports are
    // multi-site/multi-asset rollups); pass 0 and let downstream filter
    // by complexity tier.
    analyticsEvents.reportGenerated({
      report_type: `compliance_${complexity}`,
      asset_count: 0,
    })
  }

  return (
    <>
      <button
        onClick={() => setShowDialog(true)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-eq-sky text-white rounded-md hover:bg-eq-deep transition-colors shrink-0"
      >
        <Download className="w-4 h-4" /> Generate Report
      </button>

      <ReportDownloadDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onDownload={handleDownload}
        title="Compliance Report"
        description={`Scope: ${filterDescription}`}
      />
    </>
  )
}
