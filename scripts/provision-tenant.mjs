#!/usr/bin/env node
// scripts/provision-tenant.mjs
//
// Provision a new per-tenant data plane (a dedicated Supabase project) and
// register it in shell_control.tenant_routing.
//
// What it does (and what it does NOT do):
//   ✓ Create the Supabase project via the Management API
//   ✓ Wait for project → ACTIVE_HEALTHY
//   ✓ Fetch URL + anon key + service-role key
//   ✓ Encrypt the service-role key with TENANT_ROUTING_MASTER_KEY
//   ✓ Ensure a shell_control.tenants row exists for the slug
//   ✓ Insert/update shell_control.tenant_routing with status='provisioning'
//   ✓ Print the next step (run migrate-tenants.mjs, then flip status='active')
//
//   ✗ Run tenant migrations — that's migrate-tenants.mjs's job. Keeps
//     concerns separate; the runner can re-apply pending migrations any
//     time without re-provisioning anything.
//   ✗ Sync SUPABASE_JWT_SECRET into the new project — deferred. canonical-api
//     uses the service-role key (RLS-bypassing), so cross-project JWT
//     verification isn't required for v1. When browser → tenant DB direct
//     reads land (post Phase 2.B.6), revisit.
//   ✗ Migrate data from the shared eq-canonical — separate script
//     (sync-tenant-data.mjs, written when we run the cutover).
//
// Usage:
//   node scripts/provision-tenant.mjs --slug=core --name="EQ Solutions" --region=ap-southeast-2
//   node scripts/provision-tenant.mjs --slug=sks  --name="SKS Technologies" --region=ap-southeast-2
//
// Required env vars:
//   SUPABASE_ACCESS_TOKEN          Personal access token from https://supabase.com/dashboard/account/tokens
//   SUPABASE_ORG_ID                Org under which to create the project (EQ Solutions: sqjyblkiqonyrdobaucn)
//   SUPABASE_DB_PASSWORD           Password to set on the new project's Postgres super-user
//   CONTROL_SUPABASE_URL           URL of the control-plane Supabase (currently eq-canonical)
//   CONTROL_SUPABASE_SERVICE_KEY   Service-role key for control plane (for the INSERT into tenant_routing)
//   TENANT_ROUTING_MASTER_KEY      Same value as set in eq-shell Netlify env
//
// Exit codes: 0 = success, 1 = configuration error, 2 = API error, 3 = DB error.

import { createClient } from '@supabase/supabase-js';
import { createCipheriv, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

const SUPABASE_API = 'https://api.supabase.com';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;   // 10 min — fresh projects take 2-3 min typically

const ALLOWED_REGIONS = [
  'ap-southeast-2', 'ap-southeast-1', 'ap-south-1',
  'us-east-1', 'us-west-1',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
];

// ─── arg + env validation ─────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    slug:        { type: 'string' },
    name:        { type: 'string' },
    region:      { type: 'string', default: 'ap-southeast-2' },
    tier:        { type: 'string', default: 'pro' },    // informational; Supabase tier is set in dashboard
    'dry-run':   { type: 'boolean', default: false },
  },
});

if (!args.slug || !/^[a-z][a-z0-9-]{1,30}$/.test(args.slug)) {
  fail(1, 'usage: --slug=<lowercase-kebab> (1-31 chars, must start with letter)');
}
if (!args.name) fail(1, 'usage: --name="Display Name"');
if (!ALLOWED_REGIONS.includes(args.region)) {
  fail(1, `--region must be one of: ${ALLOWED_REGIONS.join(', ')}`);
}

const env = requireEnvs([
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_ORG_ID',
  'SUPABASE_DB_PASSWORD',
  'CONTROL_SUPABASE_URL',
  'CONTROL_SUPABASE_SERVICE_KEY',
  'TENANT_ROUTING_MASTER_KEY',
]);

const masterKey = validateMasterKey(env.TENANT_ROUTING_MASTER_KEY);
const control   = createClient(env.CONTROL_SUPABASE_URL, env.CONTROL_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db:   { schema: 'shell_control' },
});

log(`Provisioning tenant '${args.slug}' (${args.name}) in ${args.region}`);
if (args['dry-run']) log('DRY RUN — no API calls or DB writes will be made');

// ─── 0. ensure tenant row exists ──────────────────────────────────────

const tenant = await ensureTenantRow(args.slug, args.name);
log(`Tenant row: ${tenant.id} (slug=${tenant.slug})`);

// ─── 1. check for existing routing row (idempotency) ──────────────────

const { data: existing, error: existingErr } = await control
  .from('tenant_routing')
  .select('tenant_id, supabase_url, supabase_project_ref, status')
  .eq('tenant_id', tenant.id)
  .maybeSingle();
if (existingErr) fail(3, `Failed to read tenant_routing: ${existingErr.message}`);

if (existing) {
  log(`Existing routing row found: project=${existing.supabase_project_ref} status=${existing.status}`);
  if (existing.status === 'active') {
    log('Tenant is already active. Nothing to do. (Re-encrypt or rotate? Use a separate script.)');
    process.exit(0);
  }
  log('Status != active — re-running provisioning is not yet supported. Inspect manually.');
  process.exit(0);
}

// ─── 2. create the new Supabase project via Management API ────────────

const projectName = `${args.slug}-canonical`;
log(`Creating Supabase project '${projectName}'...`);

if (args['dry-run']) {
  log('DRY RUN — would POST /v1/projects { name, organization_id, region, db_pass }');
  process.exit(0);
}

const created = await mgmtApi('POST', '/v1/projects', {
  name:            projectName,
  organization_id: env.SUPABASE_ORG_ID,
  region:          args.region,
  db_pass:         env.SUPABASE_DB_PASSWORD,
});

const projectRef = created.id ?? created.ref;
if (!projectRef) fail(2, `Project creation response missing id/ref: ${JSON.stringify(created)}`);
log(`Project created: ref=${projectRef}`);

// ─── 3. poll until ACTIVE_HEALTHY ─────────────────────────────────────

log('Waiting for project to reach ACTIVE_HEALTHY (typically 2-3 min)...');
const project = await waitForActive(projectRef);
log(`Project ACTIVE_HEALTHY: host=${project.database?.host}`);

// ─── 4. fetch keys ────────────────────────────────────────────────────

const apiKeys = await mgmtApi('GET', `/v1/projects/${projectRef}/api-keys`);
const anonKey    = apiKeys.find(k => k.name === 'anon')?.api_key;
const serviceKey = apiKeys.find(k => k.name === 'service_role')?.api_key;
if (!anonKey || !serviceKey) {
  fail(2, `Could not extract anon + service_role from /api-keys response: ${JSON.stringify(apiKeys)}`);
}

const supabaseUrl = `https://${projectRef}.supabase.co`;

// ─── 5. encrypt service-role key ──────────────────────────────────────

const encrypted = encryptSecret(serviceKey, masterKey);
log('Service-role key encrypted (AES-256-GCM).');

// ─── 6. insert tenant_routing row ─────────────────────────────────────

const { error: insertErr } = await control
  .from('tenant_routing')
  .insert({
    tenant_id:                    tenant.id,
    supabase_url:                 supabaseUrl,
    supabase_project_ref:         projectRef,
    supabase_anon_key:            anonKey,
    service_role_key_ciphertext:  encrypted.ciphertext,
    service_role_key_iv:          encrypted.iv,
    service_role_key_tag:         encrypted.tag,
    region:                       args.region,
    status:                       'provisioning',
    notes:                        `Provisioned by scripts/provision-tenant.mjs at ${new Date().toISOString()}`,
  });
if (insertErr) fail(3, `INSERT into tenant_routing failed: ${insertErr.message}`);

log('tenant_routing row inserted (status=provisioning).');

// ─── 7. print next steps ──────────────────────────────────────────────

console.log('');
console.log('━'.repeat(70));
console.log(' PROVISIONING COMPLETE');
console.log('━'.repeat(70));
console.log(` Tenant slug:    ${args.slug}`);
console.log(` Tenant id:      ${tenant.id}`);
console.log(` Supabase URL:   ${supabaseUrl}`);
console.log(` Supabase ref:   ${projectRef}`);
console.log(` Region:         ${args.region}`);
console.log(` Status:         provisioning  (flip to 'active' after smoke test)`);
console.log('');
console.log(' Next steps:');
console.log('   1. Apply tenant-plane migrations:');
console.log('      node scripts/migrate-tenants.mjs --slug=' + args.slug);
console.log('   2. Smoke test by hitting canonical-api with X-Tenant: ' + args.slug);
console.log('   3. Flip status to active:');
console.log(`      UPDATE shell_control.tenant_routing SET status='active' WHERE tenant_id='${tenant.id}';`);
console.log('━'.repeat(70));

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

async function ensureTenantRow(slug, name) {
  const { data: found, error: findErr } = await control
    .from('tenants')
    .select('id, slug, name')
    .eq('slug', slug)
    .maybeSingle();
  if (findErr) fail(3, `tenants lookup failed: ${findErr.message}`);
  if (found) return found;

  log(`Creating shell_control.tenants row for '${slug}'...`);
  const { data: created, error: createErr } = await control
    .from('tenants')
    .insert({ slug, name, active: true })
    .select('id, slug, name')
    .single();
  if (createErr) fail(3, `tenants INSERT failed: ${createErr.message}`);
  return created;
}

async function mgmtApi(method, path, body) {
  const url = `${SUPABASE_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    fail(2, `Supabase Management API ${method} ${path} → ${res.status} ${res.statusText}\n${text}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

async function waitForActive(ref) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const project = await mgmtApi('GET', `/v1/projects/${ref}`);
    if (project.status === 'ACTIVE_HEALTHY') return project;
    if (project.status === 'COMING_UP' || project.status === 'INACTIVE') {
      process.stdout.write('.');
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    fail(2, `Project entered unexpected status ${project.status} — manual investigation needed`);
  }
  fail(2, `Project did not reach ACTIVE_HEALTHY within ${POLL_TIMEOUT_MS / 1000}s`);
}

function encryptSecret(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('hex'),
    iv:         iv.toString('hex'),
    tag:        tag.toString('hex'),
  };
}

function validateMasterKey(hex) {
  const cleaned = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) fail(1, 'TENANT_ROUTING_MASTER_KEY: not hex');
  const buf = Buffer.from(cleaned, 'hex');
  if (buf.length !== 32) fail(1, `TENANT_ROUTING_MASTER_KEY: must decode to 32 bytes, got ${buf.length}`);
  return buf;
}

function requireEnvs(names) {
  const out = {};
  const missing = [];
  for (const n of names) {
    const v = process.env[n];
    if (!v) missing.push(n);
    else out[n] = v;
  }
  if (missing.length) fail(1, `Missing env vars: ${missing.join(', ')}`);
  return out;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg)  { console.log(`[${new Date().toISOString()}] ${msg}`); }
function fail(code, msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}
