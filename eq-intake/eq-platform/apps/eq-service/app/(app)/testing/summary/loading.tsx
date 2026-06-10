import { PageSkeleton } from '@/components/ui/PageSkeleton'

export default function TestingSummaryLoading() {
  return <PageSkeleton kpiCards={4} tableRows={10} />
}
