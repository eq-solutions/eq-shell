// Service-role Supabase client for the EQ Shell canonical project.
// Every Netlify function in this directory uses ONE shared instance,
// initialised lazily so missing env vars surface as a runtime error
// at first-call (with a clear message) rather than at import time.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// We type the cache as `any`-schema because we pin db.schema='shell_control'
// at construction; supabase-js infers a different generic when that's set
// and the strict typing fights cross-schema usage like .schema('app_data').
let _client: SupabaseClient<any, any, any> | null = null;

export function getServiceClient(): SupabaseClient<any, any, any> {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Server misconfigured — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the eq-shell Netlify deploy.'
    );
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Default to shell_control schema where the auth tables live
    // (users, tenants, module_entitlements, user_invites, etc.) after
    // the Unit 2 schema split. Functions that need app_data still
    // call .schema('app_data') explicitly.
    //
    // RPCs ALSO honour the default schema — `sb.rpc('foo')` resolves
    // to `shell_control.foo`, not `public.foo`. If your RPC lives in
    // public (as the audit/intake RPCs do), call it as
    // `sb.schema('public').rpc('foo', ...)`.
    db: { schema: 'shell_control' },
  });
  return _client;
}

/**
 * Five-tier role enum from the EQ unified identity model.
 *
 * Source of truth: `eq-context/eq/identity/IDENTITY-MODEL.md §3`. These
 * keys mirror the eq_role Postgres enum on eq-canonical (created in
 * migration `2026_05_20_phase_1f_unified_identity`).
 *
 * Client-side mirror lives in `src/permissions.ts` — keep them in sync
 * when adding a tier. Adding a tier is a spec-level change, not a
 * code-level one — discuss before editing.
 */
export type EqRole =
  | 'manager'
  | 'supervisor'
  | 'employee'
  | 'apprentice'
  | 'labour_hire';

export interface CanonicalUser {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  tenant_id: string;
  role: EqRole;
  is_platform_admin: boolean;
  active: boolean;
  pin_hash: string | null;
  last_login_at: string | null;
}

export interface CanonicalTenant {
  id: string;
  slug: string;
  name: string;
  brand_color: string | null;
  brand_logo_url: string | null;
  tier: 'standard' | 'advanced' | 'enterprise';
  active: boolean;
}

export interface CanonicalEntitlement {
  module: string;
  enabled: boolean;
}
