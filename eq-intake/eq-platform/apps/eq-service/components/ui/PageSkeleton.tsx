interface PageSkeletonProps {
  /** Number of KPI cards to render in the strip. 0 = no strip. */
  kpiCards?: number
  /** Number of skeleton table rows. */
  tableRows?: number
  /** Optional breadcrumb width in tailwind classes (e.g. "w-40"). */
  breadcrumbWidth?: string
}

export function PageSkeleton({
  kpiCards = 0,
  tableRows = 8,
  breadcrumbWidth = 'w-40',
}: PageSkeletonProps) {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading">
      <div>
        <div className={`h-4 ${breadcrumbWidth} bg-gray-200 rounded`} />
        <div className="h-8 w-48 bg-gray-300 rounded mt-3" />
        <div className="h-4 w-2/3 bg-gray-200 rounded mt-2" />
      </div>

      {kpiCards > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: kpiCards }).map((_, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-4 h-[110px] bg-white">
              <div className="h-3 w-20 bg-gray-200 rounded" />
              <div className="h-8 w-12 bg-gray-300 rounded mt-3" />
              <div className="h-3 w-28 bg-gray-200 rounded mt-3" />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="h-9 w-64 bg-gray-200 rounded-md" />
        <div className="h-9 w-44 bg-gray-200 rounded-md" />
        <div className="ml-auto flex gap-2">
          <div className="h-8 w-24 bg-gray-200 rounded-md" />
          <div className="h-8 w-24 bg-gray-200 rounded-md" />
          <div className="h-8 w-28 bg-eq-ice rounded-md" />
        </div>
      </div>

      <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <div className="h-4 w-32 bg-gray-300 rounded" />
        </div>
        <div className="divide-y divide-gray-100">
          {Array.from({ length: tableRows }).map((_, i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3">
              <div className="h-4 w-1/4 bg-gray-200 rounded" />
              <div className="h-4 w-1/3 bg-gray-200 rounded" />
              <div className="h-4 w-1/6 bg-gray-200 rounded ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
