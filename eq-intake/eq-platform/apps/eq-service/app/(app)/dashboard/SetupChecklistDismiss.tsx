'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { dismissSetupChecklistAction } from './actions'

/**
 * Dismiss controls for the dashboard onboarding checklist.
 *
 * Two surfaces, both wired to the same server action:
 *   - `variant="x"` — top-right corner X for fast dismissal
 *   - `variant="link"` — discreet text link in the footer
 *
 * After the action stamps tenant_members.setup_checklist_dismissed_at,
 * we push the user to /dashboard (without `?setup=show`) so they land on
 * the normal KPI view with the Setup chip pinned above it.
 *
 * The full checklist is server-rendered; this is a thin client island so
 * we can show the action's pending state without round-tripping.
 */
export function SetupChecklistDismiss({
  variant,
  forcedShow,
}: {
  variant: 'x' | 'link'
  /**
   * True when the checklist is being shown because the URL has
   * `?setup=show` (i.e. the row is already dismissed and the user
   * opened it from the chip). Tweaks the link copy from "Skip setup"
   * to "Hide checklist" — same action, different framing.
   */
  forcedShow: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleDismiss() {
    startTransition(async () => {
      await dismissSetupChecklistAction()
      router.push('/dashboard')
      router.refresh()
    })
  }

  if (variant === 'x') {
    return (
      <button
        type="button"
        onClick={handleDismiss}
        disabled={pending}
        aria-label="Skip setup checklist"
        title="Skip for now"
        className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md text-eq-grey hover:text-eq-ink hover:bg-gray-100 transition-colors disabled:opacity-50"
      >
        <X className="w-4 h-4" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleDismiss}
      disabled={pending}
      className="text-xs text-eq-grey hover:text-eq-deep underline-offset-2 hover:underline disabled:opacity-50"
    >
      {pending
        ? 'Dismissing…'
        : forcedShow
          ? 'Hide checklist again'
          : 'Skip for now — show as a chip on the dashboard'}
    </button>
  )
}
