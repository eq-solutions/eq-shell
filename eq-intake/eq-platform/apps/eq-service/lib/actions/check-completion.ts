/**
 * Maintenance check auto-completion.
 *
 * Phase 4 of the Testing simplification (2026-04-28). When a linked test
 * transitions into a "done" state, any of {ACB, NSX, RCD} test save
 * actions can call this helper. If every test linked to the parent
 * `maintenance_check` is complete, the parent is auto-flipped to status
 * 'complete' + `completed_at = now()`.
 *
 * Already-complete parents are skipped — the helper never clobbers an
 * existing `completed_at` timestamp.
 *
 * Linkage:
 *   acb_tests.check_id  → maintenance_checks.id
 *   nsx_tests.check_id  → maintenance_checks.id
 *   rcd_tests.check_id          → maintenance_checks.id
 *
 * "Complete" definition per type:
 *   ACB / NSX:  step3_status = 'complete' AND overall_result IN ('Pass','Fail','Defect')
 *   RCD:        status = 'complete'
 *
 * Best-effort: any error here is logged but does not fail the calling
 * action. The test save still succeeds; the parent just won't propagate.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'

interface AcbNsxRow {
  step3_status: string | null
  overall_result: string | null
}

interface RcdRow {
  status: string | null
}

function isAcbNsxComplete(row: AcbNsxRow): boolean {
  return (
    row.step3_status === 'complete' &&
    !!row.overall_result &&
    row.overall_result !== 'Pending'
  )
}

function isRcdComplete(row: RcdRow): boolean {
  return row.status === 'complete'
}

export async function propagateCheckCompletionIfReady(
  supabase: SupabaseClient,
  checkId: string,
): Promise<void> {
  try {
    // Pull current parent status alongside the linked tests in one round
    // trip. If the parent is already complete or doesn't exist, skip.
    const [parentRes, acbRes, nsxRes, rcdRes] = await Promise.all([
      supabase
        .from('maintenance_checks')
        .select('status, completed_at')
        .eq('id', checkId)
        .maybeSingle(),
      supabase
        .from('acb_tests')
        .select('step3_status, overall_result')
        .eq('check_id', checkId)
        .eq('is_active', true),
      supabase
        .from('nsx_tests')
        .select('step3_status, overall_result')
        .eq('check_id', checkId)
        .eq('is_active', true),
      supabase
        .from('rcd_tests')
        .select('status')
        .eq('check_id', checkId)
        .eq('is_active', true),
    ])

    if (!parentRes.data) return
    if (parentRes.data.status === 'complete') return

    const acb = (acbRes.data ?? []) as AcbNsxRow[]
    const nsx = (nsxRes.data ?? []) as AcbNsxRow[]
    const rcd = (rcdRes.data ?? []) as RcdRow[]
    const total = acb.length + nsx.length + rcd.length
    if (total === 0) return

    const done =
      acb.filter(isAcbNsxComplete).length +
      nsx.filter(isAcbNsxComplete).length +
      rcd.filter(isRcdComplete).length

    if (done < total) return

    await supabase
      .from('maintenance_checks')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
      })
      .eq('id', checkId)
  } catch (e) {
    // Best-effort — log and swallow. The triggering save has already
    // committed; failing the propagation shouldn't surface to the user.
    // But surface to Sentry so we know if propagation is silently failing
    // in production (silent failure means parent checks never auto-complete
    // and nobody notices until someone manually checks status).
    // eslint-disable-next-line no-console
    console.error('propagateCheckCompletionIfReady failed', { checkId, error: e })
    Sentry.captureException(e, {
      tags: { source: 'propagateCheckCompletionIfReady' },
      extra: { checkId },
    })
  }
}
