import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { AlertTriangle, ShieldCheck, Receipt } from 'lucide-react'

/**
 * Phase 6 of the contract-scope bridge plan — service-credit risk widget.
 *
 * "Service credit" in commercial-contract speak is the financial exposure
 * a contractor carries when contracted work isn't delivered on time. For
 * tenants on the commercial tier we show:
 *
 *   - Open coverage gaps     (scope_coverage_gaps, status='open')
 *   - Pipeline variations    (contract_variations, status in draft|quoted|approved)
 *   - Estimated total exposure ($) summed from gaps' expected_amount + variations
 *
 * The widget is a server component — keeps the dashboard page DOM small,
 * data fetching scoped, and avoids leaking commercial-tier queries to
 * tenants on the free tier (those simply don't render this card).
 */

interface ServiceCreditWidgetProps {
  /**
   * Caller has already resolved the tenant's commercial flag in the
   * dashboard data fetch. We only render when this is true; the parent
   * uses `commercialEnabled && <ServiceCreditWidget />` to gate.
   */
  tenantId: string
}

function formatMoney(n: number) {
  if (!n) return '$0'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n)
}

export async function ServiceCreditWidget({ tenantId }: ServiceCreditWidgetProps) {
  const supabase = await createClient()

  // Two queries in parallel: open gaps (with their expected_amount and
  // severity for the at-risk breakdown) and in-flight variations (draft /
  // quoted / approved — billed is captured revenue, not exposure).
  const [gapsRes, variationsRes] = await Promise.all([
    supabase
      .from('scope_coverage_gaps')
      .select('id, expected_amount, severity, customer_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .eq('is_active', true),
    supabase
      .from('contract_variations')
      .select('id, value_estimate, value_approved, status')
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'quoted', 'approved']),
  ])

  type Gap = {
    id: string
    expected_amount: number | null
    severity: 'high' | 'medium' | 'low'
    customer_id: string
  }
  type Variation = {
    id: string
    value_estimate: number | null
    value_approved: number | null
    status: 'draft' | 'quoted' | 'approved' | 'rejected' | 'billed' | 'cancelled'
  }
  const gaps = (gapsRes.data ?? []) as Gap[]
  const variations = (variationsRes.data ?? []) as Variation[]

  const gapTotal = gaps.reduce((s, g) => s + (g.expected_amount ?? 0), 0)
  const highCount = gaps.filter(g => g.severity === 'high').length
  const customersWithGaps = new Set(gaps.map(g => g.customer_id)).size

  // For variations: prefer value_approved when set (commercial reality);
  // fall back to value_estimate. A blank value just contributes 0 — the
  // operator hasn't sized it yet.
  const variationTotal = variations.reduce(
    (s, v) => s + (v.value_approved ?? v.value_estimate ?? 0),
    0,
  )
  const approvedUnbilled = variations
    .filter(v => v.status === 'approved')
    .reduce((s, v) => s + (v.value_approved ?? v.value_estimate ?? 0), 0)

  const totalExposure = gapTotal + variationTotal

  // Empty state — render the card with a "no exposure" message. Better UX
  // than hiding it (operators can confirm the widget is on, not broken).
  const isEmpty = gaps.length === 0 && variations.length === 0

  return (
    <Card>
      <div className="flex items-start gap-3 p-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
          isEmpty
            ? 'bg-green-50 text-green-600'
            : highCount > 0
              ? 'bg-red-50 text-red-600'
              : 'bg-amber-50 text-amber-600'
        }`}>
          {isEmpty ? <ShieldCheck className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-eq-ink">Money at risk</h2>
            <Link href="/contract-scope" className="text-xs text-eq-sky hover:text-eq-deep font-medium">
              View detail →
            </Link>
          </div>
          {isEmpty ? (
            <p className="text-sm text-eq-grey mt-1">
              All contracted work is covered and there are no variations underway. No money at risk today.
            </p>
          ) : (
            <>
              <p className="text-2xl font-bold text-eq-ink mt-0.5">{formatMoney(totalExposure)}</p>
              <p className="text-xs text-eq-grey">
                Estimated money at risk across {customersWithGaps} {customersWithGaps === 1 ? 'customer' : 'customers'}
                {highCount > 0 && (
                  <> · <span className="text-red-600 font-semibold">{highCount} high-severity</span></>
                )}
              </p>
            </>
          )}
        </div>
      </div>
      {!isEmpty && (
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          <Link
            href="/contract-scope"
            className="rounded-lg bg-amber-50/60 border border-amber-100 p-3 hover:bg-amber-50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-amber-700 font-bold">Coverage gaps</span>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <p className="text-lg font-bold text-amber-800 mt-1">{formatMoney(gapTotal)}</p>
            <p className="text-[11px] text-eq-grey">{gaps.length} open {gaps.length === 1 ? 'gap' : 'gaps'}</p>
          </Link>
          <Link
            href="/variations"
            className="rounded-lg bg-eq-ice/60 border border-eq-ice p-3 hover:bg-eq-ice/80 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-eq-deep font-bold">Variations in flight</span>
              <Receipt className="w-3.5 h-3.5 text-eq-deep" />
            </div>
            <p className="text-lg font-bold text-eq-deep mt-1">{formatMoney(variationTotal)}</p>
            <p className="text-[11px] text-eq-grey">
              {variations.length} active
              {approvedUnbilled > 0 && <> · {formatMoney(approvedUnbilled)} approved unbilled</>}
            </p>
          </Link>
        </div>
      )}
    </Card>
  )
}
