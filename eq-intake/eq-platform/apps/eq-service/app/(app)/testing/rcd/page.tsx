import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ShieldCheck } from 'lucide-react'

type Joined<T> = T | T[] | null

function one<T>(v: Joined<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

function statusToTone(status: string): 'active' | 'inactive' | 'in-progress' {
  if (status === 'complete') return 'active'
  if (status === 'archived') return 'inactive'
  return 'in-progress'
}

/**
 * RCD Testing — list of all rcd_tests for the tenant.
 *
 * Phase 1 read-only view (server component). Filters delegated to URL
 * params (?site_id=...&customer_id=...&status=...) so the standard
 * SearchFilter pattern works on the client side via useSearchParams.
 *
 * Click a row → /testing/rcd/[id] detail page.
 *
 * Phase 2+ (separate PRs): xlsx import button, in-app circuit entry,
 * status workflow, report regeneration.
 */
export default async function RcdTestingPage({
  searchParams,
}: {
  searchParams: Promise<{
    site_id?: string
    customer_id?: string
    status?: string
  }>
}) {
  const params = await searchParams
  const siteId = params.site_id ?? ''
  const customerId = params.customer_id ?? ''
  const status = params.status ?? ''

  const supabase = await createClient()

  // Build query. Joins for display columns.
  let query = supabase
    .from('rcd_tests')
    .select(
      `id, test_date, technician_name_snapshot, technician_initials, status,
       sites(name), assets(name, jemena_asset_id), customers(name)`,
      { count: 'exact' },
    )
    .eq('is_active', true)
    .order('test_date', { ascending: false })

  if (siteId) query = query.eq('site_id', siteId)
  if (customerId) query = query.eq('customer_id', customerId)
  if (status) query = query.eq('status', status)

  const { data: tests, count } = await query

  // Per-test circuit count (cheap second query — counts only).
  const ids = (tests ?? []).map((t) => t.id)
  const circuitCountByTest = new Map<string, number>()
  if (ids.length > 0) {
    const { data: cc } = await supabase
      .from('rcd_test_circuits')
      .select('rcd_test_id', { count: 'exact', head: false })
      .in('rcd_test_id', ids)
    for (const r of cc ?? []) {
      circuitCountByTest.set(
        r.rcd_test_id,
        (circuitCountByTest.get(r.rcd_test_id) ?? 0) + 1,
      )
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-eq-ink">RCD Test Records</h2>
          <p className="text-sm text-eq-grey mt-0.5">
            Per-board RCD time-trip tests. {count ?? 0} record{(count ?? 0) === 1 ? '' : 's'}.
          </p>
        </div>
        <Link
          href="/testing/rcd/import"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-eq-sky hover:bg-eq-deep rounded-md"
        >
          <ShieldCheck className="w-4 h-4" />
          Import xlsx
        </Link>
      </div>

      {!tests || tests.length === 0 ? (
        <div className="border border-gray-200 rounded-lg bg-white p-12 text-center">
          <ShieldCheck className="w-10 h-10 text-eq-grey mx-auto mb-3 opacity-50" />
          <p className="text-sm text-eq-ink font-medium mb-1">No RCD tests yet</p>
          <p className="text-xs text-eq-grey">
            Records appear here after the xlsx importer ingests Jemena&apos;s field test data,
            or once the in-app entry workflow lands. Both are queued.
          </p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-eq-ice text-eq-deep">
              <tr>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Date</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Site</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Board</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">JM #</th>
                <th className="text-right px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Circuits</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Technician</th>
                <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => {
                const site = one(t.sites as Joined<{ name: string }>)
                const asset = one(
                  t.assets as Joined<{ name: string; jemena_asset_id: string | null }>,
                )
                return (
                  <tr
                    key={t.id}
                    className="border-t border-gray-100 hover:bg-eq-ice/50 cursor-pointer"
                  >
                    <td className="px-3 py-2">
                      <Link href={`/testing/rcd/${t.id}`} className="block">
                        {t.test_date}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/testing/rcd/${t.id}`} className="block">
                        {site?.name ?? '—'}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-medium text-eq-ink">
                      <Link href={`/testing/rcd/${t.id}`} className="block">
                        {asset?.name ?? '—'}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-eq-grey">
                      {asset?.jemena_asset_id ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {circuitCountByTest.get(t.id) ?? 0}
                    </td>
                    <td className="px-3 py-2 text-eq-grey">
                      {t.technician_name_snapshot ?? '—'}
                      {t.technician_initials && (
                        <span className="ml-1.5 font-mono text-xs">
                          ({t.technician_initials})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={statusToTone(t.status)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
