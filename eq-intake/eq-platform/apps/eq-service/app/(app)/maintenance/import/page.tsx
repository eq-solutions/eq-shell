import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { createClient } from '@/lib/supabase/server'
import { canWrite } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'
import { ImportWizard } from './ImportWizard'
import { redirect } from 'next/navigation'

/**
 * Delta / Equinix Maximo work-order import page.
 *
 * Writer-role guard runs here so non-writers never see the wizard. The
 * actual parse/preview/commit logic lives in `./actions.ts` and
 * `./ImportWizard.tsx`.
 */
export default async function MaintenanceImportPage() {
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
  if (!canWrite(role)) {
    return (
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Maintenance', href: '/maintenance' },
            { label: 'Import' },
          ]}
        />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Import Maintenance Checks</h1>
        <p className="text-sm text-eq-grey">
          Your role does not have permission to import work orders. Ask an admin or supervisor.
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
            { label: 'Maintenance', href: '/maintenance' },
            { label: 'Import' },
          ]}
        />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Import Maintenance Checks</h1>
        <p className="text-sm text-eq-grey mt-1">
          Upload the monthly Equinix Maximo <strong>Delta</strong> work-order spreadsheet
          (<code>.xlsx</code>). Each group of rows becomes one maintenance check, with work-order
          numbers attached to each asset.
        </p>
      </div>
      <ImportWizard />
    </div>
  )
}
