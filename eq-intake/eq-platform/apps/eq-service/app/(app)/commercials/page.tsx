/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * Commercials hub. Lands at /commercials and surfaces the three
 * commercial workflow tools as a card grid: Renewal Pack · Import
 * Commercial Sheet · Build Scope from Work.
 *
 * Promoted out of the Admin block (where they hid behind the same
 * sidebar dropdown as Users / Settings) into their own top-level
 * area. Sidebar entry is gated on tenant_settings.commercial_features_enabled
 * so free-tier tenants don't see it. The hub page itself loads for
 * anyone signed in — the underlying actions still gate role.
 */
import Link from 'next/link'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { FileText, FileSpreadsheet, Wand2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

type CommercialCard = {
  label: string
  href: string
  description: string
  icon: typeof FileText
}

const COMMERCIAL_CARDS: CommercialCard[] = [
  {
    label: 'Renewal Pack',
    href: '/commercials/renewal-pack',
    description: 'Build the FY renewal bundle — pricing, scope, sign-off package.',
    icon: FileText,
  },
  {
    label: 'Import Commercial Sheet',
    href: '/commercials/contract-scopes/import',
    description: 'Ingest the customer commercial xlsx — scope, exclusions, pricing.',
    icon: FileSpreadsheet,
  },
  {
    label: 'Build Scope from Work',
    href: '/commercials/contract-scopes/derive',
    description: 'Derive contract scope from completed maintenance + variations.',
    icon: Wand2,
  },
]

export default function CommercialsHubPage() {
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Commercials' }]} />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Commercials</h1>
        <p className="text-sm text-eq-grey mt-1">
          Renewal packs, commercial scope imports, and scope-from-work derivation.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {COMMERCIAL_CARDS.map(({ label, href, description, icon: Icon }) => (
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
