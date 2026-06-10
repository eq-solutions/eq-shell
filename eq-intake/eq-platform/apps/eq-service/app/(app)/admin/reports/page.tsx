import { getTenantSettings } from '@/lib/tenant/getTenantSettings'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { ReportSettingsForm } from './ReportSettingsForm'

export const dynamic = 'force-dynamic'

export default async function ReportSettingsPage() {
  const { settings } = await getTenantSettings()

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Admin', href: '/admin' }, { label: 'Report Settings' }]} />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Report Settings</h1>
        <p className="text-sm text-eq-grey mt-1">
          Customise the layout, sections, and company details that appear on generated PM reports.
        </p>
      </div>

      <ReportSettingsForm settings={settings} />
    </div>
  )
}
