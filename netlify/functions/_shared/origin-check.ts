// Origin-assertion helper for the EQ Shell iframe-token mint endpoints.
//
// Why this exists: mint-iframe-token / mint-cards-iframe-token /
// mint-quotes-iframe-token authenticate purely on the `eq_shell_session`
// cookie. That cookie is SameSite=Lax with Domain=.eq.solutions (see
// _shared/cookie.ts), so it is shared across EVERY *.eq.solutions
// subdomain. A page on any sibling EQ subdomain (or one carrying an XSS)
// can therefore issue a same-site POST to core.eq.solutions's mint
// endpoints, send the cookie along, and walk away with a 60s cross-app
// handoff token — a classic confused-deputy. Asserting that the request
// Origin is the Shell itself closes that gap; the cookie check alone does
// not.
//
// Posture: REPORT-ONLY by default. A present-but-disallowed Origin is
// logged (greppable `[origin-check]` line in the Netlify function log) but
// the request still proceeds, so production can be watched for false
// positives before enforcement is turned on. Set ENFORCE_IFRAME_ORIGIN=true
// on the eq-shell Netlify deploy to switch to hard 403s — no code change,
// reversible by clearing the env var.
//
// A MISSING Origin header is always allowed: a cross-origin browser attack
// necessarily carries an Origin, so its absence (curl smokes, same-origin
// tools that omit it) is not the threat this guards against.

const ALLOWED_ORIGIN_EXACT = new Set<string>(['https://core.eq.solutions']);

// Production alias, branch deploys, and numbered deploy previews all live
// under *.eq-shell.netlify.app (e.g. deploy-preview-349--eq-shell...,
// demo--eq-shell..., eq-shell.netlify.app). netlify dev runs on localhost.
const ALLOWED_ORIGIN_RE: RegExp[] = [
  /^https:\/\/([a-z0-9-]+--)?eq-shell\.netlify\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

export function isAllowedShellOrigin(origin: string): boolean {
  if (ALLOWED_ORIGIN_EXACT.has(origin)) return true;
  return ALLOWED_ORIGIN_RE.some((re) => re.test(origin));
}

function forbidden(): Response {
  return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * Guard an iframe-token mint endpoint against cross-subdomain CSRF.
 *
 * Returns a 403 Response (to short-circuit the handler) ONLY when
 * enforcement is on (ENFORCE_IFRAME_ORIGIN=true) AND the request carries a
 * present-but-disallowed Origin. In report-only mode it logs the violation
 * and returns null so the caller proceeds. Returns null for allowed or
 * absent Origins in every mode.
 *
 * @param req     incoming request
 * @param fnName  short label for the log line (e.g. 'mint-iframe-token')
 */
export function checkShellOrigin(req: Request, fnName: string): Response | null {
  const origin = req.headers.get('origin');
  if (origin === null) return null; // no Origin → not the threat this guards
  if (isAllowedShellOrigin(origin)) return null;

  const enforcing = process.env.ENFORCE_IFRAME_ORIGIN === 'true';
  console.warn(
    `[origin-check] ${fnName}: ${enforcing ? 'BLOCKED' : 'report-only'} disallowed origin=${origin}`,
  );
  return enforcing ? forbidden() : null;
}
