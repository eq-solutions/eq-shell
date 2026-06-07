#!/usr/bin/env node
// scripts/check-migration-hygiene.mjs
//
// Static lint over tenant-migration files ADDED in a PR. No DB access, no
// secrets — pure git-diff + file content, so it runs as a creds-free CI job.
//
// THE RULE (see SCHEMA-GOVERNANCE.md → "Ledger truth: the runner records, the
// file does not"): the fleet runner (scripts/migrate-tenants.mjs) is the SINGLE
// writer of app_data._eq_migrations. On apply it records every migration under
// its full filename WITH the `.sql` suffix (e.g. `0039_x.sql`). A migration file
// must therefore NOT self-insert its own ledger row.
//
// WHY: a self-insert writes a SECOND, bare-named twin (`0039_x`, no suffix). The
// runner keys on `0039_x.sql`, so it never recognises or reconciles the bare row
// on a normal apply — the two rows coexist. The schema is correct, but the ledger
// is polluted and the migration-identity check (check-tenant-drift.mjs CHECK 3)
// flags the bare row as a null-checksum out-of-band entry. This is exactly what
// 0039_migration_baseline_rls did on both the zaap (EQ) and ehow (SKS) planes on
// 2026-06-07; cleaned up via the governed reconcile path (PRs #200 / #205).
//
// SCOPE: only files ADDED by this PR are linted, so the legacy migrations that
// already carry the self-insert are NOT flagged. The convention is forward-only —
// new files clean, old files left exactly as they are (their twins are removed by
// `migrate-tenants.mjs --reconcile-ledger`, not by editing the files).
//
// Usage:
//   node scripts/check-migration-hygiene.mjs                  # diff origin/main...HEAD
//   node scripts/check-migration-hygiene.mjs --base=<ref>     # diff <ref>...HEAD
//   BASE=<sha> node scripts/check-migration-hygiene.mjs       # env form (CI passes base.sha)
//   node scripts/check-migration-hygiene.mjs --files a.sql b.sql   # lint explicit files (no git)
//
// Exit codes: 0 = clean, 1 = config/git error, 2 = a newly-added file self-inserts.

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MIGRATIONS_REL = 'supabase/tenant-migrations';
const MIGRATIONS_DIR = join(REPO_ROOT, MIGRATIONS_REL);

// A self-insert into the ledger, qualified or not, tolerant of whitespace and
// newlines between tokens. \s spans newlines so a wrapped statement still matches.
const LEDGER_INSERT_RE = /insert\s+into\s+(?:app_data\s*\.\s*)?_eq_migrations\b/i;

const { values: args } = parseArgs({
  options: {
    base:  { type: 'string' },
    files: { type: 'string', multiple: true },
  },
  allowPositionals: false,
});

const base = args.base ?? process.env.BASE ?? 'origin/main';

// ─── resolve the set of files to lint ──────────────────────────────────────

let addedFiles;
if (args.files && args.files.length) {
  // Explicit file list (local testing) — bypass git entirely.
  addedFiles = args.files
    .map(f => relative(MIGRATIONS_DIR, resolve(process.cwd(), f)))
    .filter(rel => !rel.startsWith('..') && rel.endsWith('.sql'))
    .map(rel => join(MIGRATIONS_REL, rel).replace(/\\/g, '/'));
} else {
  try {
    // Files ADDED (A) on this branch relative to the merge-base with `base`,
    // scoped to the tenant-migrations dir. Three-dot = "what this branch added".
    const out = execFileSync('git', [
      'diff', '--diff-filter=A', '--name-only', `${base}...HEAD`, '--', MIGRATIONS_REL,
    ], { cwd: REPO_ROOT, encoding: 'utf8' });
    addedFiles = out.split('\n').map(s => s.trim()).filter(s => s.endsWith('.sql'));
  } catch (e) {
    console.error(`ERROR: could not compute git diff against '${base}'.`);
    console.error(`  ${e.message?.split('\n')[0] ?? e}`);
    console.error(`  In CI, check out with fetch-depth: 0 and pass BASE=<base sha>.`);
    console.error(`  Locally, run \`git fetch origin main\` first, or use --files <a.sql>.`);
    process.exit(1);
  }
}

if (addedFiles.length === 0) {
  console.log('[hygiene] no newly-added tenant-migration files in this diff — nothing to lint.');
  process.exit(0);
}

console.log(`[hygiene] linting ${addedFiles.length} newly-added migration file(s) against base '${base}':`);
for (const f of addedFiles) console.log(`  • ${f}`);

// ─── lint each added file for a ledger self-insert ─────────────────────────

const offenders = [];
for (const rel of addedFiles) {
  let sql;
  try {
    sql = await readFile(join(REPO_ROOT, rel), 'utf8');
  } catch (e) {
    // An added-then-deleted file can show in the diff but be absent on disk; skip.
    console.log(`  (skipped ${rel}: ${e.code ?? e.message})`);
    continue;
  }
  const m = LEDGER_INSERT_RE.exec(sql);
  if (m) {
    const line = sql.slice(0, m.index).split('\n').length;
    offenders.push({ rel, line });
  }
}

console.log('');
if (offenders.length === 0) {
  console.log('✓ migration hygiene: no new file self-inserts into app_data._eq_migrations.');
  process.exit(0);
}

console.log('✗ migration hygiene: new tenant-migration file(s) self-insert into app_data._eq_migrations.');
console.log('');
for (const o of offenders) {
  console.log(`  ${o.rel}:${o.line}  — remove the \`INSERT INTO app_data._eq_migrations (...)\` line.`);
}
console.log('');
console.log('  The runner (scripts/migrate-tenants.mjs) records the ledger row under the full');
console.log('  filename on apply. A self-insert writes a duplicate bare-named twin. See');
console.log('  SCHEMA-GOVERNANCE.md → "Ledger truth: the runner records, the file does not".');
process.exit(2);
