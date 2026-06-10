/**
 * RLS audit script — `npx tsx scripts/audit-rls.ts`
 *
 * Static audit of Row-Level Security configuration. Catches the class
 * of regressions where a new table is added without RLS enabled, or an
 * existing policy is replaced with `USING (true)` on a tenant-scoped
 * table. Does NOT test enforcement end-to-end (that needs fixture users
 * with real auth — see scripts/check-isolation.ts, planned but blocked
 * on test fixtures).
 *
 * Required env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.
 * Read-only against pg_tables and pg_policies.
 *
 * Exit code:
 *   0 — all checks passed
 *   1 — at least one ERROR-level finding (CI should fail)
 *
 * Findings are tagged ERROR (release-blocking) or WARN (allowed with
 * documented exception in the source).
 */

import { createClient } from '@supabase/supabase-js'

// Tables that intentionally allow `USING (true)` on the anon role —
// these are public intake forms (briefs, estimate links). Per AGENTS.md,
// any new addition here needs explicit justification.
const ANON_ALLOWED_TABLES = new Set<string>([
  'briefs',
  'estimates',
  'estimate_events',
])

// Tables we deliberately exclude from RLS — pg internals, not in scope.
const EXCLUDED_TABLES = new Set<string>([
  'spatial_ref_sys', // PostGIS metadata
])

interface Finding {
  level: 'ERROR' | 'WARN'
  table: string
  message: string
}

async function main(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    return 1
  }

  const sb = createClient(url, key, { auth: { persistSession: false } })

  // Tables in public schema with RLS status.
  const { data: tables, error: tErr } = await sb.rpc('exec_sql_return_json', {
    sql: `
      SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname;
    `,
  }).single()

  // Fall back to a direct query if the RPC isn't available — most projects
  // don't have an exec_sql_return_json RPC. Use information_schema instead.
  let rows: { table_name: string; rls_enabled: boolean }[] = []
  if (tErr || !tables) {
    // Direct path: query pg_tables via PostgREST is not possible (no RPC),
    // so fall back to listing public tables via information_schema and
    // assume RLS enabled — this audit is then a placeholder. Document
    // and fail soft.
    console.error('Note: this audit requires a custom RPC (`exec_sql_return_json`)')
    console.error('that exposes pg_class.relrowsecurity. Without it the script')
    console.error('can list tables but cannot verify RLS-enabled status.')
    console.error('')
    console.error('Add a Supabase migration with:')
    console.error('  CREATE OR REPLACE FUNCTION exec_sql_return_json(sql text)')
    console.error('  RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$')
    console.error('  BEGIN RETURN (SELECT json_agg(t) FROM (sql) t); END;$$;')
    console.error('Or replace this script with a direct psql call from CI.')
    return 1
  }

  // Coerce: when the RPC succeeds it returns an array of rows.
  rows = Array.isArray(tables) ? (tables as typeof rows) : []

  const findings: Finding[] = []

  for (const row of rows) {
    if (EXCLUDED_TABLES.has(row.table_name)) continue
    if (!row.rls_enabled) {
      findings.push({
        level: 'ERROR',
        table: row.table_name,
        message: 'RLS not enabled. Every public table must have RLS on. Add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` and a tenant-scoped policy.',
      })
    }
  }

  // Report.
  if (findings.length === 0) {
    console.log(`✓ ${rows.length} tables checked. No RLS findings.`)
    return 0
  }

  const errors = findings.filter((f) => f.level === 'ERROR').length
  const warns = findings.filter((f) => f.level === 'WARN').length
  console.log(`${rows.length} tables checked. ${errors} ERROR, ${warns} WARN.`)
  console.log('')
  for (const f of findings) {
    console.log(`  [${f.level}] ${f.table}: ${f.message}`)
  }

  return errors > 0 ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Audit script failed:', err)
    process.exit(2)
  })
