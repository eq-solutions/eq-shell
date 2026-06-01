/**
 * provision-sks-tenant.mjs
 *
 * One-time script: registers the SKS tenant in eq-canonical's tenant_routing
 * table so the canonical-api can route PUT requests to sks-canonical.
 *
 * Run from the eq-shell repo root via:
 *   netlify dev:exec --filter eq-shell -- node scripts/provision-sks-tenant.mjs
 *
 * netlify dev:exec injects all Netlify env vars (incl. TENANT_ROUTING_MASTER_KEY)
 * into the Node process. The SKS service-role key is read from
 * C:\Projects\.env.provision.txt (never from chat / never committed).
 *
 * Delete C:\Projects\.env.provision.txt after running.
 */

import { createCipheriv, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────────────────

const EQ_CANONICAL_URL     = 'https://jvknxcmbtrfnxfrwfimn.supabase.co';
const SKS_CANONICAL_URL    = 'https://ehowgjardagevnrluult.supabase.co';
const SKS_CANONICAL_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVob3dnamFyZGFnZXZucmx1dWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MTE5MDUsImV4cCI6MjA5NTE4NzkwNX0.-38JeVxpwMFt6Co-ResZqj8C_6aJxBAtBI_L-XkfPsA';
const SKS_TENANT_SLUG      = 'sks';
const REGION               = 'ap-southeast-2';

// ── Read master key from Netlify-injected env ─────────────────────────

const MASTER_KEY_HEX = process.env.TENANT_ROUTING_MASTER_KEY?.trim();
if (!MASTER_KEY_HEX) {
  console.error('ERROR: TENANT_ROUTING_MASTER_KEY not in env.');
  console.error('Run via: netlify dev:exec --filter eq-shell -- node scripts/provision-sks-tenant.mjs');
  process.exit(1);
}
const masterKey = Buffer.from(MASTER_KEY_HEX, 'hex');
if (masterKey.length !== 32) {
  console.error(`ERROR: Master key must be 32 bytes, got ${masterKey.length}`);
  process.exit(1);
}

// ── Read eq-canonical service-role key from Netlify-injected env ───────

const EQ_CANONICAL_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!EQ_CANONICAL_SERVICE_ROLE) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not in env (needed to write to eq-canonical).');
  process.exit(1);
}

// ── Read sks-canonical service-role key from provision file ───────────

const PROVISION_FILE = 'C:\\Projects\\.env.provision.txt';
if (!existsSync(PROVISION_FILE)) {
  console.error(`ERROR: ${PROVISION_FILE} not found.`);
  console.error('Create it with: SKS_CANONICAL_SERVICE_ROLE_KEY=eyJ...');
  process.exit(1);
}
const provisionEnv = Object.fromEntries(
  readFileSync(PROVISION_FILE, 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);
const SKS_SERVICE_ROLE = provisionEnv['SKS_CANONICAL_SERVICE_ROLE_KEY'];
if (!SKS_SERVICE_ROLE) {
  console.error('ERROR: SKS_CANONICAL_SERVICE_ROLE_KEY not found in provision file.');
  process.exit(1);
}

// ── Encrypt ───────────────────────────────────────────────────────────

function encryptSecret(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

const encrypted = encryptSecret(SKS_SERVICE_ROLE);
console.log('✓ Service-role key encrypted');

// ── Connect to eq-canonical with service-role ─────────────────────────

const sb = createClient(EQ_CANONICAL_URL, EQ_CANONICAL_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Resolve sks tenant_id from tenants table ──────────────────────────

const { data: tenant, error: tenantErr } = await sb
  .from('tenants')
  .select('id')
  .eq('slug', SKS_TENANT_SLUG)
  .maybeSingle();

if (tenantErr) {
  console.error('ERROR reading tenants table:', tenantErr.message);
  process.exit(1);
}
if (!tenant) {
  console.error(`ERROR: No row in tenants for slug="${SKS_TENANT_SLUG}". Did the migration run?`);
  process.exit(1);
}
console.log(`✓ Found tenant: ${SKS_TENANT_SLUG} → ${tenant.id}`);

// ── Upsert tenant_routing row ─────────────────────────────────────────

const { error: routingErr } = await sb
  .from('tenant_routing')
  .upsert({
    tenant_id:                   tenant.id,
    supabase_url:                SKS_CANONICAL_URL,
    supabase_anon_key:           SKS_CANONICAL_ANON,
    service_role_key_ciphertext: encrypted.ciphertext,
    service_role_key_iv:         encrypted.iv,
    service_role_key_tag:        encrypted.tag,
    region:                      REGION,
    status:                      'active',
    updated_at:                  new Date().toISOString(),
  }, { onConflict: 'tenant_id' });

if (routingErr) {
  console.error('ERROR upserting tenant_routing:', routingErr.message);
  process.exit(1);
}

console.log('✓ tenant_routing row upserted for SKS → sks-canonical');
console.log('');
console.log('Done. canonical-api can now route X-Tenant: sks to sks-canonical.');
console.log('Delete C:\\Projects\\.env.provision.txt now.');
