/**
 * Report-duration canary.
 *
 * Synchronous DOCX/PDF report routes (pm-asset-report, maintenance-checklist,
 * compliance-report) have a Netlify maxDuration of 60s and currently take
 * ~20s at the largest known scale (Jemena multi-site, 50+ linked tests).
 * There's ~3x headroom today.
 *
 * Rather than pre-emptively refactor to an async/background pipeline (a
 * multi-week piece of work designed in docs/architecture/report-delivery.md),
 * this canary surfaces when a report run actually approaches the cap. If
 * Sentry starts seeing these warnings in production, the async refactor is
 * now load-bearing and gets prioritised. Until then, the sync path is good
 * enough.
 *
 * Pattern matches the .limit(10000) scaling canaries added in PR #145 and
 * the audit_logs size canary in PR #132 — install monitoring, surgery on
 * fire.
 */

import * as Sentry from '@sentry/nextjs'

const WARN_THRESHOLD_MS = 30_000
const ERROR_THRESHOLD_MS = 50_000

export interface SlowReportRun {
  route: string
  checkId?: string | null
  durationMs: number
  status: number
  scale?: Record<string, number | string | null>
}

/**
 * Inline canary — call once at the end of a long-running report handler with
 * the measured duration and any scale context worth attaching. No-ops if the
 * run was under the warn threshold. Idempotent on the success and error
 * paths (callers fire both).
 *
 * Severities:
 *  - 30s+  → 'warning' — "approaching the cap, plan refactor"
 *  - 50s+  → 'error'   — "imminent timeout, refactor now"
 */
export function captureSlowReportRun(run: SlowReportRun): void {
  if (run.durationMs < WARN_THRESHOLD_MS) return
  const level: 'warning' | 'error' =
    run.durationMs >= ERROR_THRESHOLD_MS ? 'error' : 'warning'
  Sentry.captureMessage(
    `Report run took ${(run.durationMs / 1000).toFixed(1)}s on ${run.route}`,
    {
      level,
      tags: {
        canary: 'report_duration',
        route: run.route,
        status: String(run.status),
      },
      extra: {
        durationMs: run.durationMs,
        checkId: run.checkId ?? null,
        scale: run.scale ?? {},
        warnThresholdMs: WARN_THRESHOLD_MS,
        errorThresholdMs: ERROR_THRESHOLD_MS,
      },
    },
  )
}
