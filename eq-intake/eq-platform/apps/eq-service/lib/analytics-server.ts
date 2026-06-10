import { PostHog } from 'posthog-node';

// Lazy singleton — one instance per process, not one per Server Action call.
// Under concurrency this prevents spinning up a new HTTP client per request.
let _client: PostHog | null = null;

function getClient(): PostHog | null {
  if (_client) return _client;

  const key = process.env.POSTHOG_KEY;
  const host = process.env.POSTHOG_HOST;
  if (!key) return null;

  _client = new PostHog(key, {
    host,
    // Batch up to 20 events or flush every 10s — sensible for Server Actions
    // under real concurrency. flushAt:1 / flushInterval:0 is fine in dev but
    // creates per-request HTTP overhead in production.
    flushAt: 20,
    flushInterval: 10_000,
  });

  // Flush on process exit (Vercel/Netlify Functions call this when
  // recycling the instance).
  if (typeof process !== 'undefined' && typeof process.on === 'function') {
    process.on('beforeExit', () => {
      _client?.shutdown();
    });
  }

  return _client;
}

/**
 * Track an event from a Server Action or route handler.
 *
 * Use for events that must not be lost if the client closes the tab:
 *   - Delta WO import commit
 *   - Report generation / delivery
 *   - Archive toggles that write to the DB
 *
 * Always awaits a flush — in serverless runtimes the function instance may
 * be recycled immediately after the response is sent.
 */
export async function trackServer(
  userId: string,
  event: string,
  props: Record<string, any> = {}
) {
  const ph = getClient();
  if (!ph) return;
  ph.capture({
    distinctId: userId,
    event,
    properties: { ...props, app: 'eq-service', source: 'server' },
  });
  await ph.flush();
}

/**
 * Server-side error tracking — mirrors client-side `trackError` but from
 * Server Actions / route handlers.
 */
export async function trackServerError(
  userId: string,
  context: string,
  message: string,
  extra: Record<string, any> = {}
) {
  await trackServer(userId, 'error_thrown', { context, message, ...extra });
}
