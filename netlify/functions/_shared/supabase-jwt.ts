// Mints Supabase-compatible JWTs so the browser (and external modules
// like the Cards Flutter app) can talk directly to Supabase REST/RPC
// endpoints with tenant scope enforced by RLS.
//
// Format: HS256 JWT signed with SUPABASE_JWT_SECRET (the eq-canonical
// project's JWT secret, distinct from SERVICE_ROLE_KEY). Supabase
// accepts any token signed with this secret as authenticated, reads
// claims via auth.jwt(), and applies RLS policies that reference them.
//
// PHASE 1.F change (2026-05-20): the JWT now uses `app_metadata` for
// tenant scope, not `user_metadata`. Per IDENTITY-MODEL.md §6.2, user
// metadata is end-user-editable and not safe for security contexts —
// the canonical RLS sweep in migration `2026_05_20_phase_1f_unified_identity`
// moved every policy to read app_metadata.tenant_id. This file emits
// matching claims so the browser JWT actually authorises the right rows.
//
// Claim shape (post-1.F):
//
//   {
//     sub:           "<user_id>"            // auth.uid()
//     role:          "authenticated"        // Postgres role slot
//     aud:           "authenticated"        // Supabase audience
//     app_metadata: {
//       tenant_id:         "<uuid>"
//       eq_role:           "manager" | "supervisor" | "employee" | "apprentice" | "labour_hire"
//       is_platform_admin: boolean
//     },
//     iat:           <unix-seconds>
//     exp:           <unix-seconds>
//   }
//
// RLS policies read claims as:
//   (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
//   (auth.jwt() -> 'app_metadata' ->> 'eq_role')
//   (auth.jwt() -> 'app_metadata' ->> 'is_platform_admin')::boolean
//
// TTL change (2026-05-20): 15-minute default per the unified identity
// spec. Was 1h pre-1.F. The shell + Cards re-mint via
// /.netlify/functions/mint-supabase-jwt on demand; the session cookie
// (7d HMAC) is the long-lived credential, not the Supabase JWT.
// Cards's offline-tolerant flow uses the most-recent JWT cached in
// flutter_secure_storage and refreshes opportunistically when online —
// patchy-signal scenarios are accommodated by the cache, not by a
// longer TTL. If real-world Cards use shows 15-min is too tight, bump
// to 60 min and document in IDENTITY-MODEL.md §11.5.
//
// Implementation note: we deliberately don't pull in `jose` or
// `jsonwebtoken` here. JWT signing for HS256 is short and the deploy
// already uses node:crypto for the session HMAC, so adding a new
// runtime dep just to format the same primitive differently isn't
// worth it.

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { EqRole } from './supabase.js';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

const SUPABASE_JWT_TTL_SECONDS = 15 * 60; // 15 minutes (Phase 1.F default)

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface SupabaseJwtClaims {
  sub: string;
  role: 'authenticated';
  aud: 'authenticated';
  jti: string;
  app_metadata: {
    tenant_id: string;
    eq_role: EqRole;
    is_platform_admin: boolean;
    source_app?: string;
  };
  iat: number;
  exp: number;
}

export interface MintedJwt {
  token: string;
  jti: string;
  exp: number;
}

/**
 * Mint a fresh Supabase JWT for a given user. The JWT is short-lived
 * (15min default) and signed with the canonical project's JWT secret.
 *
 * S2.D — JWT now includes a jti (token-unique id) so the token can be
 * revoked before its TTL via shell_control.revoked_sessions +
 * eq_is_session_revoked() check in verify-shell-session.
 *
 * Optional ttlSeconds override — caps at 900 (15min) by default;
 * /.netlify/functions/mint-supabase-jwt enforces an explicit ceiling.
 *
 * Optional sourceApp — recorded in app_metadata.source_app + the
 * mint_audit_log row so we know which app initiated the mint.
 */
export function signSupabaseJwt(
  userId: string,
  tenantId: string,
  eqRole: EqRole,
  isPlatformAdmin: boolean,
  ttlSeconds: number = SUPABASE_JWT_TTL_SECONDS,
  sourceApp: string = 'shell',
): MintedJwt {
  if (!JWT_SECRET) {
    throw new Error(
      'Server misconfigured — SUPABASE_JWT_SECRET must be set on the eq-shell Netlify deploy. ' +
        'Find it in the Supabase dashboard under Settings → API → JWT Settings → JWT Secret.',
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const jti = randomUUID();
  const claims: SupabaseJwtClaims = {
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    jti,
    app_metadata: {
      tenant_id: tenantId,
      eq_role: eqRole,
      is_platform_admin: isPlatformAdmin,
      source_app: sourceApp,
    },
    iat: now,
    exp: now + ttlSeconds,
  };

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = base64UrlEncode(
    createHmac('sha256', JWT_SECRET).update(signingInput).digest(),
  );

  return { token: `${signingInput}.${signature}`, jti, exp: claims.exp };
}

export function hasSupabaseJwtSecret(): boolean {
  return !!JWT_SECRET;
}

/**
 * Verify a Supabase JWT signed with SUPABASE_JWT_SECRET. Returns the
 * decoded claims on success, null on any failure (bad signature, expired,
 * malformed, missing secret). The null-on-failure shape mirrors
 * verifySessionToken so callers can `?? null` and fall through to other
 * auth methods uniformly.
 *
 * Used by intake-commit (and any future non-browser endpoint) to accept
 * Authorization: Bearer <jwt> as an alternative to session cookie auth.
 * Cards mobile and the future eq-quotes Flask integration both already
 * hold short-lived Supabase JWTs minted by /.netlify/functions/mint-supabase-jwt,
 * so this lets them call into shell-side endpoints without needing to
 * also juggle the eq_shell_session cookie.
 *
 * Does NOT check shell_control.revoked_sessions — that's an async DB
 * lookup not appropriate inside a tight auth-decode path. If a caller
 * needs revocation semantics it should do that check itself, the way
 * verify-shell-session does.
 */
export function verifySupabaseJwt(token: string | null | undefined): SupabaseJwtClaims | null {
  if (!token || !JWT_SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  // Verify signature first (constant-time).
  let providedSig: Buffer;
  let expectedSig: Buffer;
  try {
    providedSig = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expectedSig = createHmac('sha256', JWT_SECRET).update(`${headerB64}.${payloadB64}`).digest();
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  // Decode + structural validate the claims.
  let claims: SupabaseJwtClaims;
  try {
    const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    claims = JSON.parse(json) as SupabaseJwtClaims;
  } catch {
    return null;
  }

  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  if (claims.role !== 'authenticated') return null;
  if (claims.aud !== 'authenticated') return null;
  if (typeof claims.exp !== 'number') return null;
  if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
  if (!claims.app_metadata || typeof claims.app_metadata !== 'object') return null;
  const meta = claims.app_metadata;
  if (typeof meta.tenant_id !== 'string' || !meta.tenant_id) return null;
  if (typeof meta.eq_role !== 'string') return null;
  if (typeof meta.is_platform_admin !== 'boolean') return null;

  return claims;
}

/**
 * Pull a Bearer JWT out of the Authorization header. Returns null if
 * absent or malformed shape.
 */
export function readBearerJwt(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  const token = m[1].trim();
  return token || null;
}

export const SUPABASE_JWT_TTL_SECONDS_EXPORTED = SUPABASE_JWT_TTL_SECONDS;
