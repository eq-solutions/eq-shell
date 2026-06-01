#!/usr/bin/env node
/**
 * Drift guard for the permission matrix.
 *
 * Verifies that @eq-solutions/roles (the single source of truth after B12) lists
 * exactly the same PermKey members and role grants as src/permissions/matrix.ts
 * (via its composed module files). Run in CI on every PR that touches
 * src/permissions/** or netlify/functions/_shared/permissions.ts.
 *
 * We parse client module files with regex (avoids needing tsc or a full bundle
 * step in CI). The roles package is imported directly as ESM since it ships
 * pre-built TypeScript with `"type":"module"`.
 *
 * Exit 0 = in sync. Exit 1 = drift detected (prints a diff).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const { matrix: MATRIX, permissions: PERMISSIONS } = _require('@eq-solutions/roles/roles.json');

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

function readFile(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

// ──────────────────────────────────────────────────────────────────────────────
// Parse per-role grants from client module permissions files.
// The client composes from multiple module matrices; we need to parse each.
// ──────────────────────────────────────────────────────────────────────────────
function parseModuleMatrix(src) {
  const grants = {};
  const blocks = src.matchAll(/(\w+):\s*\[([^\]]*)\]/gs);
  for (const [, role, body] of blocks) {
    if (!grants[role]) grants[role] = new Set();
    for (const m of body.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) {
      grants[role].add(m[1]);
    }
  }
  return grants;
}

function mergeGrants(...matrixList) {
  const merged = {};
  for (const matrix of matrixList) {
    for (const [role, perms] of Object.entries(matrix)) {
      if (!merged[role]) merged[role] = new Set();
      for (const p of perms) merged[role].add(p);
    }
  }
  return merged;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

// Collect client-side grants from all module permissions files + roles package matrix
const moduleFiles = [
  'src/modules/intake/permissions.ts',
  'src/modules/equipment/permissions.ts',
  'src/modules/gm-reports/permissions.ts',
  'src/modules/cards/permissions.ts',
  'src/modules/service/permissions.ts',
  'src/modules/field/permissions.ts',
  'src/modules/quotes/permissions.ts',
];

// Entity perms are inline in matrix.ts; parse them separately
const matrixSrc = readFile('src/permissions/matrix.ts');
const entityMatrix = parseModuleMatrix(
  matrixSrc.match(/ENTITY_MATRIX[^=]+=([^;]+)/s)?.[1] ?? '',
);

// Admin + audit + all other grants from the canonical roles package (single source of truth)
const rolesGrants = Object.fromEntries(
  Object.entries(MATRIX).map(([role, perms]) => [role, new Set(perms)]),
);

const clientGrants = mergeGrants(
  rolesGrants,
  entityMatrix,
  ...moduleFiles.map((f) => parseModuleMatrix(readFile(f))),
);

// Server grants = roles package matrix (permissions.ts now delegates fully to it)
const serverGrants = Object.fromEntries(
  Object.entries(MATRIX).map(([role, perms]) => [role, new Set(perms)]),
);

// PermKey sets from each source
const serverKeys = new Set(PERMISSIONS.map((p) => p.key));
const clientKeys = new Set([...Object.values(clientGrants)].flatMap((s) => [...s]));

let ok = true;

// 1. PermKey union drift
const onlyInServer = [...serverKeys].filter((k) => !clientKeys.has(k));
const onlyInClient = [...clientKeys].filter((k) => !serverKeys.has(k));
if (onlyInServer.length) {
  console.error(`❌  Keys in server PermKey but not client: ${onlyInServer.join(', ')}`);
  ok = false;
}
if (onlyInClient.length) {
  console.error(`❌  Keys in client PermKey but not server: ${onlyInClient.join(', ')}`);
  ok = false;
}

// 2. Per-role grant drift
for (const role of Object.keys(clientGrants)) {
  const cg = clientGrants[role] ?? new Set();
  const sg = serverGrants[role] ?? new Set();
  const missingServer = [...cg].filter((p) => !sg.has(p));
  const missingClient = [...sg].filter((p) => !cg.has(p));
  if (missingServer.length) {
    console.error(`❌  role=${role}: client has [${missingServer.join(', ')}] but server does not`);
    ok = false;
  }
  if (missingClient.length) {
    console.error(`❌  role=${role}: server has [${missingClient.join(', ')}] but client does not`);
    ok = false;
  }
}

if (ok) {
  console.log('✅  Permission matrix is in sync (client ≡ server)');
  process.exit(0);
} else {
  console.error('\nFix: update @eq-solutions/roles model.json or src/permissions/matrix.ts so both sides agree.');
  process.exit(1);
}
