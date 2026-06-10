'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { seedStarterJobPlansAction } from './actions'
import { STARTER_JOB_PLANS } from '@/lib/seed/starter-job-plans'

/**
 * One-click "Use starter templates" CTA. Renders a sky-tinted hero callout
 * with the count + names of the 5 starter plans, and a button that calls
 * seedStarterJobPlansAction. Idempotent on repeat clicks (server-side
 * checks by code).
 *
 * Variants:
 *   - `compact` — single inline button + small note (for use in toolbars).
 *   - `hero`    — full callout block with sparkles + plan list (for use
 *                 on the empty /job-plans state).
 *
 * UX audit PR #149 §A.4 / §3.3.
 */
interface StarterTemplatesCtaProps {
  variant?: 'hero' | 'compact'
}

export function StarterTemplatesCta({ variant = 'hero' }: StarterTemplatesCtaProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function handleSeed() {
    setFeedback(null)
    startTransition(async () => {
      const result = await seedStarterJobPlansAction()
      if (!result.success) {
        setFeedback({ kind: 'err', text: result.error ?? 'Could not seed starter templates.' })
        return
      }
      if (result.plansCreated === 0) {
        // All five already exist for this tenant — common after a second click.
        setFeedback({
          kind: 'ok',
          text: 'All 5 starter plans are already in this workspace. Nothing changed.',
        })
        return
      }
      setFeedback({
        kind: 'ok',
        text: `Created ${result.plansCreated} starter plan${result.plansCreated === 1 ? '' : 's'} (${result.itemsCreated} task${result.itemsCreated === 1 ? '' : 's'}).`,
      })
      // refresh the server component so the new plans render in the table.
      router.refresh()
    })
  }

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-3">
        <Button size="sm" variant="secondary" onClick={handleSeed} loading={pending}>
          <Sparkles className="w-3.5 h-3.5 mr-1" /> Use starter templates
        </Button>
        {feedback && (
          <span className={`text-xs ${feedback.kind === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
            {feedback.text}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-eq-sky/30 bg-eq-ice/50 p-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-full bg-eq-sky text-white flex items-center justify-center">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-eq-ink">Don&apos;t have a plan template yet?</h3>
          <p className="text-xs text-eq-grey mt-1 leading-relaxed">
            Seed your workspace with {STARTER_JOB_PLANS.length} generic starter plans you can edit, extend, or delete from there.
          </p>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-eq-grey">
            {STARTER_JOB_PLANS.map((p) => (
              <li key={p.code} className="flex items-baseline gap-1.5">
                <span className="text-eq-sky">•</span>
                <span className="text-eq-ink font-medium">{p.name}</span>
                <span className="text-eq-grey text-[10px] uppercase">{p.frequency.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-3">
            <Button size="sm" onClick={handleSeed} loading={pending}>
              <Sparkles className="w-3.5 h-3.5 mr-1" /> Add 5 starter plans
            </Button>
            {feedback && (
              <span className={`text-xs ${feedback.kind === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
                {feedback.text}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
