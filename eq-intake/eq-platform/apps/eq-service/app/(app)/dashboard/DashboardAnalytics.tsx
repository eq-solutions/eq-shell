'use client'

/**
 * DashboardAnalytics — fires the `dashboard_viewed` PostHog event once per
 * mount. The dashboard page itself is a server component, so this tiny
 * client component carries the event so it ships in the browser bundle.
 *
 * Receives the two counts the page already calculated server-side, so we
 * don't double-query Supabase from the client just for analytics.
 */

import { useEffect, useRef } from 'react'
import { events as analyticsEvents } from '@/lib/analytics'

export function DashboardAnalytics({
  siteCount,
  openChecksCount,
}: {
  siteCount: number
  openChecksCount: number
}) {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    analyticsEvents.dashboardViewed({
      site_count: siteCount,
      open_checks_count: openChecksCount,
    })
  }, [siteCount, openChecksCount])

  return null
}
