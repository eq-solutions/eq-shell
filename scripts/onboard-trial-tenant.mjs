#!/usr/bin/env node
// scripts/onboard-trial-tenant.mjs
//
// One-command trial-tenant onboarding. Takes a brand-new tenant from zero
// to "first admin can sign in" with a single invocation. Wraps:
//
//   1. scripts/provision-tenant.mjs   (Supabase project + tenant_routing row)
//   2. scripts/migrate-tenants.mjs    (per-tenant schema migrations)
//   3. tier set on shell_control.tenants
//   4. tenant_routing.status -> 'active'
//   5. module_entitlements upserted for the chosen modules
//   6. user_invites row inserted for the first admin
//   7. public.organisations row created/updated (EQ Field routing, `field` module only)
//   8. invite URL printed for paste-into-email
//
// Idempotent for steps 3-6; steps 1-2 are guarded by the underlying scripts'
// own idempotency. Re-running on a tenant that's already onboarded will
// upsert entitlements + create a NEW invite (the old invite still works
// until it expires or is accepted).
//
// Usage:
//
//   node scripts/onboard-trial-tenant.mjs \
//     --slug=acme \
//     --name="Acme Electrical" \
//     --admin-email=jane@acme.com \
//     --admin-name="Jane Smith" \
//     --tier=trial \
//     --modules=cards,intake,field
//
// Flags:
//   --slug             Required. Lowercase kebab, 2-31 chars, starts with letter.
//   --name             Required. Display name shown in Shell.
//   --admin-email      Required. First admin's email; receives the invite.
//   --admin-name       Optional. Used in the printed welcome blurb.
//   --tier             Optional. One of: trial, standard, advanced, enterprise. Default: trial.
//   --modules          Optional. Comma-separated. Default: cards,intake,field.
//                      Allowed: cards, intake, field, service, quotes.
//   --region           Optional. Supabase region for the new project. Default: ap-southeast-2.
//   --field-hostname   Optional. Override the EQ Field subdomain written to public.organisations.
//                      Default: field.{slug}.eq.solutions
//   --skip-provision   Optional. Skip step 1 (use when re-running on an existing tenant).
//   --skip-migrate     Optional. Skip step 2.
//
// Required env vars (a superset of provision-tenant.mjs):
//   SUPABASE_ACCESS_TOKEN          Personal access token for Supabase Management API
//   SUPABASE_ORG_ID                Org under which to create the project
//   SUPABASE_DB_PASSWORD           Password for the new project's Postgres super-user
//   CONTROL_SUPABASE_URL           URL of the control-plane Supabase (eq-canonical)
//   CONTROL_SUPABASE_SERVICE_KEY   Service-role key for control plane
//   TENANT_ROUTING_MASTER_KEY      AES-256-GCM master key (same as eq-shell Netlify env)
//
// Optional env vars:
//   SHELL_BASE_URL                 Override the base URL stamped into the
//                                  invite URL. Default: https://core.eq.solutions.
//
// Exit codes: 0 = success, 1 = config/usage error, 2 = subprocess (provision/migrate) failed,
//             3 = control-plane DB error.

import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';

const SHELL_BASE_URL    = process.env.SHELL_BASE_URL ?? 'https://core.eq.solutions';
const INVITE_TTL_HOURS  = 7 * 24;  // matches accept-invite.ts default behaviour
const ALLOWED_MODULES   = ['cards', 'intake', 'field', 'service', 'quotes'];
const ALLOWED_TIERS     = ['trial', 'standard', 'advanced', 'enterprise'];

// ─── args ─────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    slug:               { type: 'string' },
    name:               { type: 'string' },
    'admin-email':      { type: 'string' },
    'admin-name':       { type: 'string', default: '' },
    tier:               { type: 'string', default: 'trial' },
    modules:            { type: 'string', default: 'cards,intake,field' },
    region:             { type: 'string', default: 'ap-southeast-2' },
    'field-hostname':   { type: 'string' },
    'skip-provision':   { type: 'boolean', default: false },
    'skip-migrate':     { type: 'boolean', default: false },
  },
});

if (!args.slug || !/^[a-z][a-z0-9-]{1,30}$/.test(args.slug)) {
  fail(1, 'usage: --slug=<lowercase-kebab>  (2-31 chars, must start with letter)');
}
if (!args.name) fail(1, 'usage: --name="Display Name"');
if (!args['admin-email'] || !/^\S+@\S+\.\S+$/.test(args['admin-email'])) {
  fail(1, 'usage: --admin-email=<valid email>');
}
if (!ALLOWED_TIERS.includes(args.tier)) {
  fail(1, `--tier must be one of: ${ALLOWED_TIERS.join(', ')}`);
}
const modules = args.modules.split(',').map(s => s.trim()).filter(Boolean);
const badMod = modules.find(m => !ALLOWED_MODULES.includes(m));
if (badMod) fail(1, `--modules contains unknown '${badMod}'. Allowed: ${ALLOWED_MODULES.join(', ')}`);
if (modules.length === 0) fail(1, '--modules cannot be empty');

const env = requireEnvs([
  'SUPABASE_ACCESS_TOKEN',         // the migrate step (migrate-tenants.mjs) needs it for the Management API
  'CONTROL_SUPABASE_URL',          // migrate-tenants.mjs derives CONTROL_PROJECT_REF from this
  'CONTROL_SUPABASE_SERVICE_KEY',
]);

const adminEmail = args['admin-email'].toLowerCase();

log(`Onboarding tenant: slug=${args.slug} name="${args.name}" admin=${adminEmail}`);
log(`Tier: ${args.tier} | Modules: ${modules.join(', ')}`);
log('');

// ─── step 1 ─ provision ────────────────────────────────────────────────

if (!args['skip-provision']) {
  log('━━━ Step 1/6: Provisioning Supabase project (~2-3 min) ━━━');
  await spawnStep('node', [
    'scripts/provision-tenant.mjs',
    `--slug=${args.slug}`,
    `--name=${args.name}`,
    `--region=${args.region}`,
  ]);
} else {
  log('--skip-provision: skipping Supabase project creation');
}
log('');

// ─── step 2 ─ migrate ──────────────────────────────────────────────────

if (!args['skip-migrate']) {
  log('━━━ Step 2/6: Applying per-tenant schema migrations ━━━');
  await spawnStep('node', [
    'scripts/migrate-tenants.mjs',
    `--slug=${args.slug}`,
  ]);
} else {
  log('--skip-migrate: skipping schema migrations');
}
log('');

// ─── steps 3-6 ─ control-plane writes ──────────────────────────────────

const control = createClient(env.CONTROL_SUPABASE_URL, env.CONTROL_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db:   { schema: 'shell_control' },
});

// Separate client for public schema writes (organisations table).
const controlPublic = createClient(env.CONTROL_SUPABASE_URL, env.CONTROL_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db:   { schema: 'public' },
});

// step 3 — tenant exists, tier set
log('━━━ Step 3/6: Activating tenant + setting tier ━━━');
const { data: tenant, error: tenErr } = await control
  .from('tenants')
  .select('id, slug, name, tier')
  .eq('slug', args.slug)
  .single();
if (tenErr || !tenant) fail(3, `tenant lookup failed: ${tenErr?.message ?? 'no row'}`);

if (tenant.tier !== args.tier) {
  const { error } = await control.from('tenants').update({ tier: args.tier }).eq('id', tenant.id);
  if (error) fail(3, `tier update failed: ${error.message}`);
  log(`Tier updated: ${tenant.tier} -> ${args.tier}`);
} else {
  log(`Tier already correct: ${args.tier}`);
}

const { data: routing, error: routingErr } = await control
  .from('tenant_routing')
  .update({ status: 'active' })
  .eq('tenant_id', tenant.id)
  .select('supabase_url, anon_key')
  .single();
if (routingErr) fail(3, `tenant_routing activation failed: ${routingErr.message}`);
log('tenant_routing.status = active');
log('');

// step 4 — module entitlements
log('━━━ Step 4/6: Seeding module entitlements ━━━');
const entRows = modules.map(m => ({ tenant_id: tenant.id, module: m, enabled: true }));
const { error: entErr } = await control
  .from('module_entitlements')
  .upsert(entRows, { onConflict: 'tenant_id,module' });
if (entErr) fail(3, `module_entitlements upsert failed: ${entErr.message}`);
log(`Enabled modules: ${modules.join(', ')}`);
log('');

// step 5 — admin invite
log('━━━ Step 5/6: Creating admin invite ━━━');
const rawToken  = randomBytes(32).toString('hex');
const tokenHash = createHash('sha256').update(rawToken).digest('hex');
const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString();

const { error: invErr } = await control
  .from('user_invites')
  .insert({
    tenant_id:         tenant.id,
    email:             adminEmail,
    role:              'manager',
    entitlements:      modules,
    invite_token_hash: tokenHash,
    expires_at:        expiresAt,
  });
if (invErr) fail(3, `user_invites insert failed: ${invErr.message}`);
log(`Invite created (expires ${expiresAt})`);
log('');

// step 6 — public.organisations row (EQ Field routing)
// Required for EQ Field to resolve hostname → tenant data plane.
// Only inserted when the `field` module is included.
// Default hostname pattern: field.{slug}.eq.solutions (override via --field-hostname flag).
if (modules.includes('field')) {
  log('━━━ Step 6/6: Seeding Field organisations row ━━━');

  const fieldHostname = args['field-hostname'] ?? `field.${args.slug}.eq.solutions`;
  const tenantSupabaseUrl  = routing?.supabase_url  ?? null;
  const tenantAnonKey      = routing?.anon_key       ?? null;

  if (!tenantSupabaseUrl) {
    log('  ⚠  tenant_routing.supabase_url is null — organisations row will lack DB connection details.');
    log('     Run this script again (--skip-provision --skip-migrate) after the data plane is fully provisioned.');
  }

  // Check if a row already exists (slug has a unique index on lower(slug)).
  const { data: existingOrg } = await controlPublic
    .from('organisations')
    .select('id')
    .eq('slug', args.slug)
    .maybeSingle();

  if (existingOrg) {
    const { error: orgUpdErr } = await controlPublic
      .from('organisations')
      .update({
        name:             args.name,
        hostname:         fieldHostname,
        supabase_url:     tenantSupabaseUrl,
        supabase_anon_key: tenantAnonKey,
        tenant_id:        tenant.id,
        updated_at:       new Date().toISOString(),
      })
      .eq('id', existingOrg.id);
    if (orgUpdErr) fail(3, `organisations update failed: ${orgUpdErr.message}`);
    log(`organisations row updated (id=${existingOrg.id})`);
  } else {
    const { error: orgInsErr } = await controlPublic
      .from('organisations')
      .insert({
        name:             args.name,
        slug:             args.slug,
        hostname:         fieldHostname,
        supabase_url:     tenantSupabaseUrl,
        supabase_anon_key: tenantAnonKey,
        tenant_id:        tenant.id,
      });
    if (orgInsErr) fail(3, `organisations insert failed: ${orgInsErr.message}`);
    log(`organisations row created (slug=${args.slug}, hostname=${fieldHostname})`);
  }

  log('');
}

// ─── done ──────────────────────────────────────────────────────────────

const inviteUrl = `${SHELL_BASE_URL}/accept-invite?token=${rawToken}`;
const tenantUrl = `${SHELL_BASE_URL}/${args.slug}`;

console.log('━'.repeat(72));
console.log(' ONBOARDING COMPLETE');
console.log('━'.repeat(72));
console.log(` Tenant slug:    ${args.slug}`);
console.log(` Tenant name:    ${args.name}`);
console.log(` Tenant URL:     ${tenantUrl}`);
console.log(` Admin email:    ${adminEmail}`);
console.log(` Invite URL:     ${inviteUrl}`);
console.log(` Invite expires: ${expiresAt}  (${INVITE_TTL_HOURS}h from now)`);
console.log('');
console.log(' Paste-into-email template:');
console.log('   ─────────────────────────────────────────────────────────────────');
console.log(`   Hi ${args['admin-name'] || 'there'},`);
console.log('');
console.log(`   You've been invited to ${args.name} on EQ Solutions.`);
console.log('');
console.log('   1. Click here to set your PIN and finish signing in:');
console.log(`      ${inviteUrl}`);
console.log('');
console.log(`   2. After that, your workspace lives at ${tenantUrl}`);
console.log('');
console.log('   The invite link expires in 7 days.');
console.log('');
console.log('   — EQ Solutions');
console.log('   ─────────────────────────────────────────────────────────────────');
console.log('━'.repeat(72));

// ─── helpers ───────────────────────────────────────────────────────────

function spawnStep(cmd, argList) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argList, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${argList.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  }).catch((err) => fail(2, err.message));
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

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function fail(code, msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}
