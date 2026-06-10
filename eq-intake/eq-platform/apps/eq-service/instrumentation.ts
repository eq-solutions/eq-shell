// Next 16 server-side instrumentation entry point.
// Called ONCE per server instance at startup. The conditional NEXT_RUNTIME
// branch is the documented Next 16 pattern for shipping the right
// Sentry SDK to each runtime (Node.js vs Edge).
//
// Client-side instrumentation lives in instrumentation-client.ts (top-level
// code, no register() export).

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Capture server-side errors thrown by App Router request handling
// (server components, route handlers, server actions). Re-exported from
// @sentry/nextjs so Next 16 can wire it automatically.
export { captureRequestError as onRequestError } from '@sentry/nextjs'
