// Sentry initialisation for the Edge runtime.
// Imported from instrumentation.ts when NEXT_RUNTIME === 'edge'.
// Edge errors (middleware/proxy.ts and any edge-runtime route handlers)
// are captured here. The proxy.ts MFA gate is the main edge surface
// in this project.

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Edge runs are short-lived; tracing produces a lot of spans.
  // Keep at 0 until we have a specific perf question to answer.
  tracesSampleRate: 0,

  environment: process.env.NEXT_PUBLIC_APP_ENV ?? process.env.CONTEXT ?? 'production',

  enabled: process.env.NODE_ENV === 'production',
})
