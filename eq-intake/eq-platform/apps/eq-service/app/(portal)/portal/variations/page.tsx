import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { FileSignature, AlertTriangle } from 'lucide-react'
import { formatDate } from '@/lib/utils/format'

/**
 * Portal "Variations" page — approved + billed variations against the
 * customer's contract. Gated on tenant.commercial_features_enabled
 * (the Variations tab is hidden in the nav for free-tier tenants, but
 * we double-check at the page level too).
 */
const statusTone: Record<string, string> = {
  approved: 'bg-green-50 text-green-700 border-green-200',
  billed:   'bg-eq-ice text-eq-deep border-eq-ice',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  cancelled:'bg-gray-100 text-gray-600 border-gray-200',
  draft:    'bg-amber-50 text-amber-700 border-amber-200',
  quoted:   'bg-eq-ice text-eq-deep border-eq-ice',
}

function fmtMoney(n: number | null) {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n)
}

export default async function PortalVariationsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/portal/login')

  const [{ data: customerIdRpc }, { data: tenantIdRpc }] = await Promise.all([
    supabase.rpc('get_portal_customer_id'),
    supabase.rpc('get_portal_tenant_id'),
  ])
  const customerId = customerIdRpc as string | null
  const tenantId = tenantIdRpc as string | null
  if (!customerId || !tenantId) redirect('/portal/login')

  // Commercial-tier gate.
  const { data: ts } = await supabase
    .from('tenant_settings')
    .select('commercial_features_enabled')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const commercialEnabled = Boolean(
    (ts as { commercial_features_enabled?: boolean } | null)?.commercial_features_enabled,
  )
  if (!commercialEnabled) {
    return (
      <Card>
        <div className="text-center py-12">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-eq-ink">Variations not available</p>
          <p className="text-sm text-eq-grey mt-1">This feature is enabled per contract — contact your account manager if you'd like access.</p>
        </div>
      </Card>
    )
  }

  // Customer-facing list — show approved + billed only (drafts/quoted/
  // rejected/cancelled are internal-only).
  const { data: rows } = await supabase
    .from('contract_variations')
    .select('id, variation_number, title, description, financial_year, status, value_estimate, value_approved, customer_ref, approved_at, billed_at, created_at')
    .eq('customer_id', customerId)
    .in('status', ['approved', 'billed'])
    .order('created_at', { ascending: false })

  type Row = {
    id: string; variation_number: string; title: string; description: string | null
    financial_year: string | null
    status: string
    value_estimate: number | null
    value_approved: number | null
    customer_ref: string | null
    approved_at: string | null
    billed_at: string | null
    created_at: string
  }
  const variations = (rows ?? []) as Row[]

  const totalApproved = variations.filter(v => v.status === 'approved').reduce((s, v) => s + (v.value_approved ?? v.value_estimate ?? 0), 0)
  const totalBilled = variations.filter(v => v.status === 'billed').reduce((s, v) => s + (v.value_approved ?? v.value_estimate ?? 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-eq-ink">Approved variations</h1>
        <p className="text-sm text-eq-grey mt-1">
          Out-of-contract work approved against your account. Drafts and rejected items aren't shown.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiTile label="Approved (unbilled)" value={fmtMoney(totalApproved)} />
        <KpiTile label="Billed to date" value={fmtMoney(totalBilled)} />
        <KpiTile label="Total variations" value={String(variations.length)} />
      </div>

      {variations.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <FileSignature className="w-10 h-10 text-eq-grey mx-auto mb-2" />
            <p className="text-sm font-medium text-eq-ink">No approved variations yet</p>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wide text-eq-grey">
                <tr>
                  <th className="px-3 py-2 font-bold">#</th>
                  <th className="px-3 py-2 font-bold">Description</th>
                  <th className="px-3 py-2 font-bold">FY</th>
                  <th className="px-3 py-2 font-bold">Status</th>
                  <th className="px-3 py-2 font-bold text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {variations.map(v => (
                  <tr key={v.id} className="hover:bg-eq-ice/10">
                    <td className="px-3 py-2 font-mono text-xs text-eq-deep whitespace-nowrap">{v.variation_number}</td>
                    <td className="px-3 py-2 text-eq-ink max-w-[18rem]">
                      <p className="truncate" title={v.title}>{v.title}</p>
                      {v.customer_ref && <p className="text-[10px] text-eq-grey">PO {v.customer_ref}</p>}
                    </td>
                    <td className="px-3 py-2 text-eq-grey text-xs">{v.financial_year ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-semibold ${statusTone[v.status] ?? ''}`}>
                        {v.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-eq-ink whitespace-nowrap">
                      {fmtMoney(v.value_approved ?? v.value_estimate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-3">
      <p className="text-[10px] uppercase tracking-wide text-eq-grey font-bold">{label}</p>
      <p className="text-xl font-bold text-eq-ink mt-1">{value}</p>
    </div>
  )
}
