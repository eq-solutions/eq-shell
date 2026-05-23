// Session-cookie helpers for the EQ Shell Netlify functions.
//
// Why this exists: the session cookie was previously emitted with
// `Domain=.eq.solutions` hardcoded in shell-login / shell-logout /
// accept-invite. That works on production (`core.eq.solutions` is a
// subdomain of `.eq.solutions`, so the cookie sticks and is also
// shared across sibling EQ subdomains) but the browser SILENTLY drops
// the cookie when the same response is served from any non-`.eq.solutions`
// origin — i.e. deploy previews on `*.netlify.app` and local
// `netlify dev` on `localhost`. Login appeared to succeed (200 OK)
// but no session was actually established, which broke every PR's
// pre-merge smoke test for any flow that requires auth.
//
// The fix: only emit `Domain=.eq.solutions` when the request itself
// came in on an `eq.solutions` host. Off-domain (preview, localhost)
// we omit the Domain attribute entirely, so the cookie scopes itself
// to the exact host that set it — exactly what we want for previews
// (one cookie per preview URL, no leakage between them).
//
// Discovered 2026-05-23 while smoke-testing PR #15 (tenant picker)
// against its deploy preview.

const SESSION_COOKIE_NAME = 'eq_shell_session';

/**
 * Returns the Domain value to use for the session cookie, or null if
 * Domain should be omitted from the Set-Cookie header.
 *
 * Sets Domain=.eq.solutions on `eq.solutions` itself and any subdomain
 * (so the cookie is shared across `core.eq.solutions`, `app.eq.solutions`,
 * etc). Off-domain (deploy previews on netlify.app, localhost, anything
 * else) returns null — the cookie defaults to the exact host that set
 * it, which is the safest scope for those contexts.
 */
function getSessionCookieDomain(req: Request): string | null {
  const hostHeader = (req.headers.get('host') ?? '').toLowerCase();
  // Strip port if present — host can be "localhost:8888" under netlify dev.
  const hostname = hostHeader.split(':')[0];
  if (hostname === 'eq.solutions' || hostname.endsWith('.eq.solutions')) {
    return '.eq.solutions';
  }
  return null;
}

interface SessionCookieOptions {
  /** Cookie lifetime in seconds. Omit (or set 0) when clearing. */
  maxAgeSeconds?: number;
  /** Set to true to emit an Expires-in-the-past clearing directive. */
  clear?: boolean;
}

/**
 * Build a Set-Cookie header value for the shell session cookie.
 *
 * @param req  the incoming request, used to derive the Domain attribute
 * @param value the signed session token (HMAC), or '' when clearing
 * @param opts maxAgeSeconds for set; { clear: true } for logout
 *
 * Always emits HttpOnly + Secure + SameSite=Lax + Path=/. Domain is
 * conditional per getSessionCookieDomain above.
 */
export function buildSessionCookie(
  req: Request,
  value: string,
  opts: SessionCookieOptions,
): string {
  const parts: string[] = [`${SESSION_COOKIE_NAME}=${value}`];
  const domain = getSessionCookieDomain(req);
  if (domain) {
    parts.push(`Domain=${domain}`);
  }
  parts.push('Path=/');
  if (opts.clear) {
    parts.push('Max-Age=0');
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  } else if (opts.maxAgeSeconds && opts.maxAgeSeconds > 0) {
    parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`);
  }
  parts.push('HttpOnly');
  parts.push('Secure');
  parts.push('SameSite=Lax');
  return parts.join('; ');
}
