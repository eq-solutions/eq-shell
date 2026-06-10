import { getTenantSettings } from '@/lib/tenant/getTenantSettings'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { TenantSettingsForm } from './TenantSettingsForm'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const { settings } = await getTenantSettings()

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Admin', href: '/admin' }, { label: 'Workspace Settings' }]} />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Workspace Settings</h1>
        <p className="text-sm text-eq-grey mt-1">
          Branding, colours, and how the app behaves for your team.
        </p>
      </div>

      <TenantSettingsForm settings={settings} />
    </div>
  )
}
