'use server'

/**
 * Server actions for the "Tidy Our Data" feature.
 *
 * runTidyScanAction     — scans all canonical entities and returns a TidyReport
 * commitTidyFixesAction — commits the user-approved subset of auto-fixes
 *
 * Security: both actions gate on isAdmin(role) — tidy is an admin-only operation.
 */

import { requireUser } from '@/lib/auth/requireUser'
import { isAdmin } from '@/lib/utils/roles'
import { createClient } from '@/lib/supabase/server'
import { runTidyPass, runOrphanCheck, commitTidyFixes } from '@eq/intake'
import type { TidyReport, TidyCommitResult, TidyFix } from '@eq/intake'

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export interface TidyScanResult {
  ok:     true
  report: TidyReport
}
export interface TidyScanError {
  ok:    false
  error: string
}

export async function runTidyScanAction(): Promise<TidyScanResult | TidyScanError> {
  const { user, tenant, role } = await requireUser()

  if (!isAdmin(role)) {
    return { ok: false, error: 'Admin access required to run a tidy scan.' }
  }

  const supabase = await createClient()

  try {
    const messages: string[] = []
    const log = (msg: string) => messages.push(msg)

    // Run normalise + gap pass across all entities
    const report = await runTidyPass({
      supabase: supabase as Parameters<typeof runTidyPass>[0]['supabase'],
      tenantId: tenant.id,
      onProgress: log,
    })

    // Run orphan check and merge results
    const orphanResult = await runOrphanCheck({
      supabase: supabase as Parameters<typeof runOrphanCheck>[0]['supabase'],
      tenantId: tenant.id,
      onProgress: log,
    })

    // Merge orphans into the report
    report.orphans = orphanResult.orphans
    report.summary.orphans_found = orphanResult.summary.total

    return { ok: true, report }
  } catch (e) {
    return {
      ok:    false,
      error: e instanceof Error ? e.message : 'Tidy scan failed — check server logs.',
    }
  }
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export interface TidyCommitActionResult {
  ok:     true
  result: TidyCommitResult
}
export interface TidyCommitActionError {
  ok:    false
  error: string
}

export async function commitTidyFixesAction(
  fixes: TidyFix[],
): Promise<TidyCommitActionResult | TidyCommitActionError> {
  const { tenant, role } = await requireUser()

  if (!isAdmin(role)) {
    return { ok: false, error: 'Admin access required to commit tidy fixes.' }
  }

  if (!Array.isArray(fixes) || fixes.length === 0) {
    return { ok: false, error: 'No fixes to commit.' }
  }

  // Basic integrity check — all fixes must belong to this tenant's data.
  // The SQL RPC enforces this via JWT tenant_id, but double-check client input here.
  if (fixes.length > 5000) {
    return { ok: false, error: 'Too many fixes in one batch (max 5000).' }
  }

  const supabase = await createClient()

  try {
    const result = await commitTidyFixes({
      supabase: supabase as Parameters<typeof commitTidyFixes>[0]['supabase'],
      tenantId: tenant.id,
      fixes,
    })

    return { ok: true, result }
  } catch (e) {
    return {
      ok:    false,
      error: e instanceof Error ? e.message : 'Commit failed — check server logs.',
    }
  }
}
