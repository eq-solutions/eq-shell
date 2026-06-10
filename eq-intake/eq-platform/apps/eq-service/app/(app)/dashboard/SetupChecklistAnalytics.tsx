'use client'

/**
 * SetupChecklistAnalytics — fires `setup_checklist_viewed` once per mount with
 * the current completion state, so we can see where Royce's staff member
 * (and future tenants) actually get stuck during the onboarding journey.
 *
 * Companion to DashboardAnalytics — same shape (client child of a server page,
 * counts already calculated upstream so no double-query).
 */

import { useEffect, useRef } from 'react'
import { track } from '@/lib/analytics'

export function SetupChecklistAnalytics({
  completed,
  total,
  upNext,
}: {
  completed: number
  total: number
  upNext: string | null
}) {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    track('setup_checklist_viewed', {
      completed,
      total,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      up_next_step: upNext,
    })
  }, [completed, total, upNext])

  return null
}
