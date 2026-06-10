import { PageSkeleton } from '@/components/ui/PageSkeleton'

export default function ReportsLoading() {
  return <PageSkeleton kpiCards={4} tableRows={6} />
}
