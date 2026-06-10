'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'
import { getScopeContextAction } from '@/app/(app)/maintenance/scope-context-action'
import type { ScopeContextResult, ScopeStatus } from '@/lib/scope-context/lookup'

interface ScopeContextChipProps {
  customerId: string | null
  siteId: string | null
  jobPlanId: string | null
  assetId?: string | null
  year?: number
  /**
   * When true and status is 'out_of_scope', a hidden input named
   * `out_of_scope_acknowledged` is rendered so the parent form gets it
   * on submit. Drives the Phase 3 server-action gate.
   */
  surfaceOverrideField?: boolean
}

/**
 * Compact chip + detail line that surfaces "is this work in scope?"
 * Drives green / amber / red theming based on the lookup. Renders
 * 'Checking…' while the lookup is in flight; renders nothing when
 * required ids aren't supplied yet.
 *
 * For Create-Check: pass customer/site/job_plan and the chip lights up
 * as the operator picks them. The form can render an override checkbox
 * conditional on the chip's status.
 */
export function ScopeContextChip({
  customerId,
  siteId,
  jobPlanId,
  assetId,
  year,
  surfaceOverrideField,
}: ScopeContextChipProps) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ScopeContextResult | null>(null)
  // Cancel stale lookups so a fast-clicking operator doesn't see a
  // late-arriving response for a previous selection win the chip.
  const seq = useRef(0)

  useEffect(() => {
    if (!customerId || !jobPlanId) {
      setResult(null)
      return
    }
    const mySeq = ++seq.current
    const fd = new FormData()
    fd.set('customer_id', customerId)
    if (siteId) fd.set('site_id', siteId)
    fd.set('job_plan_id', jobPlanId)
    if (assetId) fd.set('asset_id', assetId)
    if (year) fd.set('year', String(year))
    startTransition(async () => {
      const res = await getScopeContextAction(fd)
      if (mySeq === seq.current) setResult(res as ScopeContextResult)
    })
  }, [customerId, siteId, jobPlanId, assetId, year])

  if (!customerId || !jobPlanId) return null

  if (pending && !result) {
    return (
      <div className="text-xs text-eq-grey px-3 py-2 flex items-center gap-2">
        <Info className="w-3.5 h-3.5" /> Checking scope…
      </div>
    )
  }

  if (!result) return null

  const theme = themeFor(result.status as ScopeStatus | 'error')

  return (
    <div className="space-y-2">
      <div
        className={
          'rounded-md border px-3 py-2 flex items-start gap-2 text-xs ' +
          theme.classes
        }
      >
        <theme.Icon className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold">{result.label}</p>
          {result.detail && <p className="mt-0.5 opacity-90">{result.detail}</p>}
          {result.matched_year && (
            <p className="mt-0.5 text-[10px] opacity-70">
              Matched scope row for <span className="font-mono">{result.matched_year}</span>
            </p>
          )}
        </div>
      </div>
      {surfaceOverrideField && (result.status === 'out_of_scope' || result.status === 'excluded') && (
        <input type="hidden" name="scope_status" value={result.status} />
      )}
    </div>
  )
}

function themeFor(status: ScopeStatus | 'error') {
  switch (status) {
    case 'contracted':
      return {
        Icon: CheckCircle2,
        classes: 'bg-green-50 border-green-200 text-green-800',
      }
    case 'ad_hoc':
      return {
        Icon: AlertTriangle,
        classes: 'bg-amber-50 border-amber-200 text-amber-900',
      }
    case 'excluded':
      return {
        Icon: XCircle,
        classes: 'bg-red-50 border-red-200 text-red-800',
      }
    case 'out_of_scope':
      return {
        Icon: XCircle,
        classes: 'bg-red-50 border-red-200 text-red-800',
      }
    case 'error':
    default:
      return {
        Icon: Info,
        classes: 'bg-gray-50 border-gray-200 text-eq-grey',
      }
  }
}
