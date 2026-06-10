import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { CheckCircle2, XCircle, Scale } from 'lucide-react'
import { ScopeDownloadButton } from './ScopeDownloadButton'

/**
 * Portal "Scope" page — customer-facing read-only view of the contracted
 * scope items grouped by financial year. The same data the Customer
 * Scope Statement DOCX exports, presented inline.
 */
function fyLabel(fy: string) {
  if (/^\d{4}$/.test(fy)) return `Calendar Year ${fy}`
  return `Financial Year ${fy}`
}

export default async function PortalScopePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/portal/login')

  const [{ data: customerIdRpc }, { data: tenantIdRpc }] = await Promise.all([
    supabase.rpc('get_portal_customer_id'),
    supabase.rpc('get_portal_tenant_id'),
  ])
  const customerId = customerIdRpc as string | null
  const tenantId = tenantIdRpc as string | null
  if (!customerId) redirect('/portal/login')

  // Gate the Download button on commercial tier — same as the rest of
  // the scope-statement feature.
  let commercialEnabled = false
  if (tenantId) {
    const { data: ts } = await supabase
      .from('tenant_settings')
      .select('commercial_features_enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    commercialEnabled = Boolean(
      (ts as { commercial_features_enabled?: boolean } | null)?.commercial_features_enabled,
    )
  }

  const { data: scopeRows } = await supabase
    .from('contract_scopes')
    .select('id, financial_year, scope_item, is_included, notes, sites(name)')
    .eq('customer_id', customerId)
    .order('financial_year', { ascending: false })
    .order('is_included', { ascending: false })
    .order('scope_item')

  type Row = {
    id: string
    financial_year: string
    scope_item: string
    is_included: boolean
    notes: string | null
    sites: { name: string } | { name: string }[] | null
  }
  const rows = (scopeRows ?? []) as Row[]

  if (rows.length === 0) {
    return (
      <Card>
        <div className="text-center py-12">
          <Scale className="w-10 h-10 text-eq-grey mx-auto mb-2" />
          <p className="text-sm font-medium text-eq-ink">No scope items recorded</p>
          <p className="text-sm text-eq-grey mt-1">When your contract scope is loaded it'll appear here grouped by financial year.</p>
        </div>
      </Card>
    )
  }

  // Group by FY.
  const grouped = new Map<string, Row[]>()
  for (const r of rows) {
    if (!grouped.has(r.financial_year)) grouped.set(r.financial_year, [])
    grouped.get(r.financial_year)!.push(r)
  }
  const groups = Array.from(grouped.entries())

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-eq-ink">Contracted scope</h1>
        <p className="text-sm text-eq-grey mt-1">
          What's included and excluded from your maintenance contract per period.
          For a sealed PDF version, request a Scope Statement from your account manager.
        </p>
      </div>

      {groups.map(([fy, fyRows]) => {
        const included = fyRows.filter(r => r.is_included)
        const excluded = fyRows.filter(r => !r.is_included)
        return (
          <div key={fy} className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-base font-bold text-eq-deep">{fyLabel(fy)}</h2>
              <div className="flex items-center gap-3">
                <p className="text-xs text-eq-grey">
                  <span className="text-green-700">{included.length} included</span>
                  <span className="mx-2">·</span>
                  <span className="text-red-600">{excluded.length} excluded</span>
                </p>
                {commercialEnabled && <ScopeDownloadButton fy={fy} />}
              </div>
            </div>
            <Card>
              <div className="divide-y divide-gray-100">
                {fyRows.map(r => {
                  const siteName = Array.isArray(r.sites) ? r.sites[0]?.name : r.sites?.name
                  return (
                    <div key={r.id} className="flex items-start gap-3 px-2 py-2.5">
                      <div className="mt-0.5 shrink-0">
                        {r.is_included ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-eq-ink">{r.scope_item}</span>
                          {siteName && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-eq-grey">{siteName}</span>
                          )}
                        </div>
                        {r.notes && <p className="text-xs text-eq-grey mt-0.5">{r.notes}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        )
      })}
    </div>
  )
}
