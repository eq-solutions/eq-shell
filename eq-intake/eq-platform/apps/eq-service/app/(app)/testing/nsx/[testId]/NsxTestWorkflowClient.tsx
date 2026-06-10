'use client'

import { useRouter } from 'next/navigation'
import { NsxWorkflow } from '../NsxWorkflow'
import type { NsxTest, NsxTestReading } from '@/lib/types'

/**
 * Thin client wrapper around NsxWorkflow for the dedicated detail page.
 * Translates onUpdate into router.refresh().
 */
export function NsxTestWorkflowClient({
  test,
  readings,
}: {
  test: NsxTest
  readings: NsxTestReading[]
}) {
  const router = useRouter()
  return <NsxWorkflow test={test} readings={readings} onUpdate={() => router.refresh()} />
}
