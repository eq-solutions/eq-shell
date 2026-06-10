// Sentry initialisation for the client (browser) runtime.
// Next 16 picks this file up automatically when placed at the project
// root. No export is required — top-level code runs once on app boot.
//
// Captures: client component runtime errors, unhandled promise rejections,
// React error boundaries (when present), and the new App Router error.tsx
// boundaries (via Sentry's auto-instrumentation).

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 0 = errors-only. Replays and traces add cost and noise; enable when
  // there's a specific question to answer.
  tracesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  environment: process.env.NEXT_PUBLIC_APP_ENV ?? 'production',

  // Explicit disable for local dev so we don't fill the dashboard while
  // iterating. NODE_ENV is 'production' on Netlify deploys.
  enabled: process.env.NODE_ENV === 'production',

  // Common client-side noise filters. Add as we see real patterns.
  ignoreErrors: [
    // Browser extension noise — every Sentry project gets these
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications.',
    // Network errors that aren't actionable (user disconnected mid-request)
    'NetworkError when attempting to fetch resource.',
    'Failed to fetch',
  ],
})

// Optional: tag every event with the route the user navigated to so the
// Sentry UI can filter by app area. Wired into Next 16's
// onRouterTransitionStart hook for App Router.
export function onRouterTransitionStart(href: string, _navigateType: 'push' | 'replace' | 'traverse') {
  Sentry.setTag('navigated_to', new URL(href, window.location.origin).pathname)
}
