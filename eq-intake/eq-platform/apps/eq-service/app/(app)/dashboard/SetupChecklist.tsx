import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { CheckCircle2, Circle, Lock, ChevronRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { SetupChecklistAnalytics } from './SetupChecklistAnalytics'
import { SetupChecklistDismiss } from './SetupChecklistDismiss'

/**
 * SetupChecklist — replaces the dashboard for empty tenants.
 *
 * Renders an ordered, progressive checklist of the steps a new tenant needs
 * to take to get the workspace useful. Each row reflects real DB state — it
 * ticks itself off as the user completes the underlying action elsewhere in
 * the app (no separate "mark done" UI). The dashboard route swaps back to
 * the normal KPI view once the first maintenance check is `complete`.
 *
 * Visibility is gated by the caller (dashboard/page.tsx) on role + counts.
 */

type Counts = {
  entities: { customers: number; sites: number; assets: number; job_plans: number }
  checks:   { scheduled: number; in_progress: number; overdue: number; complete: number }
}

type Step = {
  id: string
  title: string
  description: string
  done: boolean
  locked: boolean
  primaryCta: { label: string; href: string }
  secondaryCta?: { label: string; href: string }
}

export function SetupChecklist({
  counts,
  userName,
  companyConfigured,
  hasJobPlanWithItems,
  forcedShow = false,
}: {
  counts: Counts
  userName: string
  companyConfigured: boolean
  /**
   * True iff the tenant has at least one active job_plan_items row.
   * Replaces the older `counts.entities.job_plans > 0` heuristic, which
   * silently false-ticked when a plan was saved with zero tasks
   * (UX audit PR #149 §A.3 / §2.3). The next step (Schedule check) now
   * also gates on this, so we don't push the admin into creating an
   * empty check.
   */
  hasJobPlanWithItems: boolean
  /**
   * True when the dashboard is rendering this checklist because of
   * `?setup=show` despite the row already being dismissed (user clicked
   * the chip). Switches the dismiss link copy from "Skip for now" to
   * "Hide checklist again" so the action's effect makes sense.
   */
  forcedShow?: boolean
}) {
  const hasCustomer = counts.entities.customers > 0
  const hasSite     = counts.entities.sites > 0
  const hasAsset    = counts.entities.assets > 0
  const hasJobPlan  = hasJobPlanWithItems
  const hasCheck    = counts.checks.scheduled + counts.checks.in_progress + counts.checks.overdue + counts.checks.complete > 0
  const hasComplete = counts.checks.complete > 0

  const steps: Step[] = [
    {
      id: 'company',
      title: 'Company details',
      description: 'Set your company name, ABN, and contact info — used on every customer report and invoice.',
      done: companyConfigured,
      locked: false,
      primaryCta: { label: 'Edit company info', href: '/admin/settings' },
    },
    {
      id: 'customer',
      title: 'Add your first customer',
      description: 'Customers own one or more sites (e.g. Equinix, Jemena, a hospital operator).',
      done: hasCustomer,
      locked: false,
      primaryCta: { label: 'Add customer', href: '/customers' },
    },
    {
      id: 'site',
      title: 'Add a site',
      description: 'Sites are physical locations where work happens — data centres, substations, healthcare facilities.',
      done: hasSite,
      locked: !hasCustomer,
      primaryCta: { label: 'Add site', href: '/sites' },
    },
    {
      id: 'asset',
      title: 'Add assets to the site',
      description: 'Switchboards, breakers, generators — the equipment you maintain. Add a few manually or import an asset register.',
      done: hasAsset,
      locked: !hasSite,
      primaryCta: { label: 'Add asset', href: '/assets' },
      secondaryCta: { label: 'Import xlsx', href: '/assets?import=1' },
    },
    {
      id: 'job-plan',
      title: 'Set up a maintenance plan',
      description: 'Job plans define the tasks performed at each visit (e.g. annual switchboard PPM, RCD time-trip). Use the 5 starter templates, pick one of yours, or import.',
      done: hasJobPlan,
      locked: !hasAsset,
      // Primary CTA links to the empty /job-plans page, where the hero
      // starter-templates callout is the first thing the admin sees. We
      // intentionally don't pre-seed on the dashboard click — letting the
      // admin see what plans they're about to create is part of the
      // onboarding hand-off (UX audit §A.4 / §3.3).
      primaryCta: { label: 'Use starter templates', href: '/job-plans' },
      secondaryCta: { label: 'Import xlsx', href: '/job-plans?import=1' },
    },
    {
      id: 'check',
      title: 'Schedule a maintenance check',
      description: 'A check is the work-order — picks a site + maintenance plan, expands to per-asset task lists for the tech.',
      done: hasCheck,
      locked: !hasJobPlan,
      primaryCta: { label: 'New check', href: '/maintenance' },
    },
    {
      id: 'complete',
      title: 'Run the check end-to-end',
      description: 'Open the check, tick items, mark complete. Once you finish your first check this checklist goes away.',
      done: hasComplete,
      locked: !hasCheck,
      primaryCta: { label: 'Open check', href: '/maintenance' },
    },
  ]

  const completedCount = steps.filter((s) => s.done).length
  const totalSteps = steps.length
  const percentDone = Math.round((completedCount / totalSteps) * 100)

  // Find the first non-done, non-locked step — the "up next" row gets a
  // subtle highlight so the staff member knows where to focus.
  const upNextId = steps.find((s) => !s.done && !s.locked)?.id ?? null

  return (
    <div className="space-y-6">
      <SetupChecklistAnalytics
        completed={completedCount}
        total={totalSteps}
        upNext={upNextId}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-eq-sky" />
            <span className="text-xs font-bold text-eq-sky uppercase tracking-wider">Getting Started</span>
          </div>
          <h1 className="text-2xl font-bold text-eq-ink">Welcome, {userName}</h1>
          <p className="text-sm text-eq-grey mt-1">
            Let&apos;s get your workspace set up. {completedCount} of {totalSteps} steps complete.
          </p>
        </div>
        <SetupChecklistDismiss variant="x" forcedShow={forcedShow} />
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-eq-grey">{percentDone}% complete</span>
          <span className="text-xs text-eq-grey">{completedCount} / {totalSteps}</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-eq-sky transition-all duration-500"
            style={{ width: `${percentDone}%` }}
          />
        </div>
      </div>

      {/* Checklist */}
      <Card className="p-0">
        <div className="divide-y divide-gray-100">
          {steps.map((step, i) => (
            <StepRow
              key={step.id}
              step={step}
              stepNumber={i + 1}
              isUpNext={step.id === upNextId}
            />
          ))}
        </div>
      </Card>

      {/* Footer help */}
      <div className="text-center pt-2 space-y-2">
        <p className="text-xs text-eq-grey">
          Stuck? Try the help widget in the bottom-right corner, or jump to{' '}
          <Link href="/maintenance" className="text-eq-sky hover:text-eq-deep font-medium">
            Maintenance
          </Link>
          {' '}to see the work-order surface this is all leading toward.
        </p>
        <div>
          <SetupChecklistDismiss variant="link" forcedShow={forcedShow} />
        </div>
      </div>
    </div>
  )
}

function StepRow({
  step,
  stepNumber,
  isUpNext,
}: {
  step: Step
  stepNumber: number
  isUpNext: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-4 px-5 py-4 transition-colors',
        isUpNext && 'bg-eq-ice/40',
        step.locked && 'opacity-50',
      )}
    >
      {/* Number / status dot */}
      <div className="shrink-0 pt-0.5">
        {step.done ? (
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
        ) : step.locked ? (
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <Lock className="w-4 h-4 text-gray-400" />
          </div>
        ) : (
          <div
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold',
              isUpNext ? 'bg-eq-sky text-white' : 'bg-eq-ice text-eq-deep',
            )}
          >
            {stepNumber}
          </div>
        )}
      </div>

      {/* Title + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={cn(
            'text-sm font-semibold',
            step.done ? 'text-eq-grey line-through' : 'text-eq-ink',
          )}>
            {step.title}
          </p>
          {isUpNext && (
            <span className="text-[10px] font-bold text-eq-sky uppercase tracking-wider px-1.5 py-0.5 rounded bg-eq-sky/10">
              Up next
            </span>
          )}
        </div>
        <p className="text-xs text-eq-grey mt-1 leading-relaxed">{step.description}</p>

        {/* CTAs — only for the active, unlocked, undone step we show them. */}
        {!step.done && !step.locked && (
          <div className="flex gap-2 mt-3 flex-wrap">
            <Link href={step.primaryCta.href}>
              <Button size="sm">
                {step.primaryCta.label}
                <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
              </Button>
            </Link>
            {step.secondaryCta && (
              <Link href={step.secondaryCta.href}>
                <Button size="sm" variant="secondary">{step.secondaryCta.label}</Button>
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
