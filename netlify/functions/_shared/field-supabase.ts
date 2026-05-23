// Service-role Supabase client for the EQ Field project (ktmjmdzqrogauaevbktn).
// Used exclusively by cards-approve-staff to write people + qualifications
// rows after an admin approves a Cards profile.
//
// Env vars required on the eq-shell Netlify deploy:
//   FIELD_SUPABASE_URL          — https://ktmjmdzqrogauaevbktn.supabase.co
//   FIELD_SUPABASE_SERVICE_ROLE_KEY — from Field project API settings

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient<any, any, any> | null = null;

export function getFieldServiceClient(): SupabaseClient<any, any, any> {
  if (_client) return _client;

  const url = process.env.FIELD_SUPABASE_URL;
  const key = process.env.FIELD_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Server misconfigured — FIELD_SUPABASE_URL and FIELD_SUPABASE_SERVICE_ROLE_KEY must be set on the eq-shell Netlify deploy.',
    );
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  });
  return _client;
}
