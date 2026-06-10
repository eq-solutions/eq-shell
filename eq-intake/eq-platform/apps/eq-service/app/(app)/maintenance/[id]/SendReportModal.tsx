'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Send, X } from 'lucide-react'
import { issueMaintenanceReportAction } from '@/app/(app)/reports/actions'

interface SendReportModalProps {
  checkId: string
  customerEmail?: string | null
  onClose: () => void
}

/**
 * Send Report modal — picks the report flavour, generates the DOCX, uploads
 * to Storage, and emails a signed download link to the recipients.
 *
 * Report type dropdown (restored 26-Apr-2026 — was lost in prior recovery,
 * see memory note `project_phase2_ui_lost_2026_04_26`):
 *   - PM Check (default) → simpler check-level summary, pass/fail per item.
 *   - Work Order Details → per-asset Maximo-parity layout (WO# / tasks /
 *                          defects per asset). Use when the customer wants
 *                          asset-by-asset detail with their Maximo IDs.
 */
export function SendReportModal({ checkId, customerEmail, onClose }: SendReportModalProps) {
  const [emails, setEmails] = useState(customerEmail ?? '')
  const [ccEmails, setCcEmails] = useState('')
  const [message, setMessage] = useState('')
  const [reportType, setReportType] = useState<'pm_check' | 'wo_details'>('pm_check')
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ success: boolean; error?: string; revision?: number } | null>(null)

  function handleSend() {
    const toList = emails.split(/[,;\n]/).map(e => e.trim().toLowerCase()).filter(Boolean)
    if (toList.length === 0) return

    const ccList = ccEmails.split(/[,;\n]/).map(e => e.trim().toLowerCase()).filter(Boolean)

    startTransition(async () => {
      const res = await issueMaintenanceReportAction({
        maintenance_check_id: checkId,
        recipient_emails: toList,
        cc_emails: ccList.length > 0 ? ccList : undefined,
        message: message.trim() || undefined,
        report_type: reportType,
      })
      setResult(res)
    })
  }

  if (result?.success) {
    return (
      <div className="border border-green-200 rounded-lg bg-green-50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-green-600" />
          <h4 className="text-sm font-bold text-green-800">Report Sent</h4>
        </div>
        <p className="text-sm text-green-700">
          Revision {result.revision} has been generated and emailed to the recipients. They&apos;ll receive a download link valid for 30 days.
        </p>
        <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
      </div>
    )
  }

  return (
    <div className="border border-eq-sky/30 rounded-lg bg-eq-ice/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-eq-grey uppercase">Send Report to Customer</h4>
        <button onClick={onClose} className="text-eq-grey hover:text-eq-ink">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        {/* Report type — radio chips so the choice is visible inline rather
            than buried in a dropdown. Default PM Check covers most cases. */}
        <div>
          <span className="text-xs font-medium text-eq-grey">Report type</span>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setReportType('pm_check')}
              className={
                'text-left p-2.5 border rounded-md transition-colors ' +
                (reportType === 'pm_check'
                  ? 'border-eq-sky bg-white'
                  : 'border-gray-200 bg-white hover:border-eq-sky/50')
              }
            >
              <div className="text-xs font-semibold text-eq-ink">PM Check</div>
              <p className="text-[11px] text-eq-grey leading-snug mt-0.5">Default. Check-level summary with pass/fail per item.</p>
            </button>
            <button
              type="button"
              onClick={() => setReportType('wo_details')}
              className={
                'text-left p-2.5 border rounded-md transition-colors ' +
                (reportType === 'wo_details'
                  ? 'border-eq-sky bg-white'
                  : 'border-gray-200 bg-white hover:border-eq-sky/50')
              }
            >
              <div className="text-xs font-semibold text-eq-ink">Work Order Details</div>
              <p className="text-[11px] text-eq-grey leading-snug mt-0.5">Per-asset Maximo layout — WO#, tasks, defects per asset.</p>
            </button>
          </div>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-eq-grey">Recipient emails *</span>
          <input
            type="text"
            value={emails}
            onChange={e => setEmails(e.target.value)}
            placeholder="customer@example.com, another@example.com"
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
          />
          <span className="text-xs text-gray-400">Separate multiple emails with commas</span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-eq-grey">CC (optional)</span>
          <input
            type="text"
            value={ccEmails}
            onChange={e => setCcEmails(e.target.value)}
            placeholder="manager@example.com"
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-eq-grey">Message (optional)</span>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            placeholder="Please find attached your maintenance report..."
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
          />
        </label>
      </div>

      {result?.error && (
        <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded">{result.error}</p>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSend} loading={isPending} disabled={!emails.trim()}>
          <Send className="w-4 h-4 mr-1" />
          Send Report
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  )
}
