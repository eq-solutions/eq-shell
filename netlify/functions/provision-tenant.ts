// POST /.netlify/functions/provision-tenant
//
// Platform-admin only. Orchestrates creation of a new tenant data-plane
// Supabase project with idempotent checkpointing — every step is safe to
// retry; re-running resumes from the last completed checkpoint.
//
// Checkpoint state in shell_control.tenant_routing:
//   No row at all          → step 1: insert row (status=provisioning)
//   Row, no project_ref    → step 2: create Supabase project via Management API
//   Row, project_ref set,
//     no supabase_url      → step 3: project may not be ready; fetch API keys
//   Row, supabase_url set,
//     status=provisioning  → step 4: apply baseline tenant schema
//   status=active          → done (idempotent, returns current state)
//   status=provisioning_failed → retry from whichever step was incomplete
//
// On ANY failure: sets status=provisioning_failed + last_error + last_error_at.
// Invalidates the in-memory routing cache on completion or failure so the
// next session-minting call reflects the updated state immediately.
//
// Required env:
//   SUPABASE_ACCESS_TOKEN        — Personal/org access token for Management API
//   SUPABASE_ORGANIZATION_ID     — Target org for new projects
//   TENANT_ROUTING_MASTER_KEY    — AES-256-GCM key for encrypting service-role keys

import type { Context } from '@netlify/functions';
import { getServiceClient } from './_shared/supabase.js';
import { encryptSecret } from './_shared/encryption.js';
import { invalidateRoutingCache } from './_shared/tenant-routing.js';
import { verifySessionToken, readSessionCookie } from './_shared/token.js';
import { withSentry } from './_shared/sentry.js';

const MGMT_API = 'https://api.supabase.com/v1';
const DEFAULT_REGION = 'ap-southeast-2';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function mgmtHeaders(): Record<string, string> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN env var not set');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** Poll until the Supabase project status is ACTIVE_HEALTHY (max ~90s). */
async function waitForProjectReady(ref: string, maxMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(`${MGMT_API}/projects/${ref}`, { headers: mgmtHeaders() });
    if (res.ok) {
      const data = (await res.json()) as { status?: string };
      if (data.status === 'ACTIVE_HEALTHY') return;
    }
    await new Promise((r) => setTimeout(r, 8_000));
  }
  throw new Error(`Project ${ref} did not become ACTIVE_HEALTHY within ${maxMs / 1000}s`);
}

/** Fetch service_role and anon API keys for a project ref. */
async function fetchApiKeys(ref: string): Promise<{ serviceRoleKey: string; anonKey: string }> {
  const res = await fetch(`${MGMT_API}/projects/${ref}/api-keys`, { headers: mgmtHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    throw new Error(`Failed to fetch API keys for ${ref}: HTTP ${res.status} — ${body}`);
  }
  const keys = (await res.json()) as Array<{ name: string; api_key: string }>;
  const srKey = keys.find((k) => k.name === 'service_role')?.api_key;
  const anonKey = keys.find((k) => k.name === 'anon')?.api_key;
  if (!srKey || !anonKey) {
    throw new Error(`API keys response for ${ref} missing service_role or anon key`);
  }
  return { serviceRoleKey: srKey, anonKey };
}

/** Apply a minimal baseline SQL to the new tenant project via Management API. */
async function applyBaselineSchema(ref: string): Promise<void> {
  // The full migration suite is applied by running:
  //   node scripts/migrate-tenants.mjs --slug=<slug>
  // This call applies the bare minimum so the project is considered provisioned.
  const sql = `
    CREATE SCHEMA IF NOT EXISTS app_data;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version     text   NOT NULL PRIMARY KEY,
      statements  text[] NULL,
      name        text   NOT NULL,
      checksum    text   NULL
    );
  `;
  const res = await fetch(`${MGMT_API}/projects/${ref}/database/query`, {
    method: 'POST',
    headers: mgmtHeaders(),
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    throw new Error(`Baseline schema failed for ${ref}: HTTP ${res.status} — ${body}`);
  }
}

export default withSentry(async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // Platform admin only
  const session = verifySessionToken(readSessionCookie(req));
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });
  if (!session.is_platform_admin) return jsonResponse(403, { error: 'Platform admin only' });

  let body: { tenant_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const tenantId = (body.tenant_id ?? '').trim();
  if (!tenantId) return jsonResponse(400, { error: 'tenant_id required' });

  const orgId = process.env.SUPABASE_ORGANIZATION_ID;
  if (!orgId) return jsonResponse(500, { error: 'SUPABASE_ORGANIZATION_ID not set' });

  let sb;
  try {
    sb = getServiceClient();
  } catch (e) {
    return jsonResponse(500, { error: (e as Error).message });
  }

  // Verify the tenant exists in shell_control
  const { data: tenant } = await sb
    .from('tenants')
    .select('id, slug, name')
    .eq('id', tenantId)
    .maybeSingle<{ id: string; slug: string; name: string }>();

  if (!tenant) return jsonResponse(404, { error: 'Tenant not found' });

  async function failWith(msg: string): Promise<Response> {
    await sb!
      .from('tenant_routing')
      .update({ status: 'provisioning_failed', last_error: msg, last_error_at: new Date().toISOString() })
      .eq('tenant_id', tenantId);
    invalidateRoutingCache(tenantId);
    return jsonResponse(500, { status: 'provisioning_failed', error: msg });
  }

  // ── Step 1: Insert routing row (skip if already exists) ──────────────────
  const { data: existingRow } = await sb
    .from('tenant_routing')
    .select('status, supabase_project_ref, supabase_url')
    .eq('tenant_id', tenantId)
    .maybeSingle<{ status: string; supabase_project_ref: string | null; supabase_url: string | null }>();

  if (!existingRow) {
    const { error: insertErr } = await sb.from('tenant_routing').insert({
      tenant_id: tenantId,
      status: 'provisioning',
      region: DEFAULT_REGION,
    });
    if (insertErr) return failWith(`Failed to create routing row: ${insertErr.message}`);
  } else if (existingRow.status === 'active') {
    return jsonResponse(200, { status: 'active', routing_status: 'active' });
  } else {
    // Reset to provisioning on retry (clears last_error)
    await sb
      .from('tenant_routing')
      .update({ status: 'provisioning', last_error: null, last_error_at: null })
      .eq('tenant_id', tenantId);
  }

  // Re-read current checkpoint state
  const { data: row } = await sb
    .from('tenant_routing')
    .select('supabase_project_ref, supabase_url')
    .eq('tenant_id', tenantId)
    .maybeSingle<{ supabase_project_ref: string | null; supabase_url: string | null }>();

  // ── Step 2: Create Supabase project (skip if ref already stored) ──────────
  let projectRef = row?.supabase_project_ref ?? null;
  if (!projectRef) {
    let createRes: Response;
    try {
      createRes = await fetch(`${MGMT_API}/projects`, {
        method: 'POST',
        headers: mgmtHeaders(),
        body: JSON.stringify({
          name: `eq-tenant-${tenant.slug}`,
          organization_id: orgId,
          plan: 'free',
          region: DEFAULT_REGION,
          // Generate a strong random password — stored only in the project itself.
          db_pass: Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url'),
        }),
      });
    } catch (e) {
      return failWith(`Management API network error: ${(e as Error).message}`);
    }
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => '(no body)');
      return failWith(`Create project failed: HTTP ${createRes.status} — ${body}`);
    }
    const created = (await createRes.json()) as { ref: string };
    projectRef = created.ref;
    const { error: refErr } = await sb
      .from('tenant_routing')
      .update({ supabase_project_ref: projectRef })
      .eq('tenant_id', tenantId);
    if (refErr) return failWith(`Failed to store project ref: ${refErr.message}`);
  }

  // ── Step 3: Wait for project, fetch + store API keys ──────────────────────
  if (!row?.supabase_url) {
    try {
      await waitForProjectReady(projectRef);
    } catch (e) {
      return failWith((e as Error).message);
    }

    let keys: { serviceRoleKey: string; anonKey: string };
    try {
      keys = await fetchApiKeys(projectRef);
    } catch (e) {
      return failWith((e as Error).message);
    }

    let encrypted: { ciphertext: string; iv: string; tag: string };
    try {
      encrypted = encryptSecret(keys.serviceRoleKey);
    } catch (e) {
      return failWith(`Key encryption failed: ${(e as Error).message}`);
    }

    const supabaseUrl = `https://${projectRef}.supabase.co`;
    const { error: keyErr } = await sb.from('tenant_routing').update({
      supabase_url: supabaseUrl,
      supabase_anon_key: keys.anonKey,
      service_role_key_ciphertext: encrypted.ciphertext,
      service_role_key_iv: encrypted.iv,
      service_role_key_tag: encrypted.tag,
    }).eq('tenant_id', tenantId);
    if (keyErr) return failWith(`Failed to store API keys: ${keyErr.message}`);
  }

  // ── Step 4: Apply baseline tenant schema ──────────────────────────────────
  // Full migrations: run `node scripts/migrate-tenants.mjs --slug=<slug>`
  try {
    await applyBaselineSchema(projectRef);
  } catch (e) {
    return failWith((e as Error).message);
  }

  // ── Step 5: Mark active ────────────────────────────────────────────────────
  const { error: activeErr } = await sb
    .from('tenant_routing')
    .update({ status: 'active', last_error: null, last_error_at: null })
    .eq('tenant_id', tenantId);
  if (activeErr) return failWith(`Failed to set status=active: ${activeErr.message}`);

  // ── Step 6: Invalidate routing cache ──────────────────────────────────────
  invalidateRoutingCache(tenantId);

  return jsonResponse(200, { status: 'ok', routing_status: 'active' });
});
