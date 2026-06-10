import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TestDetailHeader } from '@/components/ui/TestDetailHeader'
import { AcbTestWorkflowClient } from './AcbTestWorkflowClient'
import type { AcbTest, AcbTestReading } from '@/lib/types'

type Joined<T> = T | T[] | null
function one<T>(v: Joined<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

/**
 * Dedicated, deep-linkable detail page for a single ACB test.
 *
 * Shell chrome (breadcrumb / heading / subtitle / back link) lives in the
 * shared TestDetailHeader component (PR P, Phase 4 medium). Workflow
 * content unchanged — AcbTestWorkflowClient mounts the existing
 * AcbWorkflow inside a thin wrapper that wires router.refresh() to
 * onUpdate.
 */
export default async function AcbTestDetailPage({
  params,
}: {
  params: Promise<{ testId: string }>
}) {
  const { testId } = await params
  const supabase = await createClient()

  const { data: test, error } = await supabase
    .from('acb_tests')
    .select('*, assets(name), sites(name), maintenance_checks!check_id(id, custom_name)')
    .eq('id', testId)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !test) notFound()

  const { data: readings } = await supabase
    .from('acb_test_readings')
    .select('*')
    .eq('acb_test_id', testId)
    .order('sort_order')

  const asset = one(test.assets as Joined<{ name: string }>)
  const site = one(test.sites as Joined<{ name: string }>)
  const linkedCheck = one(
    test.maintenance_checks as Joined<{ id: string; custom_name: string | null }>,
  )

  return (
    <div className="space-y-6">
      <TestDetailHeader
        testTypeLabel="ACB Testing"
        testTypePath="/testing/acb"
        title={asset?.name ?? 'ACB Test'}
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

      <AcbTestWorkflowClient
        test={test as AcbTest}
        readings={(readings ?? []) as AcbTestReading[]}
      />
    </div>
  )
}
