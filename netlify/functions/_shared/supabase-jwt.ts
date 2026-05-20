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

import { createHmac } from 'node:crypto';
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
  app_metadata: {
    tenant_id: string;
    eq_role: EqRole;
    is_platform_admin: boolean;
  };
  iat: number;
  exp: number;
}

/**
 * Mint a fresh Supabase JWT for a given user. The JWT is short-lived
 * (15min default) and signed with the canonical project's JWT secret.
 *
 * Optional ttlSeconds override — caps at 900 (15min) by default;
 * /.netlify/functions/mint-supabase-jwt enforces an explicit ceiling.
 */
export function signSupabaseJwt(
  userId: string,
  tenantId: string,
  eqRole: EqRole,
  isPlatformAdmin: boolean,
  ttlSeconds: number = SUPABASE_JWT_TTL_SECONDS,
): string {
  if (!JWT_SECRET) {
    throw new Error(
      'Server misconfigured — SUPABASE_JWT_SECRET must be set on the eq-shell Netlify deploy. ' +
        'Find it in the Supabase dashboard under Settings → API → JWT Settings → JWT Secret.',
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const claims: SupabaseJwtClaims = {
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    app_metadata: {
      tenant_id: tenantId,
      eq_role: eqRole,
      is_platform_admin: isPlatformAdmin,
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

  return `${signingInput}.${signature}`;
}

export function hasSupabaseJwtSecret(): boolean {
  return !!JWT_SECRET;
}

export const SUPABASE_JWT_TTL_SECONDS_EXPORTED = SUPABASE_JWT_TTL_SECONDS;
