#!/usr/bin/env node
// scripts/check-orphan-perms.mjs
//
// Validates that every perm_key stored in shell_control.security_group_perms
// exists in the pinned @eq-solutions/roles PermKey union. An orphan key means
// a security group has a perm that the roles package no longer recognises —
// it silently fails in useCan() and leaves a confused user with no error.
//
// Usage:
//   node scripts/check-orphan-perms.mjs
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-orphan-perms.mjs
//
// Exit codes: 0 = clean, 1 = orphan keys found or config error.
//
// Reads env from process.env or from a local .env file if present.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, fileURLToPath } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env if present (local development only).
const envPath = resolve(__dirname, '../.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  console.error('  Set them in your environment or a .env file.');
  process.exit(1);
}

// Import the canonical PermKey set from the installed package.
// The package ships a compiled roles.js with { ALL_PERMS } array export.
let ALL_PERMS;
try {
  const rolesModule = await import('@eq-solutions/roles');
  ALL_PERMS = rolesModule.ALL_PERMS;
  if (!Array.isArray(ALL_PERMS)) throw new Error('ALL_PERMS is not an array');
} catch (e) {
  console.error('ERROR: could not import ALL_PERMS from @eq-solutions/roles:', e.message);
  console.error('  Run: pnpm install');
  process.exit(1);
}

const validPerms = new Set(ALL_PERMS);
console.log(`[check-orphan-perms] ${validPerms.size} known perm keys loaded from @eq-solutions/roles`);

const client = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const { data, error } = await client
  .schema('shell_control')
  .from('security_group_perms')
  .select('perm_key, security_groups!inner(name, tenant_id)');

if (error) {
  console.error('ERROR: could not query shell_control.security_group_perms:', error.message);
  process.exit(1);
}

const rows = (data ?? []);
console.log(`[check-orphan-perms] ${rows.length} perm rows found across all security groups`);

const orphans = rows.filter(r => !validPerms.has(r.perm_key));

if (orphans.length === 0) {
  console.log('✓ no orphan perm keys found — all security_group_perms are valid.');
  process.exit(0);
}

console.log('');
console.log(`✗ ${orphans.length} orphan perm key(s) found:`);
for (const o of orphans) {
  const sg = Array.isArray(o.security_groups) ? o.security_groups[0] : o.security_groups;
  console.log(`  "${o.perm_key}" — group "${sg?.name ?? '?'}" tenant ${sg?.tenant_id ?? '?'}`);
}
console.log('');
console.log('  These keys are not in the installed @eq-solutions/roles. Either:');
console.log('    a) Remove them from the affected security groups, or');
console.log('    b) Bump @eq-solutions/roles to a version that includes them.');
process.exit(1);
