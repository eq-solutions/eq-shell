// Mints Supabase-compatible JWTs so the browser can talk directly to
// Supabase REST/RPC endpoints with tenant scope enforced by RLS.
//
// Format: HS256 JWT signed with SUPABASE_JWT_SECRET (the project's JWT
// secret, distinct from SERVICE_ROLE_KEY). Supabase accepts any token
// signed with this secret as authenticated, reads claims via auth.jwt(),
// and applies RLS policies that reference them.
//
// Claim shape — matches what the canonical RLS policies + the
// eq_intake_commit_batch RPC already expect (per database inspection):
//
//   {
//     sub:           "<user_id>"            // auth.uid()
//     role:          "authenticated"        // Supabase role for RLS
//     aud:           "authenticated"        // Supabase audience
//     user_metadata: { tenant_id: "<uuid>" } // tenant scope claim
//     iat:           <unix-seconds>
//     exp:           <unix-seconds>
//   }
//
// RLS policies read tenant scope as:
//   (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid
//
// Implementation note: we deliberately don't pull in `jose` or
// `jsonwebtoken` here. JWT signing for HS256 is short and the deploy
// already uses node:crypto for the session HMAC, so adding a new
// runtime dep just to format the same primitive differently isn't
// worth it.

import { createHmac } from 'node:crypto';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

const SUPABASE_JWT_TTL_SECONDS = 60 * 60; // 1 hour

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface SupabaseJwtClaims {
  sub: string;
  role: 'authenticated';
  aud: 'authenticated';
  user_metadata: { tenant_id: string };
  iat: number;
  exp: number;
}

export function signSupabaseJwt(userId: string, tenantId: string): string {
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
    user_metadata: { tenant_id: tenantId },
    iat: now,
    exp: now + SUPABASE_JWT_TTL_SECONDS,
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
