/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * /admin/tidy — "Tidy Our Data"
 *
 * Scans all canonical records for normalisation opportunities (phones → E.164,
 * states → abbreviation, emails → lowercase, ABNs → valid format), required
 * field gaps, and broken FK relationships.
 *
 * Admin-only. The actual scan + commit runs via server actions in actions.ts.
 * This page is a thin server component shell — the interactive logic lives in
 * TidyClient.
 */

import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Card } from '@/components/ui/Card'
import { requireUser } from '@/lib/auth/requireUser'
import { isAdmin } from '@/lib/utils/roles'
import { redirect } from 'next/navigation'
import { TidyClient } from './TidyClient'
import { Sparkles } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function TidyPage() {
  const { role } = await requireUser()

  if (!isAdmin(role)) {
    redirect('/admin')
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[
          { label: 'Home',  href: '/dashboard' },
          { label: 'Admin', href: '/admin' },
          { label: 'Tidy Our Data' },
        ]} />
        <div className="flex items-center gap-3 mt-2">
          <div className="w-9 h-9 rounded-md bg-eq-ice flex items-center justify-center text-eq-deep">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-eq-ink">Tidy Our Data</h1>
            <p className="text-sm text-eq-grey mt-0.5">
              Auto-fix normalisation issues, surface gaps, and check for orphaned records.
            </p>
          </div>
        </div>
      </div>

      {/* What this does */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        {[
          {
            title:  'Normalise',
            colour: 'border-eq-sky/30 bg-eq-ice/60',
            items:  ['Phones → E.164 (+61…)', 'States → NSW / VIC…', 'Emails → lowercase', 'ABNs → valid format'],
          },
          {
            title:  'Gap audit',
            colour: 'border-amber-200 bg-amber-50/60',
            items:  ['Missing required fields', 'Invalid formats', 'Unresolved FK references'],
          },
          {
            title:  'Orphan check',
            colour: 'border-rose-200 bg-rose-50/60',
            items:  ['Assets with no site', 'Contacts with no parent', 'Licences with no staff', 'Sites with no customer'],
          },
        ].map((section) => (
          <div key={section.title} className={`rounded-xl border p-4 ${section.colour}`}>
            <div className="text-[10px] uppercase tracking-wider text-eq-grey mb-2 font-semibold">
              {section.title}
            </div>
            <ul className="space-y-1">
              {section.items.map((item) => (
                <li key={item} className="text-xs text-eq-ink flex items-start gap-1.5">
                  <span className="text-eq-deep mt-0.5">·</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Interactive tidy UI */}
      <Card>
        <div className="p-5">
          <TidyClient />
        </div>
      </Card>
    </div>
  )
}
