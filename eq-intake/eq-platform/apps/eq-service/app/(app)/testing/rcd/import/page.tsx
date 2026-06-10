import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { createClient } from '@/lib/supabase/server'
import { canWrite } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'
import { redirect } from 'next/navigation'
import { RcdImportWizard } from './RcdImportWizard'

/**
 * Jemena RCD xlsx import page.
 *
 * Writer-role guard runs server-side. Wizard logic lives in
 * RcdImportWizard.tsx, server actions in ./actions.ts.
 */
export default async function RcdImportPage() {
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
            { label: 'Testing', href: '/testing' },
            { label: 'RCD Testing', href: '/testing/rcd' },
            { label: 'Import' },
          ]}
        />
        <h2 className="text-3xl font-bold text-eq-sky">Import RCD Tests</h2>
        <p className="text-sm text-eq-grey">
          You don&apos;t have permission to import RCD test data. Ask an admin to
          upload on your behalf, or request a writer role.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Testing', href: '/testing' },
          { label: 'RCD Testing', href: '/testing/rcd' },
          { label: 'Import' },
        ]}
      />
      <div>
        <h2 className="text-3xl font-bold text-eq-sky">Import RCD Tests</h2>
        <p className="text-sm text-eq-grey mt-1">
          Upload a Jemena-format multi-tab RCD test workbook. Each sheet maps to
          one board, each row maps to one circuit. Site + board are resolved
          automatically by name within the current tenant.
        </p>
      </div>
      <RcdImportWizard />
    </div>
  )
}
