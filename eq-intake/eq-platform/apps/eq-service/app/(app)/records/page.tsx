/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * Records hub. Lands at /records and surfaces the five record-type
 * registers as a card grid: Customers · Sites · Contacts · Assets ·
 * Maintenance Plans. Replaces the flat 5-entry "Data" section that lived in
 * the sidebar.
 *
 * Always-on core — none of these are togglable. Once a tenant is set
 * up, these surfaces get touched rarely (Maintenance Plans especially), so
 * collapsing them behind one hub click is a fair trade for the
 * sidebar real estate.
 *
 * Each underlying URL (e.g. /customers) stays valid — no redirects,
 * no breaking changes. Direct bookmarks work as before.
 */
import Link from 'next/link'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Building2, MapPin, Contact2, Package, FileCheck } from 'lucide-react'

export const dynamic = 'force-dynamic'

type RecordCard = {
  label: string
  href: string
  description: string
  icon: typeof Building2
}

const RECORD_CARDS: RecordCard[] = [
  {
    label: 'Customers',
    href: '/customers',
    description: 'Customer accounts — branding, contacts, contract scope summary.',
    icon: Building2,
  },
  {
    label: 'Sites',
    href: '/sites',
    description: 'Per-customer sites with location, access notes, and asset rollup.',
    icon: MapPin,
  },
  {
    label: 'Contacts',
    href: '/contacts',
    description: 'People associated with customers — site reps, after-hours, decision-makers.',
    icon: Contact2,
  },
  {
    label: 'Assets',
    href: '/assets',
    description: 'Every breaker, board, generator, and serviceable item under maintenance.',
    icon: Package,
  },
  {
    label: 'Maintenance Plans',
    href: '/job-plans',
    description: 'Maintenance task templates — frequency, items, customer or site scope.',
    icon: FileCheck,
  },
]

export default function RecordsHubPage() {
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Records' }]} />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Records</h1>
        <p className="text-sm text-eq-grey mt-1">
          The reference data — customers, sites, the people, the kit, and the maintenance plans that bind them.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {RECORD_CARDS.map(({ label, href, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col gap-2 p-5 bg-white border border-eq-line rounded-xl hover:border-eq-sky transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-eq-ice flex items-center justify-center text-eq-deep group-hover:bg-eq-sky group-hover:text-white transition-colors">
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-sm font-semibold text-eq-ink">{label}</span>
            </div>
            <p className="text-xs text-eq-grey">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
