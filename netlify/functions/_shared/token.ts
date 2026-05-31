// Shared HMAC token helpers for the EQ Shell Netlify functions.
//
// Two token shapes are produced here:
//
//   1. Session cookie payload — { user_id, tenant_id, exp }
//      Set by shell-login, validated by verify-shell-session.
//      Lives in the eq_shell_session cookie on .eq.solutions.
//
//   2. Iframe handoff token — { kind: 'shell-token', name, role, exp }
//      Minted by mint-iframe-token, validated by EQ Field's
//      /.netlify/functions/verify-pin (action="verify-shell-token").
//      Must match EQ Field's verifyShellToken() shape exactly —
//      see Field-side PR #106 (Phase 1.C) for the contract.
//
// Both shapes use the same wire format: base64(JSON payload) + "." + hex(HMAC-SHA256).
// HMAC key is EQ_SECRET_SALT — MUST be the SAME value as eq-solves-field
// uses, or the iframe handshake won't validate.

import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET_SALT = process.env.EQ_SECRET_SALT ?? '';

// Constant-time HMAC sig comparison. Plain === is vulnerable to
// timing-based byte-by-byte sig recovery; timingSafeEqual short-
// circuits on length mismatch but otherwise runs in constant time
// regardless of where the first byte diverges. EQ Field's verify-pin.js
// has the same `!==` pattern — fix that in parallel.
function sigsEqual(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

import type { EqRole } from './supabase.js';

export interface SessionMembership {
  tenant_id: string;
  role: EqRole;
}

export interface SessionPayload {
  user_id: string;
  /**
   * Always equals active_tenant_id. Kept under this name because
   * downstream consumers (eq-solves-field, eq-solves-service, the
   * iframe mint endpoints) read `session.tenant_id` directly and we
   * must not break that wire shape.
   */
  tenant_id: string;
  /** The currently-operating tenant. Same value as tenant_id. */
  active_tenant_id: string;
  /** Phase 1.F: 5-tier role for the active tenant. */
  role: EqRole;
  /** Phase 1.F: EQ Solutions internal cross-tenant flag. */
  is_platform_admin: boolean;
  /** All active memberships this user has, used by the UI to offer tenant switching. */
  memberships: SessionMembership[];
  /**
   * Carried from 2026-05-28 for cookie-based cross-app SSO.
   * Lets Service and Field verify the shell cookie locally without a
   * round-trip to the canonical DB. Absent on pre-migration cookies —
   * verify-shell-session upgrades them transparently on next page load.
   */
  email?: string;
  /** Display name — same caveat as email above. */
  name?: string | null;
  exp: number;
}

export interface ShellTokenPayload {
  kind: 'shell-token';
  name: string;
  /**
   * Legacy 2-tier field. EQ Field's existing `verify-shell-token`
   * handler (eq-field-app PR #106) reads this and only this from the
   * payload today. Kept verbatim for backward compatibility.
   *
   * Mapping rule (Phase 1.F, per IDENTITY-MODEL.md §7.1):
   *   manager / is_platform_admin = true  → 'supervisor'
   *   supervisor                          → 'supervisor'
   *   employee / apprentice / labour_hire → 'staff'
   */
  role: 'staff' | 'supervisor';
  /**
   * Phase 1.F: the full 5-tier canonical role. Field doesn't consume
   * this YET — the follow-up Milmlow/eq-field-app PR will add a
   * verify-shell-token v2 path that honours it. Until then it travels
   * the wire harmlessly (JSON.parse ignores unknown fields).
   */
  eq_role: EqRole;
  /**
   * Phase 1.F: platform-admin flag for cross-tenant access. Same
   * caveat as eq_role above — Field doesn't read it yet, but it ships
   * here so the same token shape works once Field catches up.
   */
  is_platform_admin: boolean;
  /**
   * 2026-05-22 — Wave 5: target Field tenant slug, chosen by the user
   * via the shell-side picker on /core/field. NOT derived from the
   * caller's shell tenant_id (that auto-routing model was rejected —
   * see PR #11 / #13 revert chain). Field's v3.5.17 _consumeShellToken
   * cross-checks this against TENANT.ORG_SLUG (set from the iframe
   * URL's ?tenant= param) and rejects on mismatch.
   *
   * The mint endpoint validates against a hardcoded allow-list of
   * Field organisation slugs ('eq', 'demo-trades', 'melbourne'); the
   * value here is therefore trusted by Field. If a new Field tenant
   * is added, update both the allow-list and the picker cards.
   */
  tenant_slug: string;
  exp: number;
}

function sign(payloadJson: string): string {
  if (!SECRET_SALT) throw new Error('EQ_SECRET_SALT is not set — server misconfigured');
  return createHmac('sha256', SECRET_SALT).update(payloadJson).digest('hex');
}

/**
 * Shared verifier for the short-lived, "kind"-tagged exchange tokens
 * (tenant-selection, quotes-token, totp-challenge). Those three verifiers were
 * byte-identical except for the kind tag, the payload type, and a final
 * required-field check — so they now delegate here. The wire format and every
 * check (split → constant-time sig compare → JSON.parse → kind → exp → field)
 * are unchanged and run in the same order; this only removes the copy-paste.
 *
 * verifySessionToken is deliberately NOT routed through here: it has no kind
 * tag and defaults active_tenant_id + memberships on the way out.
 */
function verifyKindToken<T extends { kind: string; exp: number }>(
  token: string | null | undefined,
  kind: T['kind'],
  hasRequiredFields: (data: T) => boolean,
): T | null {
  if (!token) return null;
  try {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return null;
    const json = Buffer.from(b64, 'base64').toString();
    const expected = sign(json);
    if (!sigsEqual(expected, sig)) return null;
    const data = JSON.parse(json) as T;
    if (data.kind !== kind) return null;
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    if (!hasRequiredFields(data)) return null;
    return data;
  } catch {
    return null;
  }
}

export function signSessionToken(payload: SessionPayload): string {
  const json = JSON.stringify(payload);
  const sig = sign(json);
  return Buffer.from(json).toString('base64') + '.' + sig;
}

export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  try {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return null;
    const json = Buffer.from(b64, 'base64').toString();
    const expected = sign(json);
    if (!sigsEqual(expected, sig)) return null;
    const data = JSON.parse(json) as SessionPayload;
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    if (!data.user_id || !data.tenant_id) return null;
    // Phase 1.F: role + is_platform_admin are required. Older cookies
    // (pre-1.F) won't have them — those force a re-login. The shell
    // already rolls cookies on every login, so this only impacts users
    // mid-session at deploy time — they get a single re-auth and move on.
    if (!data.role) return null;
    if (typeof data.is_platform_admin !== 'boolean') return null;
    if (!data.active_tenant_id) data.active_tenant_id = data.tenant_id;
    if (!Array.isArray(data.memberships)) {
      data.memberships = [{ tenant_id: data.tenant_id, role: data.role }];
    }
    return data;
  } catch {
    return null;
  }
}

export function signShellToken(payload: ShellTokenPayload): string {
  const json = JSON.stringify(payload);
  const sig = sign(json);
  return Buffer.from(json).toString('base64') + '.' + sig;
}

/**
 * Service iframe handshake token — minted by mint-service-iframe-token,
 * validated by eq-solves-service's /.netlify/functions/shell-auth.
 *
 * Contains enough identity for Service to look up the user by email and
 * create a Supabase session on their behalf. TTL is intentionally short
 * (60s) — it's a one-shot exchange token, not a session credential.
 */
export interface ServiceTokenPayload {
  kind: 'service-token';
  email: string;
  name: string | null;
  eq_role: EqRole;
  is_platform_admin: boolean;
  shell_tenant_id: string;
  exp: number;
}

export function signServiceToken(payload: ServiceTokenPayload): string {
  const json = JSON.stringify(payload);
  const sig = sign(json);
  return Buffer.from(json).toString('base64') + '.' + sig;
}

/**
 * Short-lived token returned by shell-login when the user belongs to
 * more than one tenant. Carried by the client back to select-tenant so
 * the server can confirm the user authenticated within the last 5 min
 * without forcing them to retype their PIN.
 */
export interface TenantSelectionTokenPayload {
  kind: 'tenant-selection';
  user_id: string;
  exp: number;
}

export function signTenantSelectionToken(payload: TenantSelectionTokenPayload): string {
  const json = JSON.stringify(payload);
  const sig = sign(json);
  return Buffer.from(json).toString('base64') + '.' + sig;
}

export function verifyTenantSelectionToken(token: string | null | undefined): TenantSelectionTokenPayload | null {
  return verifyKindToken<TenantSelectionTokenPayload>(token, 'tenant-selection', (d) => !!d.user_id);
}

/**
 * Quotes iframe handshake token — minted by mint-quotes-iframe-token (shell-side).
 * Validated by EQ Quotes' receiver route once Phase 3 ships.
 *
 * Carries full identity so Quotes can establish a session without a round-trip
 * to canonical. TTL is intentionally 60s — one-shot exchange only.
 */
export interface QuotesTokenPayload {
  kind: 'quotes-token';
  user_id: string;
  tenant_id: string;
  role: EqRole;
  eq_role: EqRole;
  is_platform_admin: boolean;
  name: string | null;
  exp: number;
}

export function signQuotesToken(payload: QuotesTokenPayload): string {
  const json = JSON.stringify(payload);
  const sig = sign(json);
  return Buffer.from(json).toString('base64') + '.' + sig;
}

export function verifyQuotesToken(token: string | null | undefined): QuotesTokenPayload | null {
  return verifyKindToken<QuotesTokenPayload>(token, 'quotes-token', (d) => !!d.user_id && !!d.tenant_id);
}

/**
 * Short-lived token returned by shell-login when the user has TOTP enrolled.
 * The client carries it to challenge-totp after the user enters their code.
 * TTL is 5 minutes — enough for a user to find their authenticator app.
 *
 * Carries user_id only; challenge-totp re-fetches tenant/memberships after
 * TOTP verify (same as shell-login does after PIN verify) rather than
 * trusting a larger payload over the wire.
 */
export interface TotpChallengeTokenPayload {
  kind: 'totp-challenge';
  user_id: string;
  exp: number;
}

export function signTotpChallengeToken(payload: TotpChallengeTokenPayload): string {
  const json = JSON.stringify(payload);
  const sig = sign(json);
  return Buffer.from(json).toString('base64') + '.' + sig;
}

export function verifyTotpChallengeToken(token: string | null | undefined): TotpChallengeTokenPayload | null {
  return verifyKindToken<TotpChallengeTokenPayload>(token, 'totp-challenge', (d) => !!d.user_id);
}

// Parses the eq_shell_session cookie value out of a Cookie header.
// Cookie header looks like: "foo=bar; eq_shell_session=<token>; baz=qux".
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  const pairs = header.split(/;\s*/);
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq);
    if (name === 'eq_shell_session') {
      return pair.slice(eq + 1);
    }
  }
  return null;
}

export function hasSecretSalt(): boolean {
  return !!SECRET_SALT;
}
