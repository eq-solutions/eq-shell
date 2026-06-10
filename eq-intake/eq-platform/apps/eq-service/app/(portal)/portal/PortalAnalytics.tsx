'use client'

/**
 * PortalAnalytics — fires the `portal_viewed` PostHog event once per
 * mount of the customer portal landing page. Server component owns
 * the data fetch; this carries the analytics ping client-side.
 */

import { useEffect, useRef } from 'react'
import { events as analyticsEvents } from '@/lib/analytics'

export function PortalAnalytics({
  portalType = 'customer_reports',
}: {
  portalType?: string
}) {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    analyticsEvents.portalViewed({ portal_type: portalType })
  }, [portalType])

  return null
}
