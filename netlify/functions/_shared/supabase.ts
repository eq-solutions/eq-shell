// Service-role Supabase client for the EQ Shell canonical project.
// Every Netlify function in this directory uses ONE shared instance,
// initialised lazily so missing env vars surface as a runtime error
// at first-call (with a clear message) rather than at import time.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
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
  });
  return _client;
}

export interface CanonicalUser {
  id: string;
  email: string;
  tenant_id: string;
  role: string;
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
  active: boolean;
}

export interface CanonicalEntitlement {
  module: string;
  enabled: boolean;
}
