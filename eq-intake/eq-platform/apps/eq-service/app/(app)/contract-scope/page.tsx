import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { ContractScopeList } from './ContractScopeList'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role, ContractScope, Site } from '@/lib/types'

export default async function ContractScopePage() {
  const supabase = await createClient()

  // Get current user role + tenant id
  const { data: { user } } = await supabase.auth.getUser()
  let userRole: Role | null = null
  let tenantId: string | null = null
  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role, tenant_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    userRole = (membership?.role as Role) ?? null
    tenantId = (membership?.tenant_id as string) ?? null
  }

  // Fetch scope items + dropdowns + the commercial-features flag in
  // parallel. The flag controls whether the lock/unlock/archive controls
  // and locked-row enforcement are surfaced (Phase 5, migration 0085).
  const [itemsRes, customersRes, sitesRes, settingsRes] = await Promise.all([
    supabase
      .from('contract_scopes')
      .select('*, customers(name), sites(name)')
      .order('financial_year', { ascending: false })
      .order('scope_item'),
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('sites').select('id, name, customer_id').eq('is_active', true).order('name'),
    tenantId
      ? supabase
          .from('tenant_settings')
          .select('commercial_features_enabled')
          .eq('tenant_id', tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const commercialEnabled = Boolean((settingsRes.data as { commercial_features_enabled?: boolean } | null)?.commercial_features_enabled)

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Contract Scope' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Contract Scope</h1>
        <p className="text-sm text-eq-grey mt-1">Define what work is included or excluded from each customer contract per financial year.</p>
      </div>
      <ContractScopeList
        items={(itemsRes.data ?? []) as (ContractScope & { customers: { name: string } | null; sites: { name: string } | null })[]}
        customers={customersRes.data ?? []}
        sites={(sitesRes.data ?? []) as Pick<Site, 'id' | 'name' | 'customer_id'>[]}
        canWrite={canWrite(userRole)}
        isAdmin={isAdmin(userRole)}
        commercialEnabled={commercialEnabled}
      />
    </div>
  )
}
