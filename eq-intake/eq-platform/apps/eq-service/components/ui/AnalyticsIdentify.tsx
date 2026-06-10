'use client'

/**
 * EQ Solves Service — AnalyticsIdentify
 *
 * Client-only identify bridge. Server components can't call posthog-js
 * directly, so (app)/layout.tsx renders this with the server-known user
 * + tenant props and the hook fires identify() on mount.
 *
 * Safe to render without NEXT_PUBLIC_POSTHOG_KEY set — identify() checks
 * internally and no-ops if PostHog wasn't initialised.
 */

import { useEffect } from 'react'
import { identify } from '@/lib/analytics'

type Props = {
  userId: string
  tenantId: string
  role: string
  appEnv?: string
  analyticsEnabled?: boolean
}

export function AnalyticsIdentify(props: Props) {
  useEffect(() => {
    // posthog-js init runs in Providers (also client-side). Wait one tick
    // so init has registered the super-properties before we identify.
    const t = setTimeout(() => {
      identify({
        userId: props.userId,
        tenantId: props.tenantId,
        role: props.role,
        appVersion: process.env.NEXT_PUBLIC_APP_ENV ?? 'beta',
        analyticsEnabled: props.analyticsEnabled,
      })
    }, 0)
    return () => clearTimeout(t)
  }, [props.userId, props.tenantId, props.role, props.analyticsEnabled])

  return null
}
