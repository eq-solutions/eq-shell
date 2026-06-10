import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TestDetailHeader } from '@/components/ui/TestDetailHeader'
import { NsxTestWorkflowClient } from './NsxTestWorkflowClient'
import type { NsxTest, NsxTestReading } from '@/lib/types'

type Joined<T> = T | T[] | null
function one<T>(v: Joined<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

/**
 * Dedicated, deep-linkable detail page for a single NSX test.
 *
 * Shell chrome lives in TestDetailHeader (PR P, Phase 4 medium).
 */
export default async function NsxTestDetailPage({
  params,
}: {
  params: Promise<{ testId: string }>
}) {
  const { testId } = await params
  const supabase = await createClient()

  const { data: test, error } = await supabase
    .from('nsx_tests')
    .select('*, assets(name), sites(name), maintenance_checks!check_id(id, custom_name)')
    .eq('id', testId)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !test) notFound()

  const { data: readings } = await supabase
    .from('nsx_test_readings')
    .select('*')
    .eq('nsx_test_id', testId)
    .order('sort_order')

  const asset = one(test.assets as Joined<{ name: string }>)
  const site = one(test.sites as Joined<{ name: string }>)
  const linkedCheck = one(
    test.maintenance_checks as Joined<{ id: string; custom_name: string | null }>,
  )

  return (
    <div className="space-y-6">
      <TestDetailHeader
        testTypeLabel="NSX Testing"
        testTypePath="/testing/nsx"
        title={asset?.name ?? 'NSX Test'}
        subtitle={
          <>
            {site?.name ?? '—'}
            <span> · {test.test_date}</span>
            {linkedCheck && (
              <>
                {' · '}
                <Link
                  href={`/maintenance/${linkedCheck.id}`}
                  className="text-eq-deep hover:text-eq-sky underline"
                >
                  {linkedCheck.custom_name ?? 'linked check'}
                </Link>
              </>
            )}
          </>
        }
      />

      <NsxTestWorkflowClient
        test={test as NsxTest}
        readings={(readings ?? []) as NsxTestReading[]}
      />
    </div>
  )
}
