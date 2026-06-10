// Sentry initialisation for the Node.js server runtime.
// Imported from instrumentation.ts when NEXT_RUNTIME === 'nodejs'.
// Server-side errors (server actions, route handlers, RSC fetches) are
// captured here.
//
// Keep this file at the project root, NOT under app/ or lib/, because the
// Next.js Sentry integration looks for it by exact path.

import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Sample 100% of errors. Volume is low at current tenant count; revisit
  // when monthly errors approach the Sentry free-tier cap (5k events/month).
  tracesSampleRate: 0,

  // Replay sampling is client-only; not used here. See sentry.client.config.
  // Profiling is opt-in via @sentry/profiling-node; not enabled.

  // Tag every event with the environment so the Sentry UI can filter
  // production vs preview deploys vs local. Netlify sets CONTEXT
  // (production / deploy-preview / branch-deploy) automatically.
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? process.env.CONTEXT ?? 'production',

  // Source-map upload is wired in next.config.ts; releases auto-tagged
  // by the @sentry/nextjs plugin from the Netlify commit SHA.

  // Don't pollute the dashboard with local dev errors.
  enabled: process.env.NODE_ENV === 'production',

  // Common server-side noise filters. Add specific patterns as we see
  // them in the dashboard.
  ignoreErrors: [
    // PostgREST often returns 'No rows found' as an error shape via
    // maybeSingle() — we handle these inline, they aren't real errors.
    /PGRST116/,
  ],
})
