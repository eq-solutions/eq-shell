'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { dismissTechWelcomeAction } from './actions'
import { Sparkles, X } from 'lucide-react'

/**
 * First-login welcome card for technicians.
 *
 * Renders above "My Upcoming Works" on the TechDashboard for a tech
 * whose `tenant_members.tech_onboarded_at` is still null. Dismissed
 * via a server action that stamps the column — UX audit PR I §B.6.
 *
 * Two paths:
 * - "Show me my first check" — links straight to the first assigned
 *   check (or /maintenance?view=mine if no assigned checks yet).
 * - "Dismiss" — stamps tech_onboarded_at; card never reappears for
 *   this user-tenant pair.
 *
 * The local `hidden` state gives instant feedback on the dismiss tap
 * (no waiting for the server round-trip to re-render). The server
 * action runs in a transition so the page revalidates in the
 * background.
 */
export interface TechWelcomeCardProps {
  firstName: string | null
  /** Direct link to the first assigned check, if there is one. */
  firstCheckHref?: string | null
}

export function TechWelcomeCard({ firstName, firstCheckHref }: TechWelcomeCardProps) {
  const [hidden, setHidden] = useState(false)
  const [pending, startTransition] = useTransition()

  if (hidden) return null

  function handleDismiss() {
    setHidden(true)
    startTransition(async () => {
      await dismissTechWelcomeAction()
    })
  }

  const greeting = firstName ? `Welcome, ${firstName}.` : 'Welcome.'
  const ctaHref = firstCheckHref ?? '/maintenance?view=mine'

  return (
    <div className="relative flex items-start gap-4 p-5 rounded-xl bg-gradient-to-br from-eq-ice via-white to-sky-50 border border-eq-sky/30 shadow-sm">
      <div className="shrink-0 w-10 h-10 rounded-full bg-eq-sky/20 flex items-center justify-center text-eq-deep">
        <Sparkles className="w-5 h-5" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-base font-bold text-eq-ink">{greeting}</h2>
        <p className="text-sm text-eq-grey mt-1">
          You&apos;re all set up. Your assigned checks live below. Tap any check to start work — pass / fail each task on each asset, leave notes, raise defects when something needs attention.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link
            href={ctaHref}
            className="inline-flex items-center min-h-[44px] px-4 py-2 text-sm font-semibold text-white bg-eq-sky rounded-md hover:bg-eq-deep transition-colors touch-manipulation active:scale-95"
          >
            {firstCheckHref ? 'Open my first check →' : 'View my checks →'}
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={pending}
            className="text-xs text-eq-grey hover:text-eq-deep transition-colors disabled:opacity-50"
          >
            {pending ? 'Dismissing…' : "Got it — don't show this again"}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        disabled={pending}
        aria-label="Dismiss welcome"
        className="shrink-0 -mt-1 -mr-1 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded text-eq-grey hover:text-eq-ink hover:bg-white/60 transition-colors touch-manipulation active:scale-95 disabled:opacity-50"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
