// POST /.netlify/functions/worker-profile-push
//
// Called by EQ Cards (Flutter) after every successful profile save.
// Propagates the updated workers row on jvkn to app_data.staff on each
// tenant where this worker has an active org membership.
//
// Why this exists: profiles is the Cards source of truth for worker
// contact data. The DB trigger (sync_profile_fields_to_worker) keeps
// public.workers current on jvkn. This function closes the second half:
// jvkn workers → ehow app_data.staff, so the employer's staff list
// reflects the current email/phone/address — not the approval-day snapshot.
//
// Auth: Supabase JWT from jvkn sent as Authorization: Bearer <token>.
// Verified against jvkn using the service client's auth.getUser().
//
// Fire-and-forget from the caller — always returns 200 so a transient sync
// failure never blocks the worker's profile save.

import { getServiceClient } from './_shared/supabase.js';
import { getTenantDataClientById } from './_shared/tenant-routing.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return json(401, { error: 'Missing authorization' });

  const sb = getServiceClient(); // jvkn admin client (shell_control default schema)

  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return json(401, { error: 'Invalid token' });

  // Read the current workers row — this is what the trigger keeps in sync
  // with public.profiles after every Cards profile save.
  const { data: worker } = await (sb as any).schema('public')
    .from('workers')
    .select('id, email, phone, first_name, last_name, preferred_name, date_of_birth, address_street, address_suburb, address_state, address_postcode, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone')
    .eq('user_id', user.id)
    .maybeSingle() as { data: Record<string, string | null> | null };

  if (!worker) return json(200, { ok: true, synced: 0, reason: 'no_worker_row' });

  // Find all tenants where this worker is an active org member.
  const { data: memberships } = await (sb as any).schema('public')
    .from('org_memberships')
    .select('tenant_id')
    .eq('user_id', user.id)
    .eq('status', 'active') as { data: Array<{ tenant_id: string }> | null };

  if (!memberships?.length) return json(200, { ok: true, synced: 0, reason: 'no_memberships' });

  const tenantIds = [...new Set(memberships.map((m) => m.tenant_id))];

  // Build the update payload — only include fields the worker has filled in.
  // Never send null to overwrite a value the admin may have set manually
  // (e.g. employment type, home base). Only the worker's own contact fields.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (worker.email        != null) patch.email         = worker.email;
  if (worker.phone        != null) patch.phone         = worker.phone;
  if (worker.first_name   != null) patch.first_name    = worker.first_name;
  if (worker.last_name    != null) patch.last_name     = worker.last_name;
  if (worker.preferred_name != null) patch.preferred_name = worker.preferred_name;
  if (worker.date_of_birth  != null) patch.date_of_birth  = worker.date_of_birth;
  if (worker.address_street  != null) patch.address_street  = worker.address_street;
  if (worker.address_suburb  != null) patch.address_suburb  = worker.address_suburb;
  if (worker.address_state   != null) patch.address_state   = worker.address_state;
  if (worker.address_postcode != null) patch.address_postcode = worker.address_postcode;
  if (worker.emergency_contact_name != null)
    patch.emergency_contact_name = worker.emergency_contact_name;
  if (worker.emergency_contact_relationship != null)
    patch.emergency_contact_relationship = worker.emergency_contact_relationship;
  // Column rename: workers.emergency_contact_phone → staff.emergency_contact_mobile
  if (worker.emergency_contact_phone != null)
    patch.emergency_contact_mobile = worker.emergency_contact_phone;

  let synced = 0;
  for (const tenantId of tenantIds) {
    try {
      const tenantDb = await getTenantDataClientById(tenantId, false);
      const { error } = await (tenantDb as any)
        .schema('app_data')
        .from('staff')
        .update(patch)
        .eq('tenant_id', tenantId)
        .eq('cards_worker_id', worker.id); // set at approval; most reliable link
      if (!error) {
        synced++;
      } else {
        console.error('[worker-profile-push] staff update failed', { tenantId, msg: error.message });
      }
    } catch (e) {
      console.error('[worker-profile-push] tenant routing failed', { tenantId, msg: (e as Error).message });
    }
  }

  return json(200, { ok: true, synced, total: tenantIds.length });
}
