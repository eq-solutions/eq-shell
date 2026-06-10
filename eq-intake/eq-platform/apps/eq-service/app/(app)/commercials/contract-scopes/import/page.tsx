import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { isAdmin as checkIsAdmin } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'
import { CommercialSheetImporter } from './CommercialSheetImporter'

/**
 * Admin page for re-importing a customer's contract data from a DELTA ELCOM
 * commercial-sheet xlsx (per-site Equinix AU SMCA workbook).
 *
 * Replaces the hand-curated Python bootstrap loaders with an in-app flow:
 *   upload .xlsx -> parse + preview -> pick customer/site/year ->
 *   typed-name confirm -> wipe-and-insert in one tx.
 *
 * Admin role required at the route level — the same check fires inside the
 * server actions, but the route guard avoids rendering the form to anyone
 * without permission.
 */
export default async function ContractScopesImportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const role = (membership?.role as Role) ?? null
  const userIsAdmin = checkIsAdmin(role)

  if (!userIsAdmin) {
    return (
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Commercials', href: '/commercials' },
            { label: 'Import Commercial Sheet' },
          ]}
        />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Import Commercial Sheet</h1>
        <p className="text-sm text-eq-grey">
          Admin role required. Ask a super admin or admin to run this import.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Commercials', href: '/commercials' },
            { label: 'Import Commercial Sheet' },
          ]}
        />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Import Commercial Sheet</h1>
        <p className="text-sm text-eq-grey mt-1">
          Upload a per-site Equinix AU SMCA commercial-sheet workbook
          (<code>DELTA ELCOM_&lt;SITE&gt; Elec Maintenance_Commercial Sheet JPs &lt;date&gt;.xlsx</code>),
          preview the parsed contract scopes, and commit. Optionally wipe
          existing contract data for the chosen customer + year before
          inserting — used for the wipe-and-reimport flow.
        </p>
      </div>
      <CommercialSheetImporter />
    </div>
  )
}
