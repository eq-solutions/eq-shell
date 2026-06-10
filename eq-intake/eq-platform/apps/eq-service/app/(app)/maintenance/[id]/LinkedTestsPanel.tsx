import Link from 'next/link'
import { Shield, CircuitBoard, ShieldCheck, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'

/**
 * Threshold above which the Linked Tests panel collapses by default.
 * Below this, the list is small enough to scan on first paint so we
 * leave it expanded. Above, the panel takes too much vertical space
 * (Jemena May visit can carry 16+ RCD tests) so we hide behind a
 * chevron and let the tech expand on demand.
 */
const LINKED_TESTS_COLLAPSE_THRESHOLD = 5

/**
 * Phase 3 of the Testing simplification plan — surface linked test records
 * directly inside `/maintenance/[id]` instead of forcing the user to hop into
 * the Testing tab. After Phase 2 merged testing_checks into maintenance_checks,
 * the FK story is uniform: acb/nsx_tests link via `check_id`,
 * rcd_tests via `check_id`. Both resolve to the maintenance_checks row.
 *
 * Server component so the data fetch happens server-side alongside the parent
 * page. Returns null when no tests are linked (most kind=maintenance checks).
 */

type Joined<T> = T | T[] | null
function one<T>(v: Joined<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

interface AcbNsxTestRow {
  id: string
  asset_id: string
  step1_status: string | null
  step2_status: string | null
  step3_status: string | null
  overall_result: string | null
  assets: Joined<{ id: string; name: string }>
}

interface RcdTestRow {
  id: string
  asset_id: string
  status: string
  test_date: string
  assets: Joined<{ id: string; name: string; jemena_asset_id: string | null }>
}

function progressDots({
  step1_status,
  step2_status,
  step3_status,
}: {
  step1_status: string | null
  step2_status: string | null
  step3_status: string | null
}): { done: number; total: number } {
  let done = 0
  if (step1_status === 'complete') done++
  if (step2_status === 'complete') done++
  if (step3_status === 'complete') done++
  return { done, total: 3 }
}

function statusToTone(status: string | null): 'active' | 'inactive' | 'in-progress' {
  if (status === 'complete') return 'active'
  if (status === 'archived' || status === 'cancelled') return 'inactive'
  return 'in-progress'
}

interface Props {
  checkId: string
  /** Site id — kept for parity with the legacy deep-link shape; no longer used. */
  siteId: string | null
}

export async function LinkedTestsPanel({ checkId }: Props) {
  const supabase = await createClient()

  // Fetch all three test types in parallel — a check might have any
  // combination (today: only one type per check; future: bundled checks
  // could carry mixed types).
  const [acbRes, nsxRes, rcdRes] = await Promise.all([
    supabase
      .from('acb_tests')
      .select('id, asset_id, step1_status, step2_status, step3_status, overall_result, assets(id, name)')
      .eq('check_id', checkId)
      .eq('is_active', true),
    supabase
      .from('nsx_tests')
      .select('id, asset_id, step1_status, step2_status, step3_status, overall_result, assets(id, name)')
      .eq('check_id', checkId)
      .eq('is_active', true),
    supabase
      .from('rcd_tests')
      .select('id, asset_id, status, test_date, assets(id, name, jemena_asset_id)')
      .eq('check_id', checkId)
      .eq('is_active', true)
      .order('test_date', { ascending: false }),
  ])

  const acb = (acbRes.data ?? []) as AcbNsxTestRow[]
  const nsx = (nsxRes.data ?? []) as AcbNsxTestRow[]
  const rcd = (rcdRes.data ?? []) as RcdTestRow[]

  const total = acb.length + nsx.length + rcd.length
  if (total === 0) return null

  // Summary line gives the rollup even when collapsed — keep it terse so
  // the header doesn't wrap. Only show counts for kinds that are present.
  const summaryParts: string[] = []
  if (acb.length) summaryParts.push(`${acb.length} ACB`)
  if (nsx.length) summaryParts.push(`${nsx.length} NSX`)
  if (rcd.length) summaryParts.push(`${rcd.length} RCD`)

  return (
    <CollapsibleSection
      title="Test Records"
      summary={`${total} test${total === 1 ? '' : 's'} (${summaryParts.join(', ')})`}
      defaultOpen={total <= LINKED_TESTS_COLLAPSE_THRESHOLD}
      tone="subtle"
    >
      {acb.length > 0 && (
        <TestSection
          icon={<Shield className="w-3.5 h-3.5" />}
          label={`ACB Tests (${acb.length})`}
        >
          {acb.map((t) => {
            const asset = one(t.assets)
            const { done, total } = progressDots(t)
            return (
              <TestRow
                key={t.id}
                href={`/testing/acb/${t.id}`}
                primary={asset?.name ?? '—'}
                middle={<ProgressDots done={done} total={total} />}
                trailing={
                  <ResultPill result={t.overall_result} done={done} total={total} />
                }
              />
            )
          })}
        </TestSection>
      )}

      {nsx.length > 0 && (
        <TestSection
          icon={<CircuitBoard className="w-3.5 h-3.5" />}
          label={`NSX Tests (${nsx.length})`}
        >
          {nsx.map((t) => {
            const asset = one(t.assets)
            const { done, total } = progressDots(t)
            return (
              <TestRow
                key={t.id}
                href={`/testing/nsx/${t.id}`}
                primary={asset?.name ?? '—'}
                middle={<ProgressDots done={done} total={total} />}
                trailing={
                  <ResultPill result={t.overall_result} done={done} total={total} />
                }
              />
            )
          })}
        </TestSection>
      )}

      {rcd.length > 0 && (
        <TestSection
          icon={<ShieldCheck className="w-3.5 h-3.5" />}
          label={`RCD Tests (${rcd.length})`}
        >
          {rcd.map((t) => {
            const asset = one(t.assets)
            return (
              <TestRow
                key={t.id}
                href={`/testing/rcd/${t.id}`}
                primary={asset?.name ?? '—'}
                middle={
                  asset?.jemena_asset_id ? (
                    <span className="text-[11px] font-mono text-eq-grey">
                      {asset.jemena_asset_id}
                    </span>
                  ) : null
                }
                trailing={<StatusBadge status={statusToTone(t.status)} />}
              />
            )
          })}
        </TestSection>
      )}
    </CollapsibleSection>
  )
}

function TestSection({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <div className="px-4 py-1.5 bg-gray-50 text-[11px] font-bold text-eq-grey uppercase tracking-wide flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className="divide-y divide-gray-100">{children}</div>
    </div>
  )
}

function TestRow({
  href,
  primary,
  middle,
  trailing,
}: {
  href: string
  primary: string
  middle: React.ReactNode
  trailing: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-eq-ice/40 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="text-sm font-medium text-eq-ink truncate">{primary}</span>
        {middle}
      </div>
      <div className="flex items-center gap-2">
        {trailing}
        <ChevronRight className="w-4 h-4 text-eq-grey" />
      </div>
    </Link>
  )
}

function ProgressDots({ done, total }: { done: number; total: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`${done} of ${total} steps complete`}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`w-2 h-2 rounded-full ${i < done ? 'bg-eq-sky' : 'bg-gray-200'}`}
        />
      ))}
      <span className="ml-1 text-[11px] text-eq-grey tabular-nums">
        {done}/{total}
      </span>
    </span>
  )
}

function ResultPill({
  result,
  done,
  total,
}: {
  result: string | null
  done: number
  total: number
}) {
  // Prefer the explicit overall_result when set; fall back to a derived
  // status if all steps are done but result is still 'Pending'.
  const display =
    result && result !== 'Pending'
      ? result
      : done === total
        ? 'Complete'
        : done > 0
          ? 'In progress'
          : 'Pending'

  const tone =
    display === 'Pass' || display === 'Complete'
      ? 'bg-green-50 text-green-700 border-green-200'
      : display === 'Fail' || display === 'Defect'
        ? 'bg-red-50 text-red-700 border-red-200'
        : display === 'In progress'
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-gray-50 text-gray-600 border-gray-200'

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium ${tone}`}>
      {display}
    </span>
  )
}
