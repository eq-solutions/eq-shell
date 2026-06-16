// Server-side Sentry bootstrap for the EQ Shell Netlify Functions.
//
// Initialised lazily on first import. If `SENTRY_DSN` is unset the SDK
// silently no-ops — every function still runs, just without error
// capture. This keeps preview deploys + local `netlify dev` quiet
// unless Royce has explicitly configured Sentry for the deploy.
//
// Usage in a function:
//
//   import { withSentry } from './_shared/sentry.js';
//
//   export default withSentry(async (req, ctx) => {
//     // your handler — uncaught throws + non-2xx responses get reported
//   });
//
// The `withSentry` wrapper:
//   1. Wraps the handler in try/catch and reports any uncaught throw to
//      Sentry, then re-throws so Netlify returns the standard 500.
//   2. Flushes the Sentry queue before resolving so short-lived Lambdas
//      don't drop in-flight events at exit.
//
// Env vars (server-side; set on the `eq-shell` Netlify project):
//
//   SENTRY_DSN              — Sentry project DSN (org `eq-solutions`, project `eq-shell`)
//   SENTRY_ENVIRONMENT      — optional, defaults to NETLIFY_CONTEXT (production / deploy-preview / branch-deploy)
//   SENTRY_RELEASE          — optional, defaults to COMMIT_REF if Netlify sets it
//   SENTRY_TRACES_SAMPLE_RATE — optional override (default 0.1)

import * as Sentry from '@sentry/node';
import type { Context } from '@netlify/functions';

let initialised = false;
let enabled = false;

function ensureInitialised(): void {
  if (initialised) return;
  initialised = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // Don't spam the function logs — one line on cold start is enough.
    console.info('[sentry] disabled — SENTRY_DSN not set');
    return;
  }

  try {
    const rateRaw = process.env.SENTRY_TRACES_SAMPLE_RATE;
    const tracesSampleRate = rateRaw && !Number.isNaN(Number(rateRaw)) ? Number(rateRaw) : 0.1;

    Sentry.init({
      dsn,
      environment:
        process.env.SENTRY_ENVIRONMENT ??
        process.env.NETLIFY_CONTEXT ??
        process.env.CONTEXT ??
        'production',
      release: process.env.SENTRY_RELEASE ?? process.env.COMMIT_REF,
      tracesSampleRate,
    });
    enabled = true;
  } catch (err) {
    console.warn('[sentry] init failed:', err);
  }
}

export type NetlifyHandler = (req: Request, ctx: Context) => Promise<Response> | Response;

/**
 * Wrap a Netlify v2 function so uncaught throws are reported to Sentry
 * before being re-thrown. No-ops cleanly when `SENTRY_DSN` is missing.
 */
export function withSentry(handler: NetlifyHandler): NetlifyHandler {
  return async (req: Request, ctx: Context): Promise<Response> => {
    ensureInitialised();
    if (!enabled) {
      return handler(req, ctx);
    }

    try {
      const response = await handler(req, ctx);
      return response;
    } catch (err) {
      try {
        // Derive a function name from the URL path — v2 Context has no
        // `functionName` field, but the path is reliable since every
        // Netlify Function is exposed under /.netlify/functions/<name>.
        let functionName = 'unknown';
        try {
          const path = new URL(req.url).pathname;
          const m = path.match(/\/\.netlify\/functions\/([^/]+)/);
          if (m) functionName = m[1];
        } catch {
          // ignore — leave as 'unknown'
        }
        Sentry.captureException(err, {
          tags: {
            netlify_function: functionName,
            method: req.method,
          },
          extra: {
            url: req.url,
            requestId: ctx.requestId,
          },
        });
        // Best-effort flush — Lambdas can be reaped immediately after
        // the response resolves, so we wait briefly for the event to
        // make it to Sentry. 2s is enough for the standard transport.
        await Sentry.flush(2000);
      } catch {
        // swallow — never let observability bury the original error
      }
      throw err;
    }
  };
}

/**
 * Manually report an error without unwinding the request. Useful for
 * non-fatal failures (last_login_at update failed, etc.) that we still
 * want visibility on.
 */
export function captureServerError(err: unknown, extra?: Record<string, unknown>): void {
  ensureInitialised();
  if (!enabled) return;
  try {
    Sentry.captureException(err, { extra });
  } catch {
    // swallow
  }
}

/**
 * Record a gateway-level 429 as a Sentry warning so rate-limit / abuse
 * patterns are visible in the dashboard. Call immediately before returning
 * a 429 from cards-api. Never throws.
 */
export function captureGatewayBlock(
  kind: 'ip_throttle' | 'slug_throttle',
  context: { ip: string | null; slug: string; retryAfterSeconds: number | null },
): void {
  ensureInitialised();
  if (!enabled) return;
  try {
    Sentry.captureMessage(`cards-api: 429 ${kind}`, {
      level: 'warning',
      tags: { block_kind: kind },
      extra: {
        ip: context.ip ?? '(unavailable)',
        slug: context.slug,
        retry_after_seconds: context.retryAfterSeconds,
      },
    });
  } catch {
    // swallow
  }
}
