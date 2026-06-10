/**
 * Shared analytics primitives for maintenance compliance and site health.
 *
 * This module exists so `/reports` and any future AI features (site health
 * scoring, weekly site summaries, missing data flagging) operate on a single,
 * canonical definition of what "compliance" means. Two pages computing the
 * same metric in two different ways is the classic data-quality bug in
 * CMMS products — don't let it happen here.
 *
 * All functions are pure. No database access, no React. They take already-
 * fetched rows and return plain objects, so the same code runs in server
 * components, server actions, and scheduled batch jobs without change.
 */

import type { CheckStatus } from '@/lib/types'

// ─── Minimal row shapes ──────────────────────────────────────────────────
// Consumers usually already have richer row types; these interfaces state
// the minimum this module needs, so any wider row shape is compatible.

export interface CheckRowForCompliance {
  status: CheckStatus
  site_id: string | null
  due_date?: string | null
  completed_at?: string | null
}

// ─── Core metrics ─────────────────────────────────────────────────────────

export interface MaintenanceComplianceStats {
  total: number
  complete: number
  overdue: number
  inProgress: number
  scheduled: number
  cancelled: number
  /** Rounded percentage 0–100. Zero when total is zero. */
  complianceRate: number
}

/**
 * Aggregate maintenance compliance across a set of checks.
 * "Compliance" is defined as `complete / total` — the same definition used
 * by /reports as of Sprint 28. If this definition ever changes, change it
 * here and every consumer updates in lockstep.
 */
export function computeMaintenanceCompliance(
  checks: CheckRowForCompliance[] | null | undefined,
): MaintenanceComplianceStats {
  const rows = checks ?? []
  const total = rows.length
  const complete = rows.filter((c) => c.status === 'complete').length
  const overdue = rows.filter((c) => c.status === 'overdue').length
  const inProgress = rows.filter((c) => c.status === 'in_progress').length
  const scheduled = rows.filter((c) => c.status === 'scheduled').length
  const cancelled = rows.filter((c) => c.status === 'cancelled').length
  const complianceRate = total > 0 ? Math.round((complete / total) * 100) : 0
  return { total, complete, overdue, inProgress, scheduled, cancelled, complianceRate }
}

// ─── Per-site rollup ──────────────────────────────────────────────────────

export interface SiteComplianceRow {
  siteId: string
  siteName: string
  total: number
  complete: number
  overdue: number
  /** Rounded percentage 0–100. Zero when total is zero. */
  rate: number
}

/**
 * Roll compliance up per site. Returned rows are sorted by `total` descending
 * (highest-volume sites first), then trimmed to `limit` if provided. Sites
 * not present in `siteNameMap` fall back to their id as the display name.
 */
export function computeComplianceBySite(
  checks: CheckRowForCompliance[] | null | undefined,
  siteNameMap: Record<string, string>,
  limit?: number,
): SiteComplianceRow[] {
  const agg: Record<string, { total: number; complete: number; overdue: number }> = {}
  for (const c of checks ?? []) {
    if (!c.site_id) continue
    const row = (agg[c.site_id] ??= { total: 0, complete: 0, overdue: 0 })
    row.total++
    if (c.status === 'complete') row.complete++
    if (c.status === 'overdue') row.overdue++
  }

  const rows: SiteComplianceRow[] = Object.entries(agg).map(([siteId, r]) => ({
    siteId,
    siteName: siteNameMap[siteId] ?? siteId,
    total: r.total,
    complete: r.complete,
    overdue: r.overdue,
    rate: r.total > 0 ? Math.round((r.complete / r.total) * 100) : 0,
  }))

  rows.sort((a, b) => b.total - a.total)
  return typeof limit === 'number' ? rows.slice(0, limit) : rows
}

// ─── Composite site health score ─────────────────────────────────────────
// Drop-in hook for Phase 2 AI features. Currently returns the compliance
// rate as the score so /reports and the forthcoming dashboard insights
// agree. Later this can blend in: test pass rate, repeat failure rate,
// overdue age, defect density. Whatever it blends, it must stay in this
// file so every consumer inherits the change.

export interface SiteHealthScore {
  siteId: string
  siteName: string
  /** 0–100. Higher is healthier. */
  score: number
  /** Tier used for colour coding in UI. */
  tier: 'green' | 'amber' | 'red'
}

export function computeSiteHealthScore(row: SiteComplianceRow): SiteHealthScore {
  const score = row.rate
  let tier: SiteHealthScore['tier'] = 'red'
  if (score >= 90) tier = 'green'
  else if (score >= 70) tier = 'amber'
  return { siteId: row.siteId, siteName: row.siteName, score, tier }
}
