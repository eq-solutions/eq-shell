import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { VariationsList } from './VariationsList'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import type { Role, ContractVariation, Customer, Site } from '@/lib/types'

/**
 * Variations register — Phase 4 of the contract-scope bridge plan.
 *
 * Surfaced only when the tenant has commercial_features_enabled. If a user
 * navigates here on a free-tier tenant we redirect to /contract-scope with
 * an explanatory query so the surface area stays consistent.
 */
export default async function VariationsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('role, tenant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  const userRole = (membership?.role as Role) ?? null
  const tenantId = (membership?.tenant_id as string | undefined) ?? null

  // Read the commercial-features flag — variations is gated on it.
  const { data: settings } = tenantId
    ? await supabase
        .from('tenant_settings')
        .select('commercial_features_enabled')
        .eq('tenant_id', tenantId)
        .maybeSingle()
    : { data: null }
  const commercialEnabled = Boolean(
    (settings as { commercial_features_enabled?: boolean } | null)?.commercial_features_enabled,
  )

  // Variations + dropdowns. We always read the data (so the redirect is
  // graceful on a downgrade), but the table renders a gating banner when
  // the flag is off.
  const [variationsRes, customersRes, sitesRes] = await Promise.all([
    supabase
      .from('contract_variations')
      .select('*, customers(name), sites(name)')
      .order('created_at', { ascending: false }),
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('sites').select('id, name, customer_id').eq('is_active', true).order('name'),
  ])

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Variations' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Variations Register</h1>
        <p className="text-sm text-eq-grey mt-1">
          Out-of-scope work captured against the customer contract. Lifecycle:
          draft → quoted → approved → billed.
        </p>
      </div>
      <VariationsList
        items={(variationsRes.data ?? []) as (ContractVariation & {
          customers: { name: string } | null
          sites: { name: string } | null
        })[]}
        customers={customersRes.data ?? []}
        sites={(sitesRes.data ?? []) as Pick<Site, 'id' | 'name' | 'customer_id'>[]}
        canWrite={canWrite(userRole)}
        isAdmin={isAdmin(userRole)}
        commercialEnabled={commercialEnabled}
      />
    </div>
  )
}
