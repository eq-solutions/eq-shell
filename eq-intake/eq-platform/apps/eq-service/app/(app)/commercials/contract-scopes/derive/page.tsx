import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { isAdmin as checkIsAdmin } from '@/lib/utils/roles'
import type { Role } from '@/lib/types'
import { DerivedScopeWizard } from './DerivedScopeWizard'

/**
 * Build-scope-from-work tool. Pick a customer that has assets + check
 * history but no contract_scopes, and produce a draft contract scope
 * inferred from what we've actually delivered for them.
 *
 * Operator-facing copy avoids "derive" (technical jargon) — the user
 * sees "Build Scope from Work". URL keeps /derive for code clarity.
 *
 * Output shape mirrors the structured contract_scopes the importer
 * writes — so once committed (operator review → flip period_status
 * to 'committed') the same downstream flows (CPI escalation, reports,
 * coverage gaps) apply automatically.
 */
export default async function DeriveContractScopePage() {
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
  if (!checkIsAdmin(role)) {
    return (
      <div className="space-y-6">
        <Breadcrumb
          items={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Commercials', href: '/commercials' },
            { label: 'Build Scope from Work' },
          ]}
        />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Build Contract Scope from Delivered Work</h1>
        <p className="text-sm text-eq-grey">
          Admin role required. Ask a super_admin or admin to build the draft scope.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Commercials', href: '/commercials' },
            { label: 'Build Scope from Work' },
          ]}
        />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Build Contract Scope from Delivered Work</h1>
        <p className="text-sm text-eq-grey mt-1">
          For customers without a formal commercial sheet. Pick a customer
          and we'll look at their assets + the maintenance checks SKS has
          actually delivered, then build a likely contract scope (frequency
          × labour × cost) as a <span className="font-semibold">draft</span>{' '}
          for review. Use it as the starting point for a Statement of Work
          back to the customer, or as the seed of next year's commercial
          sheet for them.
        </p>
        <p className="text-xs text-eq-grey mt-2">
          Best for relationships SKS picked up ad-hoc and never wrote down —
          turns historical work into structured scope rows so the same
          downstream flows (CPI, reports, coverage gaps) apply.
        </p>
      </div>
      <DerivedScopeWizard />
    </div>
  )
}
