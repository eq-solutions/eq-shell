/**
 * Resolve the canonical site URL for server-rendered links (invite emails,
 * password-reset redirects, callback URLs, etc.).
 *
 * Resolution order:
 *   1. `NEXT_PUBLIC_SITE_URL`         — explicit override, set in Netlify env.
 *   2. `URL`                          — Netlify-injected production URL.
 *   3. `DEPLOY_PRIME_URL`             — Netlify deploy-preview URL.
 *   4. `VERCEL_URL`                   — historical; kept for parity.
 *   5. Request-scoped `origin` / `host` header, if supplied.
 *   6. `http://localhost:3000`        — last-resort dev fallback.
 *
 * The request header is the LAST real option, not the first, because inviting
 * from a local dev build used to leak `http://localhost:3000` into production
 * emails. Env vars win so that any environment where `URL` or
 * `NEXT_PUBLIC_SITE_URL` is set produces a correct, branded link regardless of
 * who triggered the action.
 *
 * Pass `requestOrigin` (from `headers().get('origin') ?? headers().get('host')`)
 * when you want the request context to act as a fallback. Callers that don't
 * have a request (e.g. background jobs) can omit it entirely.
 */
export function getSiteUrl(requestOrigin?: string | null): string {
  const envUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')

  if (envUrl) return stripTrailingSlash(ensureProtocol(envUrl))

  if (requestOrigin) {
    return stripTrailingSlash(ensureProtocol(requestOrigin))
  }

  return 'http://localhost:3000'
}

function ensureProtocol(url: string): string {
  return url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}
