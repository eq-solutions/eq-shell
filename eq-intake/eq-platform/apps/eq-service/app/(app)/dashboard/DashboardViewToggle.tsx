'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

type View = 'mine' | 'all'

/**
 * Dashboard scope toggle — renders as a quiet inline text link inside the
 * page subtitle. Previously a prominent pill button in the top-right of
 * the dashboard header; demoted on 2026-05-13 so the welcome row stops
 * fighting the global plan chip for top-right real estate.
 *
 * Two states:
 *   - 'all'  → "All Active Work" — every open check / WO / defect across the tenant.
 *   - 'mine' → "Assigned to Me" — only items where assignee_user_id === current user.
 *
 * Persists via the `view` query param so the choice survives page refreshes
 * and is shareable via URL. Default landing scope is decided server-side
 * (page.tsx) based on whether the user has any assigned items.
 */
export function DashboardViewToggle({ currentView }: { currentView: View }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const toggle = useCallback(() => {
    const next: View = currentView === 'mine' ? 'all' : 'mine'
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', next)
    router.push(`/dashboard?${params.toString()}`)
  }, [currentView, router, searchParams])

  const nextLabel = currentView === 'mine' ? 'show all active work' : 'show only mine'

  return (
    <button
      type="button"
      onClick={toggle}
      className="text-eq-sky hover:text-eq-deep transition-colors underline-offset-2 hover:underline"
    >
      {nextLabel} →
    </button>
  )
}
