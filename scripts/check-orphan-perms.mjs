#!/usr/bin/env node
// scripts/check-orphan-perms.mjs
//
// Phase 5.3 CI gate: validates that every perm_key stored in
// shell_control.security_group_perms on the control plane (jvkn) exists in the
// pinned @eq-solutions/roles PermKey union. An orphan key means a security group
// grants a perm that the roles package no longer recognises — it silently passes
// the `can()` check as false and leaves an admin confused with no error message.
//
// This check uses the Supabase Management API so it runs in the same CI job as
// check-tenant-drift.mjs with the same credentials — no extra secrets needed.
//
// Usage:
//   node scripts/check-orphan-perms.mjs
//
// Required env:
//   SUPABASE_ACCESS_TOKEN   — Supabase Management API token
//   CONTROL_PROJECT_REF     — project ref for the control plane (jvknxcmbtrfnxfrwfimn)
//
// Exit codes: 0 = clean, 1 = config error, 2 = orphan keys found.

import { createRequire } from 'node:module';
import { mgmtRows, requireAccessToken, controlRef } from './_mgmt.mjs';

const _require = createRequire(import.meta.url);

// Load the pinned PermKey set from the installed package.
// roles.json ships with the compiled package and exports { permissions: [{ key, label }] }.
// Using roles.json directly avoids ESM/CJS interop issues with the compiled roles.js.
let validPerms;
try {
  const ROLES_JSON = _require('@eq-solutions/roles/roles.json');
  const perms = ROLES_JSON.permissions;
  if (!Array.isArray(perms)) throw new Error('roles.json.permissions is not an array');
  validPerms = new Set(perms.map(p => p.key));
} catch (e) {
  console.error('ERROR: could not load permissions from @eq-solutions/roles/roles.json:', e.message);
  console.error('  Run: pnpm install');
  process.exit(1);
}

requireAccessToken();
const ref = controlRef();

let rows;
try {
  rows = await mgmtRows(ref, `
    SELECT DISTINCT
      sgp.perm_key,
      sg.name     AS group_name,
      sg.tenant_id
    FROM shell_control.security_group_perms sgp
    JOIN shell_control.security_groups sg ON sg.id = sgp.security_group_id
    ORDER BY sgp.perm_key, sg.tenant_id;
  `);
} catch (e) {
  console.error(`ERROR: could not query shell_control.security_group_perms on ${ref}: ${e.message}`);
  process.exit(1);
}

console.log(`[orphan-perms] ${validPerms.size} known perm keys in @eq-solutions/roles`);
console.log(`[orphan-perms] ${rows.length} distinct perm assignments in shell_control.security_group_perms`);

const orphans = rows.filter(r => !validPerms.has(r.perm_key));

if (orphans.length === 0) {
  console.log('✓ no orphan perm keys — all security_group_perms.perm_key values are valid.');
  process.exit(0);
}

console.log('');
console.log(`✗ ${orphans.length} orphan perm key(s) found in shell_control.security_group_perms:`);
for (const o of orphans) {
  console.log(`  "${o.perm_key}"  group="${o.group_name}"  tenant=${o.tenant_id}`);
}
console.log('');
console.log('  Each key above is stored on a live security group but is NOT in the installed');
console.log('  @eq-solutions/roles package. can() will silently return false for holders.');
console.log('  Fix: remove the orphan rows (or bump the package to include the renamed key).');
process.exit(2);
