import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { CheckDetailPage } from './CheckDetailPage'
import { LinkedTestsPanel } from './LinkedTestsPanel'
import { ContractScopeBanner } from '@/components/ui/ContractScopeBanner'
import { isAdmin, canWrite } from '@/lib/utils/roles'
import { notFound } from 'next/navigation'
import type { Role, MaintenanceCheckItem, Attachment } from '@/lib/types'

export default async function MaintenanceCheckPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // Get current user + role
  const { data: { user } } = await supabase.auth.getUser()
  let userRole: Role | null = null
  if (user) {
    const { data: membership } = await supabase
      .from('tenant_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    userRole = (membership?.role as Role) ?? null
  }

  // Fetch the maintenance check
  const { data: check, error } = await supabase
    .from('maintenance_checks')
    .select('*, job_plans(name), sites(name)')
    .eq('id', id)
    .maybeSingle()

  if (error || !check) notFound()

  // Resolve assignee name
  let assigneeName: string | null = null
  if (check.assigned_to) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', check.assigned_to)
      .maybeSingle()
    assigneeName = profile?.full_name ?? profile?.email ?? null
  }

  // Fetch check_assets with asset details
  const { data: checkAssets } = await supabase
    .from('check_assets')
    .select('*, assets(name, maximo_id, location, job_plans(name))')
    .eq('check_id', id)
    .order('created_at')

  // Fetch all check items (Supabase defaults to 1000 rows — lift the cap)
  const { data: allItems } = await supabase
    .from('maintenance_check_items')
    .select('*')
    .eq('check_id', id)
    .order('sort_order')
    .limit(10000)

  // Fetch attachments
  const { data: attachments } = await supabase
    .from('attachments')
    .select('*')
    .eq('entity_type', 'maintenance_check')
    .eq('entity_id', id)
    .order('created_at')

  const checkName = check.custom_name ?? (check.job_plans as { name: string } | null)?.name ?? 'Maintenance Check'

  // Status-driven page accent (2026-04-28 chrome polish). A hairline
  // colour bar at the top of the page so the eye registers the check's
  // health before reading the body. Subtle — doesn't dominate the page.
  const statusAccent =
    check.status === 'complete'    ? 'bg-green-500'  :
    check.status === 'overdue'     ? 'bg-red-500'    :
    check.status === 'in_progress' ? 'bg-amber-500'  :
    check.status === 'cancelled'   ? 'bg-gray-400'   :
                                     'bg-eq-sky'

  return (
    <div className="space-y-4">
      <div className={`-mx-4 lg:-mx-8 -mt-4 lg:-mt-8 mb-2 h-1 ${statusAccent}`} aria-hidden />
      <div>
        <Breadcrumb items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Maintenance', href: '/maintenance' },
          { label: checkName },
        ]} />
        <h1 className="text-3xl font-bold text-eq-ink mt-3 tracking-tight">{checkName}</h1>
        <p className="text-sm text-eq-grey mt-1">
          {(check.sites as { name: string } | null)?.name ?? '—'}
          {check.frequency && <span> · {(check.frequency as string).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>}
          {check.due_date && <span> · Due {new Date(check.due_date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
        </p>
        {/* Kind-aware tagline — tells the tech which workflow they're about
            to work in so they can pre-empt the asset-table vs linked-tests
            split (UX audit PR #149 §2.15 / §B.15). */}
        {(() => {
          const kind = (check as { kind?: string | null }).kind ?? 'maintenance'
          const tagline =
            kind === 'maintenance' ? 'PPM check — work through the asset table.' :
            kind === 'acb'         ? 'ACB test — open each linked test below to run the 3-step workflow.' :
            kind === 'nsx'         ? 'NSX test — open each linked test below to run the 3-step workflow.' :
            kind === 'rcd'         ? 'RCD test — open each linked test below to record per-circuit timing.' :
            kind === 'general'     ? 'General test — fill in the test record.' :
            null
          return tagline ? (
            <p className="text-xs text-eq-deep mt-1 italic">{tagline}</p>
          ) : null
        })()}
      </div>
      {/* Contract scope context — shown above the detail body so site teams
          see what's in/out of scope before they pick assets to inspect.
          Phase 2 of Royce's 26-Apr review. */}
      <ContractScopeBanner
        siteId={check.site_id as string | null}
        jobPlanId={check.job_plan_id as string | null}
        hideWhenEmpty
      />
      {/* Phase 3 of the Testing simplification — surface linked ACB/NSX/RCD
          tests inline so the user doesn't have to hunt across tabs. Renders
          nothing when no tests are linked (most kind=maintenance checks). */}
      <LinkedTestsPanel
        checkId={id}
        siteId={check.site_id as string | null}
      />
      <CheckDetailPage
        check={{ ...check, assignee_name: assigneeName } as never}
        items={(allItems ?? []) as MaintenanceCheckItem[]}
        checkAssets={(checkAssets ?? []) as never}
        attachments={(attachments ?? []) as Attachment[]}
        isAdmin={isAdmin(userRole)}
        canWrite={canWrite(userRole)}
        isAssigned={check.assigned_to === user?.id}
        isTechnician={userRole === 'technician'}
      />
    </div>
  )
}
