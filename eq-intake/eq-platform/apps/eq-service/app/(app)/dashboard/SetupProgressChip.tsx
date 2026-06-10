import Link from 'next/link'
import { Sparkles, ChevronRight } from 'lucide-react'

/**
 * Thin "Setup N/7" progress chip rendered above the normal dashboard for
 * admin / super_admin users who have dismissed the full onboarding
 * checklist but haven't yet completed their first maintenance check.
 *
 * Clicking the chip deep-links to /dashboard?setup=show, which the
 * dashboard branch logic in page.tsx reads to render the full
 * SetupChecklist again (the dismissal column stays stamped — re-opening
 * is non-destructive).
 *
 * Disappears entirely once any maintenance check is `complete` — the
 * branch in page.tsx that gates on `!hasAnyCompletedCheck` carries
 * through to this chip as well.
 */
export function SetupProgressChip({
  completed,
  total,
}: {
  completed: number
  total: number
}) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <Link
      href="/dashboard?setup=show"
      className="group flex items-center gap-3 px-4 py-2.5 rounded-xl border border-eq-sky/30 bg-eq-ice/40 hover:bg-eq-ice/70 hover:border-eq-sky/50 transition-colors"
    >
      <Sparkles className="w-4 h-4 text-eq-sky shrink-0" />
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-xs font-bold text-eq-deep uppercase tracking-wider">Setup</span>
        <span className="text-xs font-semibold text-eq-ink">
          {completed} / {total}
        </span>
        <div className="hidden sm:block flex-1 max-w-[140px] h-1.5 bg-white/80 rounded-full overflow-hidden">
          <div
            className="h-full bg-eq-sky transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="hidden sm:inline text-xs text-eq-grey truncate">
          Finish setting up your workspace
        </span>
      </div>
      <ChevronRight className="w-4 h-4 text-eq-grey group-hover:text-eq-deep transition-colors shrink-0" />
    </Link>
  )
}
