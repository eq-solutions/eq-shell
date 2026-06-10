import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Button } from '@/components/ui/Button'
import { isAdmin } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'
import { updateGracePeriodAction } from '../actions'

export const dynamic = 'force-dynamic'

const OPTIONS: Array<{ days: 30 | 60 | 90; blurb: string }> = [
  { days: 30, blurb: 'Default. Archived items disappear one month after you deactivate them.' },
  { days: 60, blurb: 'Two months of recovery window — good if you review the archive less often.' },
  { days: 90, blurb: 'Maximum. Three months before auto-delete runs.' },
]

export default async function ArchiveSettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  const { data: membership } = await supabase
    .from('tenant_members')
    .select('role, tenant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const userRole = (membership?.role as Role | undefined) ?? null
  if (!isAdmin(userRole)) redirect('/dashboard')

  const { data: settings } = await supabase
    .from('tenant_settings')
    .select('archive_grace_period_days')
    .eq('tenant_id', membership!.tenant_id)
    .maybeSingle()

  const currentDays = (settings?.archive_grace_period_days ?? 30) as 30 | 60 | 90

  async function handleSave(formData: FormData) {
    'use server'
    await updateGracePeriodAction(formData)
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Admin', href: '/admin' },
          { label: 'Archive', href: '/admin/archive' },
          { label: 'Grace period' },
        ]} />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Archive grace period</h1>
        <p className="text-sm text-eq-grey mt-1">
          Controls how long soft-deleted items stay in the archive before they&rsquo;re permanently removed
          by the nightly cleanup job. You can still restore or permanently delete anything manually at any
          time from the <Link href="/admin/archive" className="font-semibold text-eq-deep hover:text-eq-sky">Archive page</Link>.
        </p>
      </div>

      <Card>
        <form action={handleSave} className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {OPTIONS.map((opt) => {
              const selected = opt.days === currentDays
              return (
                <label
                  key={opt.days}
                  className={
                    'flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ' +
                    (selected
                      ? 'border-eq-sky bg-eq-ice/30'
                      : 'border-gray-200 hover:border-eq-sky/50 hover:bg-gray-50')
                  }
                >
                  <input
                    type="radio"
                    name="days"
                    value={opt.days}
                    defaultChecked={selected}
                    className="mt-1 accent-eq-sky"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-eq-ink">{opt.days} days</div>
                    <div className="text-xs text-eq-grey mt-0.5">{opt.blurb}</div>
                  </div>
                </label>
              )
            })}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <p className="text-xs text-eq-grey">
              Current: <span className="font-semibold text-eq-ink">{currentDays} days</span>
            </p>
            <div className="flex items-center gap-2">
              <Link
                href="/admin/archive"
                className="text-xs font-semibold text-eq-grey hover:text-eq-ink transition-colors"
              >
                Cancel
              </Link>
              <Button type="submit" size="sm">Save</Button>
            </div>
          </div>
        </form>
      </Card>

      <Card className="bg-gray-50 border-gray-200">
        <h3 className="text-sm font-bold text-eq-ink">How it works</h3>
        <ul className="mt-2 space-y-1.5 text-xs text-eq-grey list-disc pl-4">
          <li>When you deactivate a customer, site, asset, maintenance plan or check, its countdown starts from that moment.</li>
          <li>Every night at 2am AEST a cleanup job permanently removes anything past its grace window.</li>
          <li>The job deletes children before parents and skips rows that still have dependencies — they&rsquo;ll be caught on a later run.</li>
          <li>Changing the grace period here affects future countdowns <em>and</em> anything still in the archive — a shorter window will make old items disappear sooner.</li>
          <li>Items archived before this feature was enabled have no countdown and will never be auto-deleted — only manual deletion removes them.</li>
        </ul>
      </Card>
    </div>
  )
}
