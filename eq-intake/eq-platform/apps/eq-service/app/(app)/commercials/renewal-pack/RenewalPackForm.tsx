'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormInput } from '@/components/ui/FormInput'
import { generateRenewalPackAction } from './actions'
import { FileDown } from 'lucide-react'

interface RenewalPackFormProps {
  customers: Array<{ id: string; name: string }>
  years: string[]
}

function fyLabel(fy: string) {
  if (/^\d{4}$/.test(fy)) return `CY ${fy}`
  return `FY ${fy}`
}

function inferNext(fy: string) {
  if (/^\d{4}$/.test(fy)) return String(Number(fy) + 1)
  const m = fy.match(/^(\d{4})-(\d{4})$/)
  if (m) return `${Number(m[1]) + 1}-${Number(m[2]) + 1}`
  return ''
}

export function RenewalPackForm({ customers, years }: RenewalPackFormProps) {
  const [customerId, setCustomerId] = useState('')
  const [reviewYear, setReviewYear] = useState(years[0] ?? String(new Date().getFullYear()))
  const [nextYearOverride, setNextYearOverride] = useState('')
  const [execSummaryOverride, setExecSummaryOverride] = useState('')
  const [format, setFormat] = useState<'docx' | 'pdf'>('docx')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inferredNext = inferNext(reviewYear)
  const effectiveNext = nextYearOverride || inferredNext

  async function handleGenerate() {
    if (!customerId) {
      setError('Pick a customer first.')
      return
    }
    if (!reviewYear) {
      setError('Pick a review year first.')
      return
    }
    setLoading(true)
    setError(null)
    const fd = new FormData()
    fd.set('customer_id', customerId)
    fd.set('review_year', reviewYear)
    if (nextYearOverride) fd.set('next_year', nextYearOverride)
    fd.set('format', format)
    if (execSummaryOverride) fd.set('executive_summary_override', execSummaryOverride)
    const result = await generateRenewalPackAction(fd)
    setLoading(false)
    if (!result.success || !('data_b64' in result) || !result.data_b64) {
      setError(('error' in result && result.error) || 'Could not generate renewal pack.')
      return
    }
    const bytes = Uint8Array.from(atob(result.data_b64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: result.content_type ?? 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename ?? 'renewal-pack.docx'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Customer *</label>
            <select
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
              className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
            >
              <option value="">Select customer…</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Review Year *</label>
            <select
              value={reviewYear}
              onChange={e => setReviewYear(e.target.value)}
              className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
            >
              {years.length === 0 && <option value={String(new Date().getFullYear())}>{fyLabel(String(new Date().getFullYear()))}</option>}
              {years.map(y => <option key={y} value={y}>{fyLabel(y)}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormInput
            label="Next Year (override)"
            name="next_year"
            value={nextYearOverride}
            onChange={e => setNextYearOverride(e.target.value)}
            placeholder={`auto: ${inferredNext || '—'}`}
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Format</label>
            <select
              value={format}
              onChange={e => setFormat(e.target.value as 'docx' | 'pdf')}
              className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
            >
              <option value="docx">DOCX (always available)</option>
              <option value="pdf">PDF (falls back to DOCX if no backend)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Executive Summary (optional override)</label>
          <textarea
            value={execSummaryOverride}
            onChange={e => setExecSummaryOverride(e.target.value)}
            rows={4}
            placeholder="Leave blank to use the auto-generated summary."
            className="px-3 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
          />
        </div>

        {effectiveNext && (
          <p className="text-[11px] text-eq-grey">
            Will produce: <strong>{customers.find(c => c.id === customerId)?.name ?? '—'}</strong> · {fyLabel(reviewYear)} → {fyLabel(effectiveNext)}
          </p>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div>
          <Button onClick={handleGenerate} disabled={loading || !customerId || !reviewYear}>
            <FileDown className="w-4 h-4 mr-1.5" />
            {loading ? 'Generating…' : 'Generate Renewal Pack'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
