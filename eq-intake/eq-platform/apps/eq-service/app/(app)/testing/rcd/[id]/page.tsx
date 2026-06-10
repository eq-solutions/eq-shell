import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/actions/auth'
import { canDoTestWork } from '@/lib/utils/roles'
import { TestDetailHeader } from '@/components/ui/TestDetailHeader'
import { RcdTestEditor, type RcdTestEditorCircuit } from './RcdTestEditor'

type Joined<T> = T | T[] | null

function one<T>(v: Joined<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

/**
 * RCD test detail — header card + per-circuit grid with onsite edit mode.
 *
 * Server component handles auth + data fetch. Render is delegated to the
 * RcdTestEditor client component which toggles between read-only and edit
 * mode. Edit mode lets writers update timing values, button checks, and
 * action notes; "Save & mark complete" propagates to the linked
 * maintenance_check (if any).
 */
export default async function RcdTestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { role } = await requireUser()
  const supabase = await createClient()

  const { data: test, error } = await supabase
    .from('rcd_tests')
    .select(
      '*, sites(name, code), assets(name, jemena_asset_id, manufacturer, model, location), customers(name)',
    )
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !test) notFound()

  const site = one(test.sites as Joined<{ name: string; code: string | null }>)
  const asset = one(test.assets as Joined<{
    name: string
    jemena_asset_id: string | null
    manufacturer: string | null
    model: string | null
    location: string | null
  }>)
  const customer = one(test.customers as Joined<{ name: string }>)

  const { data: circuits } = await supabase
    .from('rcd_test_circuits')
    .select('*')
    .eq('rcd_test_id', id)
    .order('sort_order')
    .order('section_label', { nullsFirst: true })
    .order('circuit_no')

  return (
    <div className="space-y-6">
      <TestDetailHeader
        testTypeLabel="RCD Testing"
        testTypePath="/testing/rcd"
        title={asset?.name ?? 'RCD Test'}
        subtitle={
          <>
            {site?.name ?? '—'}
            {customer?.name && <span> · {customer.name}</span>}
            <span> · {test.test_date}</span>
            {test.check_id && (
              <>
                {' · '}
                <Link
                  href={`/maintenance/${test.check_id}`}
                  className="text-eq-deep hover:text-eq-sky underline"
                >
                  linked maintenance check
                </Link>
              </>
            )}
          </>
        }
      />

      <RcdTestEditor
        test={{
          id: test.id,
          test_date: test.test_date,
          status: test.status,
          technician_name_snapshot: test.technician_name_snapshot,
          technician_initials: test.technician_initials,
          site_rep_name: test.site_rep_name,
          equipment_used: test.equipment_used,
          notes: test.notes,
          check_id: test.check_id,
        }}
        initialCircuits={(circuits ?? []) as RcdTestEditorCircuit[]}
        canEdit={canDoTestWork(role)}
        siteName={site?.name ?? null}
        assetName={asset?.name ?? null}
      />
    </div>
  )
}
