// POST /.netlify/functions/mint-iframe-token
//
// Unified iframe-token minting endpoint. Requires a valid eq_shell_session
// cookie. Dispatches on the optional `aud` field in the JSON body:
//
//   aud = 'field'   (default) — mints a ShellTokenPayload for EQ Field.
//   aud = 'service'           — mints a ServiceTokenPayload for EQ Service.
//
// ─── FIELD (aud='field' or omitted) ─────────────────────────────────────────
// Returns a short-lived (60s) HMAC token in the EXACT shape EQ Field's
// verifyShellToken() expects (Phase 1.C, PR #106 on eq-field-app/demo):
//
//   { kind: 'shell-token', name: string, role: 'staff'|'supervisor', exp: number }
//
// The shell embeds Field as:
//   <iframe src="https://eq-solves-field.netlify.app/?tenant=<slug>#sh=<token>">
//
// Field reads the hash on boot, calls its own
// /.netlify/functions/verify-pin with action="verify-shell-token",
// gets back a 7d Field session, skips the PIN gate.
//
// Role mapping canonical → Field two-tier gate (IDENTITY-MODEL.md §7.1):
//   manager / is_platform_admin = true   → Field 'supervisor'
//   supervisor                            → Field 'supervisor'
//   employee / apprentice / labour_hire   → Field 'staff'
//
// Caller must also supply `tenant_slug` (validated against ALLOWED_FIELD_TENANT_SLUGS).
// Response: { token: string, tenant_slug: string }
//
// ─── SERVICE (aud='service') ─────────────────────────────────────────────────
// Returns a short-lived (60s) BridgeToken for EQ Service's receiver.
//
// Format: base64url(JSON) + '.' + hex(HMAC-SHA256 with EQ_SHELL_BRIDGE_SECRET)
//
//   { iss: 'eq-shell', aud: 'service', email, tenant_slug, exp }
//
// EQ_SHELL_BRIDGE_SECRET must match the same env var on the EQ Service deploy.
// No `tenant_slug` in the request body required — resolved from session.
// Response: { token: string }

import type { Context } from '@netlify/functions';
import { getServiceClient, getUserSecurityGroupPerms } from './_shared/supabase.js';
import type { CanonicalUser } from './_shared/supabase.js';
import { verifySessionToken, readSessionCookie, signShellToken, signBridgeToken, hasBridgeSecret, hasSecretSalt } from './_shared/token.js';
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
const ALLOWED_FIELD_TENANT_SLUGS = ['eq', 'demo-trades', 'melbourne', 'sks'] as const;
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
  if (!hasBridgeSecret()) {
    return jsonResponse(500, { error: 'Server misconfigured — missing EQ_SHELL_BRIDGE_SECRET' });
  }

  // Auth check FIRST — unauthenticated callers get a flat 401 and
  // never learn anything about the request shape (including the
  // tenant allow-list returned in the 400 body below).
  const token = readSessionCookie(req);
  const session = verifySessionToken(token);
  if (!session) {
    return jsonResponse(401, { valid: false });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const aud = (body as { aud?: unknown } | null)?.aud ?? 'field';
  if (aud !== 'field' && aud !== 'service') {
    return jsonResponse(400, { error: 'Invalid aud — expected "field" or "service"' });
  }

  // For field: validate tenant_slug before the DB call to avoid a
  // wasted round-trip on invalid picker input.
  let tenantSlug: AllowedFieldTenantSlug | undefined;
  if (aud === 'field') {
    // 2026-05-22 — Wave 5: chosen Field tenant slug arrives in the
    // request body from the shell-side picker. Validated against the
    // hardcoded allow-list above; anything else is rejected. The
    // `allowed` array is fine to return here because the caller is
    // authenticated and already knows which tenants the picker UI
    // shows them.
    const raw = (body as { tenant_slug?: unknown } | null)?.tenant_slug;
    if (!isAllowedFieldTenantSlug(raw)) {
      return jsonResponse(400, {
        error: 'Invalid or missing tenant_slug',
        allowed: ALLOWED_FIELD_TENANT_SLUGS,
      });
    }
    tenantSlug = raw;
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  const { data: user, error } = await sb
    .from('users')
    .select('id, email, name, tenant_id, role, is_platform_admin, active')
    .eq('id', session.user_id)
    .eq('active', true)
    .maybeSingle<
      Pick<CanonicalUser, 'id' | 'email' | 'name' | 'tenant_id' | 'role' | 'is_platform_admin' | 'active'>
    >();

  if (error || !user) {
    return jsonResponse(401, { valid: false });
  }

  if (aud === 'service') {
    // Cross-tenant guard: DB user must belong to the authenticated session tenant.
    if (user.tenant_id !== session.tenant_id) {
      return jsonResponse(401, { valid: false });
    }
    // Resolve the tenant slug — the session cookie carries tenant_id (UUID) but
    // the bridge token payload uses the human-readable slug (e.g. 'sks').
    const { data: tenantRow } = await sb
      .from('tenants')
      .select('slug')
      .eq('id', user.tenant_id)
      .maybeSingle<{ slug: string }>();
    if (!tenantRow) {
      return jsonResponse(500, { error: 'Could not resolve tenant slug' });
    }
    const bridgeToken = signBridgeToken({
      iss: 'eq-shell',
      aud: 'service',
      email: user.email,
      tenant_slug: tenantRow.slug,
      shell_user_id: user.id,
      exp: Date.now() + IFRAME_TOKEN_TTL_MS,
    });
    return jsonResponse(200, { token: bridgeToken });
  }

  // aud === 'field'

  // Phase 1.F: derive Field's two-tier role from the 5-tier canonical
  // role + platform_admin flag.
  const fieldRole: 'staff' | 'supervisor' =
    user.is_platform_admin || user.role === 'manager' || user.role === 'supervisor'
      ? 'supervisor'
      : 'staff';

  // Display name for Field's sidebar / audit_log / form prefills.
  const displayName = user.name ?? (user.email.includes('@') ? user.email.split('@')[0] : user.email);

  // 2026-06-05: the user's security-group permission keys, scoped to their
  // tenant — same source shell-login / verify-shell-session use. Field honours
  // these additively in EQ_PERMS.can() (v3.5.78). Non-fatal: on any lookup
  // failure we mint without perms (role still applies) rather than block login.
  let extraPerms: string[] = [];
  try {
    extraPerms = await getUserSecurityGroupPerms(user.id, user.tenant_id);
  } catch {
    extraPerms = [];
  }

  const shellToken = signShellToken({
    kind: 'shell-token',
    name: displayName,
    role: fieldRole,
    // Phase 1.F: the full canonical identity. Field DOES consume these now —
    // verify-shell-token (eq-field v3.5.22+) reads eq_role/is_platform_admin to
    // derive the Field role, and extra_perms (v3.5.78) to widen access via
    // security groups.
    eq_role: user.role,
    is_platform_admin: user.is_platform_admin,
    // Only include extra_perms when non-empty — keeps the token compact and
    // matches the shell-login / verify-shell-session payload convention.
    ...(extraPerms.length > 0 ? { extra_perms: extraPerms } : {}),
    // 2026-05-22 — Wave 5: chosen Field tenant. Field's v3.5.17
    // _consumeShellToken cross-checks this against TENANT.ORG_SLUG
    // (set from the iframe URL's ?tenant= param the caller builds
    // from the response below) and rejects on mismatch. Prevents a
    // confused-deputy where a token minted for tenant A is replayed
    // against tenant B's URL.
    tenant_slug: tenantSlug!,
    shell_user_id: user.id,
    exp: Date.now() + IFRAME_TOKEN_TTL_MS,
  });

  // tenant_slug is echoed in the response so FieldIframe can build
  // the iframe URL (`?tenant=<slug>#sh=<token>`) without re-reading
  // its own picker state — single source of truth is what the server
  // actually signed.
  return jsonResponse(200, { token: shellToken, tenant_slug: tenantSlug });
});
