'use client'

import { useRouter } from 'next/navigation'
import { AcbWorkflow } from '../AcbWorkflow'
import type { AcbTest, AcbTestReading } from '@/lib/types'

/**
 * Thin client wrapper around AcbWorkflow for the dedicated detail page.
 * Translates the workflow's onUpdate callback into a router.refresh() so
 * the server-fetched test + readings re-load after each save.
 */
export function AcbTestWorkflowClient({
  test,
  readings,
}: {
  test: AcbTest
  readings: AcbTestReading[]
}) {
  const router = useRouter()
  return <AcbWorkflow test={test} readings={readings} onUpdate={() => router.refresh()} />
}
