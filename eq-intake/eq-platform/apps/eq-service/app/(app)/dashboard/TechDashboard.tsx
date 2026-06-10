import { Card } from '@/components/ui/Card'
import Link from 'next/link'
import { formatDate } from '@/lib/utils/format'
import { firstRow } from '@/lib/db/relation'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { DashboardAnalytics } from './DashboardAnalytics'
import { TechWelcomeCard } from './TechWelcomeCard'

/**
 * Tech-shaped dashboard.
 *
 * UX audit PR #149 §2.7 + §5.1 (locked 2026-05-18): the regular dashboard
 * buries "My Upcoming Works" at the bottom of the scroll, behind four
 * entity KPI tiles, the Maintenance Overview kanban, defect summary and
 * the site map. For a tech on mobile that's four screens of tenant-wide
 * chrome before their actual work appears.
 *
 * This component flips the priority for `role === 'technician'`:
 *   1. Greeting + overdue alert
 *   2. My Upcoming Works (full width — the daily-driver list)
 *   3. My Recently Completed (full width)
 *   4. My In-Progress Tests (if any)
 *   5. Maintenance Overview status bar (kept — gives the tech a sense of
 *      their own status mix)
 *
 * Deliberately hidden for techs:
 *   - Entity KPI tiles (Sites/Assets/Maintenance Plans/Customers) — admin concerns
 *   - Defect Summary card — supervisor concern
 *   - Site Map — supervisor concern, slow to render on phones
 *   - Service-credit widget — commercial-tier admin concern
 *
 * Receives data already fetched by dashboard/page.tsx; renders only.
 * The page decides which component to mount based on role — see
 * dashboard/page.tsx's role gate.
 */

type CheckRow = {
  id: string
  custom_name: string | null
  status: string
  due_date?: string
  completed_at?: string
  sites: unknown
}

type TestRow = {
  id: string
  test_date: string
  overall_result: string
  assets: { name: string } | { name: string }[] | null
  sites: { name: string } | { name: string }[] | null
}

export interface TechDashboardProps {
  userName: string
  /** Greeting word — "morning" / "afternoon" / "evening". Page computes this. */
  greeting: string
  upcomingChecks: CheckRow[]
  recentChecks: CheckRow[]
  myAcbTests: TestRow[]
  myNsxTests: TestRow[]
  /** Site count for the dashboard_viewed analytics event. */
  siteCount: number
  checkCounts: {
    scheduled: number
    inProgress: number
    overdue: number
    complete: number
  }
  /**
   * True iff the user is a technician on this tenant AND
   * `tenant_members.tech_onboarded_at` is null — first session on this
   * tenant. Drives the one-time welcome card above the work list.
   * UX audit PR I §B.6.
   */
  showWelcome?: boolean
  /** First name for the welcome card greeting (optional). */
  firstName?: string | null
}

export function TechDashboard({
  userName,
  greeting,
  upcomingChecks,
  recentChecks,
  myAcbTests,
  myNsxTests,
  siteCount,
  checkCounts,
  showWelcome = false,
  firstName = null,
}: TechDashboardProps) {
  const totalActive = checkCounts.scheduled + checkCounts.inProgress + checkCounts.overdue
  const myTestsTotal = myAcbTests.length + myNsxTests.length
  // Pre-compute the welcome card's "open my first check" CTA target so it
  // jumps straight to the work, not to a list.
  const firstCheckHref = upcomingChecks.length > 0 ? `/maintenance/${upcomingChecks[0].id}` : null

  return (
    <div className="space-y-6">
      {/* Analytics: dashboard_viewed (fires once per mount, client-side) */}
      <DashboardAnalytics siteCount={siteCount} openChecksCount={totalActive} />

      {/* First-login welcome — only when the tenant_members row is freshly
          minted for this tech (PR I, audit §B.6). Dismisses via a stamp on
          tenant_members.tech_onboarded_at. */}
      {showWelcome && (
        <TechWelcomeCard firstName={firstName} firstCheckHref={firstCheckHref} />
      )}

      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-eq-ink">Good {greeting}, {userName}</h1>
        <p className="text-sm text-eq-grey mt-1">
          {totalActive > 0
            ? `You have ${totalActive} active ${totalActive === 1 ? 'check' : 'checks'} assigned to you.`
            : 'You have no active checks assigned.'
          }
        </p>
      </div>

      {/* Overdue alert — highest priority surface for a tech */}
      {checkCounts.overdue > 0 && (
        <Link href="/maintenance?status=overdue" className="block">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 hover:border-amber-300 transition-colors">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <span className="text-lg" aria-hidden="true">!</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-800">
                {checkCounts.overdue} overdue {checkCounts.overdue === 1 ? 'check' : 'checks'} need your attention
              </p>
              <p className="text-xs text-amber-600 mt-0.5">Tap to view and action overdue maintenance checks</p>
            </div>
            <span className="text-amber-400 text-sm font-medium shrink-0">View &rarr;</span>
          </div>
        </Link>
      )}

      {/* My Upcoming Works — full width, the daily-driver list */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-eq-ink">My Upcoming Works</h2>
          <Link href="/maintenance?status=scheduled" className="text-xs text-eq-sky hover:text-eq-deep font-medium">View all &rarr;</Link>
        </div>
        {upcomingChecks.length === 0 ? (
          <p className="text-sm text-eq-grey py-4 text-center">No checks assigned to you</p>
        ) : (
          <div className="space-y-1">
            {upcomingChecks.map((check) => {
              const siteName = firstRow(check.sites as { name: string } | { name: string }[] | null)?.name ?? '—'
              const isOverdue = check.status === 'overdue'
              const isActive = check.status === 'in_progress'
              return (
                <Link
                  key={check.id}
                  href={`/maintenance/${check.id}`}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100 group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-eq-ink truncate">{check.custom_name ?? siteName}</p>
                    <p className="text-xs text-eq-grey">{siteName}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {isOverdue && <StatusBadge status="overdue" />}
                    {isActive && <StatusBadge status="in-progress" label="Active" />}
                    <span className="text-xs text-eq-grey">{check.due_date ? formatDate(check.due_date) : ''}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </Card>

      {/* My Recently Completed — also full width on tech screen */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-eq-ink">My Recently Completed</h2>
          <Link href="/maintenance?status=complete" className="text-xs text-eq-sky hover:text-eq-deep font-medium">View all &rarr;</Link>
        </div>
        {recentChecks.length === 0 ? (
          <p className="text-sm text-eq-grey py-4 text-center">No completed checks yet</p>
        ) : (
          <div className="space-y-1">
            {recentChecks.map((check) => {
              const siteName = firstRow(check.sites as { name: string } | { name: string }[] | null)?.name ?? '—'
              return (
                <Link
                  key={check.id}
                  href={`/maintenance/${check.id}`}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-eq-ink truncate">{check.custom_name ?? siteName}</p>
                    <p className="text-xs text-eq-grey">{siteName}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <StatusBadge status="complete" label="Done" />
                    <span className="text-xs text-eq-grey">{check.completed_at ? formatDate(check.completed_at) : ''}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </Card>

      {/* My In-Progress Tests (only when there are any) */}
      {myTestsTotal > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-eq-ink">My In-Progress Tests</h2>
            <Link href="/testing" className="text-xs text-eq-sky hover:text-eq-deep font-medium">View all &rarr;</Link>
          </div>
          <div className="space-y-1">
            {[
              ...myAcbTests.map(t => ({ ...t, kind: 'ACB' as const })),
              ...myNsxTests.map(t => ({ ...t, kind: 'NSX' as const })),
            ].map(test => {
              const assetName = firstRow(test.assets as { name: string } | { name: string }[] | null)?.name ?? '—'
              const siteName = firstRow(test.sites as { name: string } | { name: string }[] | null)?.name ?? ''
              const isDefect = test.overall_result === 'Defect'
              const isPending = test.overall_result === 'Pending'
              return (
                <Link
                  key={test.id}
                  href={`/testing/${test.kind.toLowerCase()}`}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-eq-ink truncate">{assetName}</p>
                    <p className="text-xs text-eq-grey">{siteName}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-gray-100 text-eq-grey">{test.kind}</span>
                    {isDefect && <StatusBadge status="blocked" label="Defect" />}
                    {isPending && <StatusBadge status="not-started" label="Pending" />}
                    <span className="text-xs text-eq-grey">{formatDate(test.test_date)}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </Card>
      )}

      {/* Maintenance Overview — status mix across my checks. Tighter than the
          full dashboard's version (no labels-only row, just clickable counts). */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-eq-ink">My Checks by Status</h2>
          <Link href="/maintenance" className="text-xs text-eq-sky hover:text-eq-deep font-medium">View all &rarr;</Link>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Link href="/maintenance?status=scheduled" className="rounded-lg bg-blue-50 p-3 text-center hover:bg-blue-100 transition-colors border border-blue-100">
            <p className="text-2xl font-bold text-eq-deep">{checkCounts.scheduled}</p>
            <p className="text-xs text-eq-grey mt-0.5">Scheduled</p>
          </Link>
          <Link href="/maintenance?status=in_progress" className="rounded-lg bg-sky-50 p-3 text-center hover:bg-sky-100 transition-colors border border-sky-100">
            <p className="text-2xl font-bold text-eq-sky">{checkCounts.inProgress}</p>
            <p className="text-xs text-eq-grey mt-0.5">In Progress</p>
          </Link>
          <Link href="/maintenance?status=overdue" className="rounded-lg bg-amber-50 p-3 text-center hover:bg-amber-100 transition-colors border border-amber-100">
            <p className={`text-2xl font-bold ${checkCounts.overdue > 0 ? 'text-amber-600' : 'text-eq-grey'}`}>{checkCounts.overdue}</p>
            <p className="text-xs text-eq-grey mt-0.5">Overdue</p>
          </Link>
          <Link href="/maintenance?status=complete" className="rounded-lg bg-green-50 p-3 text-center hover:bg-green-100 transition-colors border border-green-100">
            <p className="text-2xl font-bold text-green-600">{checkCounts.complete}</p>
            <p className="text-xs text-eq-grey mt-0.5">Complete</p>
          </Link>
        </div>
      </Card>
    </div>
  )
}
