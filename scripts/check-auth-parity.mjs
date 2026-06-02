#!/usr/bin/env node
// scripts/check-auth-parity.mjs
//
// Phase 2 parity check — compares shell_control.users (the HMAC session
// source of truth) against Supabase auth.users.raw_app_meta_data.
//
// Reports:
//   MISMATCH  — shell_control.users and auth.users disagree on tenant_id /
//               eq_role / is_platform_admin for the same user.
//   UNLINKED  — user exists in auth.users but has no shell_control.users row
//               (can log in via Supabase OTP but cannot exchange for a Shell session).
//   ORPHANED  — user exists in shell_control.users but not in auth.users
//               (can log in via PIN but cannot use magic-link).
//   OK        — all claims match.
//
// Usage:
//   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/check-auth-parity.mjs
//
//   Or with a .env.local file in the repo root (dotenv is loaded automatically).
//
// Exit codes: 0 = all OK, 1 = mismatches / unlinked users found, 2 = error

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env.local if it exists (same pattern as Netlify CLI).
try {
  const envPath = resolve(process.cwd(), '.env.local');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
} catch { /* no .env.local — that's fine */ }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- Read all shell_control.users ---
const { data: shellUsers, error: shellErr } = await sb
  .schema('shell_control')
  .from('users')
  .select('id, email, tenant_id, role, is_platform_admin, active');

if (shellErr) {
  console.error('Failed to read shell_control.users:', shellErr.message);
  process.exit(2);
}

// --- Read all auth.users ---
// Supabase admin API returns users in pages; handle pagination.
let authUsers = [];
let page = 1;
const perPage = 1000;
while (true) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
  if (error) {
    console.error('Failed to read auth.users:', error.message);
    process.exit(2);
  }
  authUsers.push(...(data.users ?? []));
  if (!data.users || data.users.length < perPage) break;
  page++;
}

// --- Build lookup maps ---
const shellById = new Map(shellUsers.map(u => [u.id, u]));
const authById = new Map(authUsers.map(u => [u.id, u]));

const results = { ok: 0, mismatch: [], unlinked: [], orphaned: [] };

// Check every auth.users row.
for (const authUser of authUsers) {
  const meta = authUser.raw_app_meta_data ?? {};
  const shell = shellById.get(authUser.id);

  if (!shell) {
    // User can log in via Supabase Auth but Shell doesn't know them.
    if (meta.tenant_id || meta.eq_role) {
      // They have stale claims in raw_app_meta_data — potential confusion.
      results.unlinked.push({
        id: authUser.id,
        email: authUser.email,
        auth_tenant: meta.tenant_id ?? null,
        auth_role: meta.eq_role ?? null,
        note: 'In auth.users with claims but no shell_control.users row — magic-link will return no-account error',
      });
    } else {
      results.unlinked.push({
        id: authUser.id,
        email: authUser.email,
        note: 'In auth.users with no claims and no shell_control.users row',
      });
    }
    continue;
  }

  // Compare claims.
  const mismatches = [];

  if (meta.tenant_id && meta.tenant_id !== shell.tenant_id) {
    mismatches.push(`tenant_id: auth="${meta.tenant_id}" shell="${shell.tenant_id}"`);
  }
  if (meta.eq_role && meta.eq_role !== shell.role) {
    mismatches.push(`eq_role: auth="${meta.eq_role}" shell="${shell.role}"`);
  }
  if (typeof meta.is_platform_admin === 'boolean' && meta.is_platform_admin !== shell.is_platform_admin) {
    mismatches.push(`is_platform_admin: auth=${meta.is_platform_admin} shell=${shell.is_platform_admin}`);
  }

  if (mismatches.length > 0) {
    results.mismatch.push({
      id: authUser.id,
      email: authUser.email ?? shell.email,
      mismatches,
      note: 'raw_app_meta_data and shell_control.users disagree — hook will override with shell values on next login',
    });
  } else {
    results.ok++;
  }
}

// Check for orphaned shell_control.users rows.
for (const shellUser of shellUsers) {
  if (!authById.has(shellUser.id)) {
    results.orphaned.push({
      id: shellUser.id,
      email: shellUser.email,
      note: 'In shell_control.users but not in auth.users — can only log in via PIN, not magic-link',
    });
  }
}

// --- Report ---
console.log('\n=== Auth Parity Report ===\n');
console.log(`Shell users:  ${shellUsers.length}`);
console.log(`Auth users:   ${authUsers.length}`);
console.log(`OK:           ${results.ok}`);
console.log(`Mismatches:   ${results.mismatch.length}`);
console.log(`Unlinked:     ${results.unlinked.length}`);
console.log(`Orphaned:     ${results.orphaned.length}`);

if (results.mismatch.length > 0) {
  console.log('\n--- MISMATCHES (claims disagree between auth.users and shell_control.users) ---');
  for (const r of results.mismatch) {
    console.log(`  ${r.email ?? r.id}`);
    for (const m of r.mismatches) console.log(`    ${m}`);
    console.log(`    Note: ${r.note}`);
  }
}

if (results.unlinked.length > 0) {
  console.log('\n--- UNLINKED (in auth.users but not in shell_control.users) ---');
  for (const r of results.unlinked) {
    console.log(`  ${r.email ?? r.id}: ${r.note}`);
  }
}

if (results.orphaned.length > 0) {
  console.log('\n--- ORPHANED (in shell_control.users but not in auth.users) ---');
  for (const r of results.orphaned) {
    console.log(`  ${r.email}: ${r.note}`);
    console.log(`    Fix: invite them via Supabase Auth or the Shell invite flow`);
  }
}

const hasIssues = results.mismatch.length > 0 || results.unlinked.length > 0;

if (!hasIssues && results.orphaned.length === 0) {
  console.log('\n✓ All users are in parity.\n');
} else if (!hasIssues) {
  console.log('\n✓ No claim mismatches. Orphaned users need Supabase Auth invites to use magic-link.\n');
} else {
  console.log('\n✗ Parity issues found — see above.\n');
  console.log('  Mismatches self-heal on next login (hook reads from shell_control.users).');
  console.log('  Unlinked users need a shell_control.users row before magic-link works for them.\n');
}

process.exit(hasIssues ? 1 : 0);
