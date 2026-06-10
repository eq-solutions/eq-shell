import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { requireUser } from '@/lib/actions/auth'
import { createClient } from '@/lib/supabase/server'
import { UserSettingsForm } from './UserSettingsForm'
import { NotificationPreferencesForm } from './NotificationPreferencesForm'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const { user, role, tenantId } = await requireUser()
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, last_login_at, created_at')
    .eq('id', user.id)
    .maybeSingle()

  // Resolve effective notification prefs via the cascade RPC. Also fetch
  // the user's own row separately so the form knows whether the user has
  // customised yet (drives the "tenant default" hint badge).
  const [prefsRpc, ownRow] = await Promise.all([
    supabase.rpc('get_effective_notification_prefs', { p_tenant_id: tenantId, p_user_id: user.id }),
    supabase
      .from('notification_preferences')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .maybeSingle(),
  ])
  type PrefsRow = {
    digest_time: string
    digest_days: string[]
    pre_due_reminder_days: number[]
    event_type_opt_outs: string[]
    bell_enabled: boolean
    email_enabled: boolean
    digest_enabled: boolean
    timezone: string
  }
  const effective = (prefsRpc.data ?? [])[0] as PrefsRow | undefined
  const initialPrefs: PrefsRow = effective ?? {
    digest_time: '07:00:00',
    digest_days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    pre_due_reminder_days: [14, 7, 1],
    event_type_opt_outs: [],
    bell_enabled: true,
    email_enabled: true,
    digest_enabled: true,
    timezone: 'Australia/Sydney',
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Settings' }]} />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Settings</h1>
        <p className="text-sm text-eq-grey mt-1">Manage your profile and notification preferences.</p>
      </div>

      <UserSettingsForm
        email={user.email ?? ''}
        fullName={profile?.full_name ?? ''}
        role={role}
        lastLogin={profile?.last_login_at ?? null}
        createdAt={profile?.created_at ?? ''}
      />

      <NotificationPreferencesForm
        initial={initialPrefs}
        hasOwnRow={Boolean(ownRow.data)}
      />
    </div>
  )
}
