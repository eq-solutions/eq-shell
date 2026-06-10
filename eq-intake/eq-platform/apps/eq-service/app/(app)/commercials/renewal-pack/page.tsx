import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { isAdmin } from '@/lib/utils/roles'
import { RenewalPackForm } from './RenewalPackForm'
import type { Role } from '@/lib/types'
import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'

/**
 * Phase 7 (stretch) — Renewal Pack admin page.
 *
 * Single-purpose: pick a customer + a year, download the year-end pack.
 * Lives under /admin so it's clearly an annual back-office tool, not a
 * day-to-day register.
 *
 * Gated on: admin role (UI), commercial-features flag (action also
 * checks server-side).
 */
export default async function RenewalPackPage() {
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

  if (!isAdmin(userRole)) {
    return (
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Commercials', href: '/commercials' }, { label: 'Renewal Pack' }]} />
        <Card>
          <div className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-eq-grey">
              Renewal-pack generation is restricted to admin users.
            </p>
          </div>
        </Card>
      </div>
    )
  }

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

  if (!commercialEnabled) {
    return (
      <div className="space-y-6">
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Commercials', href: '/commercials' }, { label: 'Renewal Pack' }]} />
        <h1 className="text-3xl font-bold text-eq-sky">Renewal Pack</h1>
        <Card>
          <div className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-eq-ink text-sm">Commercial features off</h3>
              <p className="text-sm text-eq-grey mt-1">
                The renewal-pack generator is part of the commercial-tier feature set.
                Switch it on per tenant from{' '}
                <Link href="/admin/settings" className="text-eq-sky hover:underline">
                  Admin → Settings
                </Link>
                .
              </p>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  // Read customers + the years available in contract_scopes for the
  // year picker. We only show years that actually have data.
  const [customersRes, scopesRes] = await Promise.all([
    supabase.from('customers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('contract_scopes').select('financial_year').order('financial_year', { ascending: false }),
  ])
  const customers = customersRes.data ?? []
  const yearSet = new Set<string>()
  for (const r of (scopesRes.data ?? []) as { financial_year: string }[]) {
    if (r.financial_year) yearSet.add(r.financial_year)
  }
  const years = Array.from(yearSet).sort((a, b) => b.localeCompare(a))

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Commercials', href: '/commercials' }, { label: 'Renewal Pack' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Renewal Pack</h1>
        <p className="text-sm text-eq-grey mt-1">
          Year-end document combining the year in review, delivery summary, variations, and proposed scope for the next period.
        </p>
      </div>
      <RenewalPackForm customers={customers} years={years} />
    </div>
  )
}
