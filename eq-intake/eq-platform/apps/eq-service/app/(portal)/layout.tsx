/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */
import '@/app/globals.css'
import { EqFooter } from '@/components/ui/EqFooter'
import { createClient } from '@/lib/supabase/server'
import { PortalNav } from './PortalNav'

/**
 * Portal layout — separate from the main app layout.
 * No sidebar, no app-level auth (uses portal magic-link), no tenant theming.
 *
 * Resolves the portal user's customer + tenant via the
 * `get_portal_customer_id()` / `get_portal_tenant_id()` SQL helpers
 * (migration 0090). Surfaces customer name in the masthead and gates
 * the Variations nav tab on tenant.commercial_features_enabled.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Resolve the portal user's customer + commercial flag (best-effort).
  // Login page renders inside this layout too, so missing user is fine.
  let customerName: string | null = null
  let commercialEnabled = false
  let signedIn = false
  if (user?.email) {
    signedIn = true
    const [{ data: customerRow }, { data: tsRow }] = await Promise.all([
      supabase
        .from('customer_contacts')
        .select('customers(name)')
        .ilike('email', user.email)
        .limit(1)
        .maybeSingle(),
      supabase
        .rpc('get_portal_tenant_id')
        .then(async (tenantRpc) => {
          const tenantId = (tenantRpc.data as string | null) ?? null
          if (!tenantId) return { data: null }
          return supabase
            .from('tenant_settings')
            .select('commercial_features_enabled')
            .eq('tenant_id', tenantId)
            .maybeSingle()
        }),
    ])
    const cust = customerRow as { customers?: { name?: string } | { name?: string }[] | null } | null
    const c = Array.isArray(cust?.customers) ? cust?.customers?.[0] : cust?.customers
    customerName = c?.name ?? null
    commercialEnabled = Boolean(
      (tsRow as { commercial_features_enabled?: boolean } | null)?.commercial_features_enabled,
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Masthead */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-eq-sky flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-sm">EQ</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-eq-ink truncate">
                {customerName ? `${customerName} — Customer Portal` : 'Customer Portal'}
              </p>
              {user?.email && (
                <p className="text-xs text-eq-grey truncate">{user.email}</p>
              )}
            </div>
          </div>
          {signedIn && (
            <form action="/api/portal/signout" method="POST">
              <button
                type="submit"
                className="text-xs text-eq-grey hover:text-eq-ink whitespace-nowrap"
              >
                Sign out
              </button>
            </form>
          )}
        </div>
      </header>
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-6">
        {signedIn && <PortalNav showVariations={commercialEnabled} />}
        {children}
      </main>
      <EqFooter />
    </div>
  )
}
