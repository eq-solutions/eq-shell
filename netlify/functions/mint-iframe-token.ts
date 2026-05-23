// POST /.netlify/functions/mint-iframe-token
//
// Requires a valid eq_shell_session cookie. Returns a short-lived
// (60s) HMAC token in the EXACT shape EQ Field's verifyShellToken()
// expects (Phase 1.C, PR #106 on eq-field-app/demo):
//
//   { kind: 'shell-token', name: string, role: 'staff'|'supervisor', exp: number }
//
// The token is signed with the SAME EQ_SECRET_SALT both deploys
// share — that's how the cross-domain handshake works without a
// shared cookie. The shell embeds Field as
//
//   <iframe src="https://eq-solves-field.netlify.app/#sh=<token>">
//
// Field reads the hash on boot, calls its own
// /.netlify/functions/verify-pin with action="verify-shell-token",
// gets back a 7d Field session, skips the PIN gate.
//
// Role mapping from canonical (post Phase 1.F) → Field's two-tier gate
// (per IDENTITY-MODEL.md §7.1):
//   manager / is_platform_admin = true   → Field 'supervisor'
//   supervisor                            → Field 'supervisor'
//   employee / apprentice / labour_hire   → Field 'staff'
//
// The canonical taxonomy is intentionally richer than Field's binary
// gate; the collapse is lossy. When Field's role system catches up
// (separate Milmlow/eq-field-app PR — tracked but not in scope here),
// the iframe token will carry the full eq_role + is_platform_admin
// alongside the legacy staff|supervisor field, and Field will start
// honouring them. For now Field only consumes staff|supervisor.

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, signShellToken, hasSecretSalt } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

const IFRAME_TOKEN_TTL_MS = 60 * 1000;

// 2026-05-22 — Wave 5: tenant picker on shell's /core/field surface.
// The picker hands the chosen Field organisation slug to the mint
// endpoint via POST body. This list is the authority for what counts
// as a valid choice; if a new Field tenant lands, update both this
// list and the picker cards in FieldIframe.tsx in the same PR.
//
// Why a hardcoded allow-list and not a DB lookup: shell_control.tenants
// is the shell's own tenant model (currently just 'core'), not Field's
// organisations table. The reverted PR #10/#12 sourced tenant_slug
// from shell_control.tenants of the caller's user → broke because
// every shell user is on 'core', which isn't a Field tenant. The
// picker decouples the two: shell tenant remains the auth identity,
// Field tenant is chosen per session.
const ALLOWED_FIELD_TENANT_SLUGS = ['eq', 'demo-trades', 'melbourne'] as const;
type AllowedFieldTenantSlug = (typeof ALLOWED_FIELD_TENANT_SLUGS)[number];

function isAllowedFieldTenantSlug(value: unknown): value is AllowedFieldTenantSlug {
  return typeof value === 'string' && (ALLOWED_FIELD_TENANT_SLUGS as readonly string[]).includes(value);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default withSentry(async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  if (!hasSecretSalt()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SECRET_SALT' });
  }

  // Auth check FIRST — unauthenticated callers get a flat 401 and
  // never learn anything about the request shape (including the
  // tenant allow-list returned in the 400 body below).
  const token = readSessionCookie(req);
  const session = verifySessionToken(token);
  if (!session) {
    return jsonResponse(401, { valid: false });
  }

  // 2026-05-22 — Wave 5: chosen Field tenant slug arrives in the
  // request body from the shell-side picker. Validated against the
  // hardcoded allow-list above; anything else is rejected. The
  // `allowed` array is fine to return here because the caller is
  // authenticated and already knows which tenants the picker UI
  // shows them.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }
  const tenantSlug = (body as { tenant_slug?: unknown } | null)?.tenant_slug;
  if (!isAllowedFieldTenantSlug(tenantSlug)) {
    return jsonResponse(400, {
      error: 'Invalid or missing tenant_slug',
      allowed: ALLOWED_FIELD_TENANT_SLUGS,
    });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  const { data: user, error } = await sb
    .from('users')
    .select('id, email, tenant_id, role, is_platform_admin, active')
    .eq('id', session.user_id)
    .eq('active', true)
    .maybeSingle<
      Pick<CanonicalUser, 'id' | 'email' | 'tenant_id' | 'role' | 'is_platform_admin' | 'active'>
    >();

  if (error || !user) {
    return jsonResponse(401, { valid: false });
  }

  // Phase 1.F: derive Field's two-tier role from the 5-tier canonical
  // role + platform_admin flag.
  const fieldRole: 'staff' | 'supervisor' =
    user.is_platform_admin || user.role === 'manager' || user.role === 'supervisor'
      ? 'supervisor'
      : 'staff';

  // Display name for Field's sidebar / audit_log / form prefills.
  // Stopgap: derive from email local-part since canonical `users` has
  // no `name` column yet. Replace with `user.name` once that column
  // lands (separate migration follow-up).
  const displayName = user.email.includes('@')
    ? user.email.split('@')[0]
    : user.email;

  const shellToken = signShellToken({
    kind: 'shell-token',
    name: displayName,
    role: fieldRole,
    // Phase 1.F: extend the wire payload to carry the full canonical
    // identity. Field doesn't consume these YET — its verify-shell-token
    // handler only reads `name` + `role` today. The follow-up
    // Milmlow/eq-field-app PR will add a v2 verifier that honours these
    // (start using eq_role for finer-grained Field-side gating;
    // recognise is_platform_admin for support visibility). Until then
    // the fields travel harmlessly.
    eq_role: user.role,
    is_platform_admin: user.is_platform_admin,
    // 2026-05-22 — Wave 5: chosen Field tenant. Field's v3.5.17
    // _consumeShellToken cross-checks this against TENANT.ORG_SLUG
    // (set from the iframe URL's ?tenant= param the caller builds
    // from the response below) and rejects on mismatch. Prevents a
    // confused-deputy where a token minted for tenant A is replayed
    // against tenant B's URL.
    tenant_slug: tenantSlug,
    exp: Date.now() + IFRAME_TOKEN_TTL_MS,
  });

  // tenant_slug is echoed in the response so FieldIframe can build
  // the iframe URL (`?tenant=<slug>#sh=<token>`) without re-reading
  // its own picker state — single source of truth is what the server
  // actually signed.
  return jsonResponse(200, { token: shellToken, tenant_slug: tenantSlug });
});
