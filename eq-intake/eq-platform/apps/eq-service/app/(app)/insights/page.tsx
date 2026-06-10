/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * Insight hub. Lands at /insights and surfaces the reporting,
 * analytics, and contract-context surfaces as a card grid:
 *
 *   Reports                — always-on, customer-facing PDF outputs.
 *   Analytics              — gated on tenant_settings.analytics_enabled.
 *   Contract Scope         — gated on tenant_settings.contract_scope_enabled.
 *   Variations             — gated on tenant_settings.commercial_features_enabled.
 *   Commercials            — gated on tenant_settings.commercial_features_enabled.
 *
 * Replaces the flat 3-5 entry "Insight" section that lived in the
 * sidebar. Each underlying URL (e.g. /reports) stays valid — no
 * redirects, no breaking changes. Direct bookmarks work as before.
 *
 * Module flags from migration 0097; commercial_features_enabled from
 * migration 0085.
 */
import Link from 'next/link'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { FileText, BarChart3, Scale, FileSignature, Briefcase } from 'lucide-react'
import { getTenantSettings } from '@/lib/tenant/getTenantSettings'

export const dynamic = 'force-dynamic'

type InsightCard = {
  label: string
  href: string
  description: string
  icon: typeof FileText
}

export default async function InsightHubPage() {
  const { settings } = await getTenantSettings()
  const commercialEnabled = Boolean(settings.commercial_features_enabled)
  const analyticsEnabled = settings.analytics_enabled ?? true
  const contractScopeEnabled = settings.contract_scope_enabled ?? true

  const cards: InsightCard[] = []

  cards.push({
    label: 'Reports',
    href: '/reports',
    description: 'Compliance dashboard, customer-facing PDFs, sign-off bundles.',
    icon: FileText,
  })

  if (analyticsEnabled) {
    cards.push({
      label: 'Analytics',
      href: '/analytics',
      description: 'Cross-cutting trends — throughput, completion rates, defect rates.',
      icon: BarChart3,
    })
  }

  if (contractScopeEnabled) {
    cards.push({
      label: 'Contract Scope',
      href: '/contract-scope',
      description: 'Per-customer scope register — included / excluded items by FY.',
      icon: Scale,
    })
  }

  if (commercialEnabled) {
    cards.push({
      label: 'Variations',
      href: '/variations',
      description: 'Register of out-of-scope work raised against contract scopes.',
      icon: FileSignature,
    })
    cards.push({
      label: 'Commercials',
      href: '/commercials',
      description: 'Renewal packs, commercial-sheet imports, scope-from-work derivation.',
      icon: Briefcase,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Insight' }]} />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Insight</h1>
        <p className="text-sm text-eq-grey mt-1">
          What happened, what&rsquo;s contracted, what the numbers say.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(({ label, href, description, icon: Icon }) => (
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
