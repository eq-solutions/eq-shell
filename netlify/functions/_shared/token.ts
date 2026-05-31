// Shared HMAC token + session cookie helpers for the EQ Shell auth layer.
//
// This module is the single source of truth for how the shell signs and
// verifies the short-lived handoff tokens (iframe SSO) and the long-lived
// session cookie. A bug here breaks auth across every EQ product, so the
// invariants are documented inline and covered by token.test.ts.
//
// Token taxonomy:
//   - Session cookie   (eq_shell_session)     — 7-day, HttpOnly, the master credential
//   - Shell iframe     (mint-iframe-token)    — 60s, EQ Field handoff
//   - Service iframe   (mint-service-iframe)  — 60s, EQ Service handoff
//   - Cards iframe     (mint-cards-iframe)    — 60s, EQ Cards handoff
//   - TOTP challenge   (challenge-totp)       — 5min, 2FA step-up
//   - Tenant selection (select-tenant)        — 5min, multi-tenant disambiguation
//
// Every token is `<base64url(json)>.<base64url(hmac-sha256)>` with the HMAC
// keyed on EQ_SECRET_SALT. Verification is constant-time + checks expiry.

import crypto from 'node:crypto';

const SECRET_SALT = process.env.EQ_SECRET_SALT ?? '';

// ──────────────────────────────────────────────────────────────────────
// Secret-salt guard
// ──────────────────────────────────────────────────────────────────────

export function hasSecretSalt(): boolean {
  return SECRET_SALT.length > 0;
}

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface SessionPayload {
  user_id:            string;
  tenant_id:          string;
  role:               string;
  is_platform_admin:  boolean;
  exp:                number;  // epoch ms
}

export interface ShellTokenPayload {
  kind:      'shell-iframe';
  user_id:   string;
  tenant_id: string;
  name:      string;
  role:      string;
  exp:       number;
}

export interface ServiceTokenPayload {
  kind:      'service-iframe';
  user_id:   string;
  tenant_id: string;
  name:      string;
  role:      string;
  exp:       number;
}

export interface CardsTokenPayload {
  kind:      'cards-iframe';
  user_id:   string;
  tenant_id: string;
  name:      string;
  role:      string;
  exp:       number;
}

export interface TotpChallengePayload {
  kind:    'totp-challenge';
  user_id: string;
  exp:     number;
}

export interface TenantSelectionPayload {
  kind:      'tenant-selection';
  user_id:   string;
  exp:       number;
}

// ──────────────────────────────────────────────────────────────────────
// Low-level sign / verify
// ──────────────────────────────────────────────────────────────────────

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payloadJson: string): string {
  // Fail closed: never sign with an empty key. Callers gate on hasSecretSalt(),
  // but enforcing it here guarantees a misconfigured deploy can't mint tokens
  // signed with an empty HMAC key.
  if (!SECRET_SALT) throw new Error('EQ_SECRET_SALT is not configured');
  return crypto.createHmac('sha256', SECRET_SALT).update(payloadJson).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Generic verify: returns the parsed payload if the signature + expiry are
// valid, else null. Callers narrow by `kind`.
function verifyRaw(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  // Fail closed: with no key, a token signed with an empty HMAC key would
  // verify — reject everything when the salt is missing rather than fail open.
  if (!SECRET_SALT) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = sign(Buffer.from(body, 'base64url').toString('utf8'));
  if (!safeEqual(sig, expected)) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  // Expiry check (all tokens carry `exp` in epoch ms).
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  if (Date.now() > exp) return null;
  return payload;
}

// Generic kind-token verify: verifyRaw + a `kind` match + required string
// fields. The shell / service / cards / totp / tenant-selection verifiers
// below are thin wrappers over this — identical logic, only the kind and the
// required string fields differ.
function verifyKindToken<T>(
  token: string | null | undefined,
  kind: string,
  stringFields: readonly string[],
): T | null {
  const p = verifyRaw(token);
  if (!p) return null;
  if (p.kind !== kind) return null;
  for (const f of stringFields) {
    if (typeof p[f] !== 'string') return null;
  }
  return p as unknown as T;
}

// ──────────────────────────────────────────────────────────────────────
// Session cookie (the master credential)
// ──────────────────────────────────────────────────────────────────────

export function signSessionToken(payload: Omit<SessionPayload, 'exp'>, ttlMs = 7 * 24 * 60 * 60 * 1000): string {
  const full: SessionPayload = { ...payload, exp: Date.now() + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(full)));
  return `${body}.${sign(JSON.stringify(full))}`;
}

export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  const p = verifyRaw(token);
  if (!p) return null;
  // Structural checks — every required field must be the right type.
  if (
    typeof p.user_id !== 'string' ||
    typeof p.tenant_id !== 'string' ||
    typeof p.role !== 'string' ||
    typeof p.is_platform_admin !== 'boolean'
  ) {
    return null;
  }
  return p as unknown as SessionPayload;
}

// ──────────────────────────────────────────────────────────────────────
// Iframe handoff tokens (60s)
// ──────────────────────────────────────────────────────────────────────

export function signShellToken(payload: Omit<ShellTokenPayload, 'exp' | 'kind'>, ttlMs = 60_000): string {
  const full: ShellTokenPayload = { ...payload, kind: 'shell-iframe', exp: Date.now() + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(full)));
  return `${body}.${sign(JSON.stringify(full))}`;
}

export function verifyShellToken(token: string | null | undefined): ShellTokenPayload | null {
  return verifyKindToken<ShellTokenPayload>(token, 'shell-iframe', ['user_id', 'tenant_id', 'name', 'role']);
}

export function signServiceToken(payload: Omit<ServiceTokenPayload, 'exp' | 'kind'>, ttlMs = 60_000): string {
  const full: ServiceTokenPayload = { ...payload, kind: 'service-iframe', exp: Date.now() + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(full)));
  return `${body}.${sign(JSON.stringify(full))}`;
}

export function verifyServiceToken(token: string | null | undefined): ServiceTokenPayload | null {
  return verifyKindToken<ServiceTokenPayload>(token, 'service-iframe', ['user_id', 'tenant_id', 'name', 'role']);
}

export function signCardsToken(payload: Omit<CardsTokenPayload, 'exp' | 'kind'>, ttlMs = 60_000): string {
  const full: CardsTokenPayload = { ...payload, kind: 'cards-iframe', exp: Date.now() + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(full)));
  return `${body}.${sign(JSON.stringify(full))}`;
}

export function verifyCardsToken(token: string | null | undefined): CardsTokenPayload | null {
  return verifyKindToken<CardsTokenPayload>(token, 'cards-iframe', ['user_id', 'tenant_id', 'name', 'role']);
}

// ──────────────────────────────────────────────────────────────────────
// TOTP challenge (5min step-up)
// ──────────────────────────────────────────────────────────────────────

export function signTotpChallengeToken(payload: Omit<TotpChallengePayload, 'exp' | 'kind'>, ttlMs = 5 * 60_000): string {
  const full: TotpChallengePayload = { ...payload, kind: 'totp-challenge', exp: Date.now() + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(full)));
  return `${body}.${sign(JSON.stringify(full))}`;
}

export function verifyTotpChallengeToken(token: string | null | undefined): TotpChallengePayload | null {
  return verifyKindToken<TotpChallengePayload>(token, 'totp-challenge', ['user_id']);
}

// ──────────────────────────────────────────────────────────────────────
// Tenant selection (5min, multi-tenant disambiguation)
// ──────────────────────────────────────────────────────────────────────

export function signTenantSelectionToken(payload: Omit<TenantSelectionPayload, 'exp' | 'kind'>, ttlMs = 5 * 60_000): string {
  const full: TenantSelectionPayload = { ...payload, kind: 'tenant-selection', exp: Date.now() + ttlMs };
  const body = b64url(Buffer.from(JSON.stringify(full)));
  return `${body}.${sign(JSON.stringify(full))}`;
}

export function verifyTenantSelectionToken(token: string | null | undefined): TenantSelectionPayload | null {
  return verifyKindToken<TenantSelectionPayload>(token, 'tenant-selection', ['user_id']);
}

// ──────────────────────────────────────────────────────────────────────
// Cookie helpers
// ──────────────────────────────────────────────────────────────────────

export function readSessionCookie(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(/(?:^|;\s*)eq_shell_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// (signing helper for the cookie attributes lives in cookie.ts)
