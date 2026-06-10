export default function CalendarLoading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading calendar">
      <div>
        <div className="h-4 w-40 bg-gray-200 rounded" />
        <div className="h-8 w-48 bg-gray-300 rounded mt-3" />
        <div className="h-4 w-2/3 bg-gray-200 rounded mt-2" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          'border-l-red-300 bg-red-50/40',
          'border-l-amber-300 bg-amber-50/40',
          'border-l-indigo-300 bg-indigo-50/40',
          'border-l-emerald-300 bg-emerald-50/40',
        ].map((cls, i) => (
          <div key={i} className={`border-l-4 ${cls} border border-gray-200 rounded-lg p-4 h-[110px]`}>
            <div className="h-3 w-20 bg-gray-300 rounded" />
            <div className="h-8 w-12 bg-gray-300 rounded mt-3" />
            <div className="h-3 w-28 bg-gray-200 rounded mt-3" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-9 w-64 bg-gray-200 rounded-md" />
          <div className="h-9 w-44 bg-gray-200 rounded-md" />
          <div className="ml-auto flex gap-2">
            <div className="h-8 w-24 bg-gray-200 rounded-md" />
            <div className="h-8 w-24 bg-gray-200 rounded-md" />
            <div className="h-8 w-24 bg-gray-200 rounded-md" />
            <div className="h-8 w-28 bg-eq-ice rounded-md" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-9 w-44 bg-gray-200 rounded-md" />
          <div className="h-9 w-36 bg-gray-200 rounded-md" />
          <div className="h-9 w-36 bg-gray-200 rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-4 bg-white">
            <div className="h-5 w-24 bg-gray-300 rounded" />
            <div className="mt-4 space-y-2">
              <div className="h-4 w-full bg-gray-200 rounded" />
              <div className="h-4 w-5/6 bg-gray-200 rounded" />
              <div className="h-4 w-4/6 bg-gray-200 rounded" />
              <div className="h-4 w-3/4 bg-gray-200 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
