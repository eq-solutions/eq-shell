// Shared HMAC token helpers for the EQ Shell Netlify functions.
//
// Token shapes produced here:
//
//   1. Session cookie payload — { user_id, tenant_id, exp }
//      Set by shell-login, validated by verify-shell-session.
//      Lives in the eq_shell_session cookie on .eq.solutions.
//      Signed with EQ_SESSION_SALT (falls back to EQ_SECRET_SALT).
//
//   2. Field iframe handoff token — RETIRED (Phase 3/4 HMAC retirement; verified
//      live 2026-06-24). The Field iframe handoff is now a short-lived Supabase
//      JWT minted by token-exchange.ts (HS256, SUPABASE_JWT_SECRET, 60s TTL);
//      Field's verify-pin (action="verify-shell-token") verifies that JWT.
//      The HMAC ShellTokenPayload + signShellToken() below are DEAD CODE — no
//      caller in netlify/functions; mint-iframe-token.ts removed from the repo.
//      Retained only until EQ_SECRET_SALT is retired.
//
//   3. Service bridge token — { iss, aud, email, tenant_slug, exp }
//      Signed with EQ_SHELL_BRIDGE_SECRET (already isolated — no EQ_SECRET_SALT fallback).
//
//   4. Quotes handoff token — { kind: 'quotes-token', ... }
//      Signed with EQ_QUOTES_HANDOFF_KEY (falls back to EQ_SECRET_SALT).
//
//   5. Internal short-lived tokens (tenant-selection, totp-challenge, trusted-device)
//      Signed with EQ_SESSION_SALT (falls back to EQ_SECRET_SALT) — same family as the
//      session cookie since they only travel within the shell login flow.
//
// All shapes use the same wire format: base64(JSON payload) + "." + hex(HMAC-SHA256).
//
// S2-9: Per-consumer key isolation. Each token family now has its own env var so
// a key compromise on one consumer cannot be used to forge tokens in another.
// All new vars fall back to EQ_SECRET_SALT so existing deployments continue to work
// without any env-var changes. Set the per-consumer vars on Netlify to isolate.
//
// To generate a new key (run locally, never commit the value):
//   openssl rand -hex 32
//
// Required env vars per consumer:
//   EQ_SESSION_SALT          — session cookies + internal shell tokens
//   EQ_FIELD_HANDOFF_KEY     — LEGACY/unused: Field handoff is now a Supabase JWT (token-exchange.ts); dead pending EQ_SECRET_SALT retirement
//   EQ_SERVICE_HANDOFF_KEY   — reserved for future service iframe tokens
//   EQ_QUOTES_HANDOFF_KEY    — quotes iframe handoff tokens (must also be set in eq-quotes)
//   EQ_SHELL_BRIDGE_SECRET   — service bridge tokens (already existed; no EQ_SECRET_SALT fallback)

import { createHmac, timingSafeEqual } from 'node:crypto';

// ── S2-9: Per-consumer key resolution ────────────────────────────────────────
//
// TokenConsumer identifies which env var family to use for signing/verifying.
// keyForConsumer() resolves: per-consumer var → EQ_SECRET_SALT legacy fallback.
// The fallback ensures zero breakage on existing deploys until new vars are set.
//
// The _NEXT suffix convention (zero-downtime rotation) applies to session only
// today (via EQ_SECRET_SALT_NEXT). Per-consumer _NEXT vars can be added when
// a rotation is initiated on a given consumer — see S1-3 runbook pattern.

export type TokenConsumer =
  | 'session'          // session cookies + internal shell tokens (tenant-selection, totp, trusted-device)
  | 'field-handoff'    // field iframe handoff (shell → eq-solves-field)
  | 'service-handoff'  // service iframe handoff (reserved — shell → eq-solves-service)
  | 'quotes-handoff'   // quotes iframe handoff (shell → eq-quotes)
  | 'shell-bridge';    // service bridge token — handled separately via EQ_SHELL_BRIDGE_SECRET

// Legacy shared key — used as the fallback for every consumer until per-consumer
// vars are deployed. hasSecretSalt() lets callers probe before use.
const SECRET_SALT = process.env.EQ_SECRET_SALT ?? '';
// S1-3: Startup warning — missing salt should be visible in logs without
// crashing cold starts (a throw here would break every function that imports
// token.ts, even ones that don't sign/verify, e.g. health-check endpoints).
if (!SECRET_SALT) {
  console.warn('[token] WARNING: EQ_SECRET_SALT is not set — all token sign/verify calls will fail');
}

// Optional verify-only fallback for zero-downtime HMAC key rotation (Option A).
// Two-step rotation:
//   Step 1 — set EQ_SECRET_SALT_NEXT = <new key> on all sites and redeploy; every
//             site now accepts tokens signed with the old OR new key.
//   Step 2 — promote: set EQ_SECRET_SALT = <new key>, clear EQ_SECRET_SALT_NEXT
//             on all sites and redeploy. Done — no forced re-login, no handoff gap.
// Absent in production until rotation is explicitly initiated. Never used for signing.
// Ref: eq-context/security-secret-rotation-runbook-2026-05-31.md
const SECRET_SALT_NEXT = process.env.EQ_SECRET_SALT_NEXT ?? null;

/**
 * Resolve the HMAC signing key for a given consumer.
 *
 * Resolution order:
 *   1. Per-consumer env var (e.g. EQ_SESSION_SALT)
 *   2. Legacy EQ_SECRET_SALT fallback
 *
 * The fallback means zero env-var changes are needed on existing deploys.
 * Set the per-consumer var to isolate that consumer's key from all others.
 *
 * 'shell-bridge' is NOT handled here — it uses EQ_SHELL_BRIDGE_SECRET directly
 * (no EQ_SECRET_SALT fallback by design; the bridge secret was always separate).
 */
function keyForConsumer(consumer: Exclude<TokenConsumer, 'shell-bridge'>): string {
  let key: string;
  switch (consumer) {
    case 'session':
      key = process.env.EQ_SESSION_SALT || SECRET_SALT;
      break;
    case 'field-handoff':
      key = process.env.EQ_FIELD_HANDOFF_KEY || SECRET_SALT;
      break;
    case 'service-handoff':
      key = process.env.EQ_SERVICE_HANDOFF_KEY || SECRET_SALT;
      break;
    case 'quotes-handoff':
      key = process.env.EQ_QUOTES_HANDOFF_KEY || SECRET_SALT;
      break;
  }
  if (!key) {
    console.warn(`[token] WARNING: No key configured for consumer "${consumer}" and EQ_SECRET_SALT is also missing — sign/verify will fail`);
  }
  return key;
}

/**
 * Optional _NEXT verify-only fallback key for a given consumer.
 * Today only the 'session' consumer has a _NEXT var (EQ_SECRET_SALT_NEXT).
 * Returns null for all other consumers — extend as rotations are initiated.
 */
function nextKeyForConsumer(consumer: Exclude<TokenConsumer, 'shell-bridge'>): string | null {
  if (consumer === 'session') return SECRET_SALT_NEXT;
  // Future: case 'field-handoff': return process.env.EQ_FIELD_HANDOFF_KEY_NEXT ?? null;
  return null;
}

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

/**
 * Per-tenant runtime config. Stored in shell_control.tenant_config and
 * embedded in the session token so all four session-minting functions can
 * expose it to downstream functions without an extra DB round-trip.
 */
export interface TenantConfig {
  feature_flags: Record<string, Record<string, unknown>>;
  field_settings: {
    timezone: string;
    currency: string;
    week_start: 'monday' | 'sunday';
  };
}

export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  feature_flags: {},
  field_settings: {
    timezone: 'Australia/Sydney',
    currency: 'AUD',
    week_start: 'monday',
  },
};

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
  /**
   * Extra permission keys granted via security groups.
   * Fetched from shell_control.user_security_groups + security_group_perms
   * at login / verify-session time. Absent on pre-security-groups cookies —
   * verify-shell-session re-fetches and upgrades them transparently.
   */
  extra_perms?: string[];
  /**
   * Per-tenant runtime config. Absent on pre-provisioning-layer cookies —
   * verify-shell-session fills in DEFAULT_TENANT_CONFIG transparently.
   */
  config: TenantConfig;
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
   * 2026-06-05: security-group permission keys granted to this user (the same
   * extra_perms[] that shell-login / verify-shell-session compute via
   * getUserSecurityGroupPerms). EQ Field's verify-shell-token reads these
   * (v3.5.78) and honours them additively in EQ_PERMS.can() — a group can widen
   * Field access on top of the role, never narrow it. Optional: omitted when the
   * user has no group membership (keeps the token compact).
   */
  extra_perms?: string[];
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
  /**
   * 2026-06-08: Shell UUID of the authenticated user. Carried so Field
   * (and future consumers) can emit a consistent PostHog distinct_id
   * across all EQ apps — UUID is the stable key, email can change.
   * Field reads this additively; existing verify-shell-token paths that
   * don't reference it are unaffected (JSON.parse ignores unknown fields).
   */
  shell_user_id: string;
  /**
   * 2026-06-13: workers.id in eq-canonical — the global identity key for
   * this worker. Carried so Field can match the Shell user to their
   * people/staff record in the tenant's data plane (via canonical_id once
   * the jvkn→ehow sync populates it). Optional — omitted for Shell users
   * with no linked worker record (e.g. platform admins, non-tradie staff).
   */
  canonical_user_id?: string;
  /**
   * 2026-06-13: workers.phone (E.164) from eq-canonical. Fallback
   * identity signal for Field when canonical_user_id→people matching is
   * not yet available. Optional — omitted when absent on the worker record.
   */
  phone?: string;
  exp: number;
}

/**
 * Compute HMAC-SHA256 for the given consumer's primary key.
 * Throws if no key is resolvable (same behaviour as the old `sign()` for EQ_SECRET_SALT).
 */
function sign(payloadJson: string, consumer: Exclude<TokenConsumer, 'shell-bridge'> = 'session'): string {
  const key = keyForConsumer(consumer);
  if (!key) throw new Error(`No HMAC key configured for consumer "${consumer}" — server misconfigured`);
  return createHmac('sha256', key).update(payloadJson).digest('hex');
}

/** Compute HMAC-SHA256 with an explicit key (used by the fallback verifier path). */
function signWithKey(payloadJson: string, key: string): string {
  return createHmac('sha256', key).update(payloadJson).digest('hex');
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
 *
 * S2-9: accepts a consumer parameter so each token family is verified with its
 * own key. Defaults to 'session' to preserve behaviour for callers that haven't
 * been updated yet (no functional change on existing deploys).
 */
function verifyKindToken<T extends { kind: string; exp: number }>(
  token: string | null | undefined,
  kind: T['kind'],
  hasRequiredFields: (data: T) => boolean,
  consumer: Exclude<TokenConsumer, 'shell-bridge'> = 'session',
): T | null {
  if (!token) return null;
  try {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return null;
    const json = Buffer.from(b64, 'base64').toString();
    // Primary key check.
    const primaryOk = sigsEqual(sign(json, consumer), sig);
    // Fallback: retry with the consumer's _NEXT key if primary fails and _NEXT is configured.
    if (!primaryOk) {
      const nextKey = nextKeyForConsumer(consumer);
      if (!nextKey || !sigsEqual(signWithKey(json, nextKey), sig)) return null;
    }
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
  const sig = sign(json, 'session');
  return Buffer.from(json).toString('base64') + '.' + sig;
}

export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  try {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return null;
    const json = Buffer.from(b64, 'base64').toString();
    // Primary key check using the session consumer key (EQ_SESSION_SALT → EQ_SECRET_SALT fallback).
    const primaryOk = sigsEqual(sign(json, 'session'), sig);
    // Fallback: retry with the session consumer's _NEXT key (EQ_SECRET_SALT_NEXT) if primary fails.
    if (!primaryOk) {
      const nextKey = nextKeyForConsumer('session');
      if (!nextKey || !sigsEqual(signWithKey(json, nextKey), sig)) return null;
    }
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
    // Pre-provisioning-layer cookies lack config — fill in the safe default so
    // all downstream callers can read config.field_settings etc. without guards.
    if (!data.config) {
      data.config = DEFAULT_TENANT_CONFIG;
    }
    return data;
  } catch {
    return null;
  }
}

export function signShellToken(payload: ShellTokenPayload): string {
  const json = JSON.stringify(payload);
  // S2-9: field-handoff consumer — signed with EQ_FIELD_HANDOFF_KEY (falls back to EQ_SECRET_SALT).
  // EQ Field's verify-pin must use the same key; update EQ_FIELD_HANDOFF_KEY in eq-solves-field too.
  const sig = sign(json, 'field-handoff');
  return Buffer.from(json).toString('base64') + '.' + sig;
}

// ── Bridge token ─────────────────────────────────────────────────────────────
//
// Lightweight cross-app handshake format. Distinct from ServiceTokenPayload in
// three ways:
//   1. base64url encoding (URL-safe; safe in hash fragments without encoding)
//   2. Signed with EQ_SHELL_BRIDGE_SECRET (separate 256-bit hex key, NOT
//      EQ_SECRET_SALT) — the two apps share this secret, not the whole salt
//   3. Minimal payload: { iss, aud, email, tenant_slug, exp } only — no PII
//      beyond email, no role propagation (receiver resolves role locally)
//
// Wire format: base64url(JSON) + '.' + hex(HMAC-SHA256)
// Key:         process.env.EQ_SHELL_BRIDGE_SECRET  (must match on both deploys)
//
// Zero-downtime rotation (mirrors EQ_SECRET_SALT_NEXT above):
//   Step 1 — set EQ_SHELL_BRIDGE_SECRET_NEXT = <new key> on Shell AND Service and
//             redeploy; both now ACCEPT tokens signed with the old OR new key.
//   Step 2 — promote: set EQ_SHELL_BRIDGE_SECRET = <new key>, clear _NEXT on both
//             and redeploy. No handoff gap. (signing always uses the primary key.)

const BRIDGE_SECRET = process.env.EQ_SHELL_BRIDGE_SECRET ?? '';
// Optional verify-only fallback for zero-downtime EQ_SHELL_BRIDGE_SECRET rotation.
// Absent until a rotation is explicitly initiated; never used for signing.
const BRIDGE_SECRET_NEXT = process.env.EQ_SHELL_BRIDGE_SECRET_NEXT ?? null;

function signBridge(payloadJson: string): string {
  if (!BRIDGE_SECRET) throw new Error('EQ_SHELL_BRIDGE_SECRET is not set — server misconfigured');
  return createHmac('sha256', BRIDGE_SECRET).update(payloadJson).digest('hex');
}

/** Compute the bridge HMAC with an explicit key (verify-only fallback path). */
function signBridgeWithKey(payloadJson: string, key: string): string {
  return createHmac('sha256', key).update(payloadJson).digest('hex');
}

export function hasBridgeSecret(): boolean {
  return !!BRIDGE_SECRET;
}

export interface BridgeTokenPayload {
  iss: 'eq-shell';
  aud: 'service';
  email: string;
  tenant_slug: string;
  /**
   * 2026-06-08: Shell UUID of the authenticated user. Lets Service emit the
   * same PostHog distinct_id as Shell — UUID over email for stability.
   * Service's existing verifyBridgeToken only requires email + tenant_slug
   * so existing in-flight tokens without this field still validate.
   */
  shell_user_id: string;
  exp: number;
}

export function signBridgeToken(payload: BridgeTokenPayload): string {
  const json = JSON.stringify(payload);
  const sig = signBridge(json);
  return Buffer.from(json).toString('base64url') + '.' + sig;
}

export function verifyBridgeToken(token: string | null | undefined): BridgeTokenPayload | null {
  if (!token) return null;
  try {
    const [b64url, sig] = token.split('.');
    if (!b64url || !sig) return null;
    const json = Buffer.from(b64url, 'base64url').toString();
    // Primary key check, with optional EQ_SHELL_BRIDGE_SECRET_NEXT fallback so a
    // bridge-secret rotation doesn't invalidate in-flight handoff tokens.
    const primaryOk = sigsEqual(signBridge(json), sig);
    if (!primaryOk) {
      if (!BRIDGE_SECRET_NEXT || !sigsEqual(signBridgeWithKey(json, BRIDGE_SECRET_NEXT), sig)) return null;
    }
    const data = JSON.parse(json) as BridgeTokenPayload;
    if (data.iss !== 'eq-shell' || data.aud !== 'service') return null;
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    if (!data.email || !data.tenant_slug) return null;
    return data;
  } catch {
    return null;
  }
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
  const sig = sign(json, 'session');
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
  // S2-9: quotes-handoff consumer — signed with EQ_QUOTES_HANDOFF_KEY (falls back to EQ_SECRET_SALT).
  // eq-quotes must use the same key for its receiver validation.
  const sig = sign(json, 'quotes-handoff');
  return Buffer.from(json).toString('base64') + '.' + sig;
}

export function verifyQuotesToken(token: string | null | undefined): QuotesTokenPayload | null {
  return verifyKindToken<QuotesTokenPayload>(token, 'quotes-token', (d) => !!d.user_id && !!d.tenant_id, 'quotes-handoff');
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
  const sig = sign(json, 'session');
  return Buffer.from(json).toString('base64') + '.' + sig;
}

export function verifyTotpChallengeToken(token: string | null | undefined): TotpChallengeTokenPayload | null {
  return verifyKindToken<TotpChallengeTokenPayload>(token, 'totp-challenge', (d) => !!d.user_id);
}

/**
 * Single source for the "user has TOTP enrolled → issue a login challenge"
 * gate. If the user has a confirmed enrolment, returns the standard
 * 5-minute challenge response; otherwise null (no second step needed).
 *
 * Every login door (shell-login PIN, magic-link, phone-otp) calls this so
 * the second-factor gate can never silently diverge between them — a
 * manager required to use 2FA must not be able to skip it by switching
 * sign-in method. The client routes a `requires_totp` response to
 * /totp-challenge, which posts the code + token back to challenge-totp to
 * complete the session (challenge-totp re-fetches tenant/memberships, so
 * only user_id needs to travel on the wire).
 */
export interface TotpChallengeResponse {
  valid: true;
  requires_totp: true;
  totp_challenge_token: string;
}

export function buildTotpChallengeIfEnrolled(user: {
  id: string;
  totp_secret: string | null;
  totp_enrolled_at: string | null;
}): TotpChallengeResponse | null {
  if (!user.totp_enrolled_at || !user.totp_secret) return null;
  const exp = Date.now() + 5 * 60 * 1000; // 5 minutes — enough to open an authenticator app
  return {
    valid: true,
    requires_totp: true,
    totp_challenge_token: signTotpChallengeToken({ kind: 'totp-challenge', user_id: user.id, exp }),
  };
}

/**
 * "Remember this device" token. Set as the eq_shell_trusted_device cookie by
 * challenge-totp ONLY after a user passes a real authenticator code with the
 * 30-day box ticked. On a later login the PIN / phone-OTP doors read it and,
 * if it's valid and bound to the same user, skip the second-factor challenge.
 *
 * Security model — this NEVER replaces the first factor. The doors only consult
 * it once the user has already passed PIN/OTP in the same request, so the cookie
 * alone is useless to a thief: it can only suppress the 2FA step for someone who
 * already proved factor one. The HMAC over { user_id, exp } binds it to one user,
 * so it can't be replayed for a different account, and it's HttpOnly so page JS
 * can't read it. Survives logout by design (that's the point of "remember").
 */
export interface TrustedDeviceTokenPayload {
  kind: 'trusted-device';
  user_id: string;
  exp: number;
}

/** 30 days — the "remember this device" window the 2FA screen offers. */
export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TRUSTED_DEVICE_COOKIE_NAME = 'eq_shell_trusted_device';

export function signTrustedDeviceToken(payload: TrustedDeviceTokenPayload): string {
  const json = JSON.stringify(payload);
  const sig = sign(json, 'session');
  return Buffer.from(json).toString('base64') + '.' + sig;
}

export function verifyTrustedDeviceToken(token: string | null | undefined): TrustedDeviceTokenPayload | null {
  return verifyKindToken<TrustedDeviceTokenPayload>(token, 'trusted-device', (d) => !!d.user_id);
}

/**
 * True when the request carries a valid, unexpired trusted-device cookie bound
 * to this exact user. Used by the login doors to decide whether the 2FA step
 * can be skipped for an already-PIN/OTP-authenticated user.
 */
export function hasTrustedDeviceFor(req: Request, userId: string): boolean {
  const payload = verifyTrustedDeviceToken(readNamedCookie(req, TRUSTED_DEVICE_COOKIE_NAME));
  return !!payload && payload.user_id === userId;
}

// Parses a named cookie value out of a Cookie header.
// Cookie header looks like: "foo=bar; eq_shell_session=<token>; baz=qux".
function readNamedCookie(req: Request, target: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  const pairs = header.split(/;\s*/);
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq);
    if (name === target) {
      return pair.slice(eq + 1);
    }
  }
  return null;
}

export function readSessionCookie(req: Request): string | null {
  return readNamedCookie(req, 'eq_shell_session');
}

export function hasSecretSalt(): boolean {
  return !!SECRET_SALT;
}
