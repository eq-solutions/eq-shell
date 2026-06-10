'use client'

interface ChartData {
  months: string[]
  generalByMonth: number[]
  acbByMonth: number[]
  nsxByMonth: number[]
  complianceByMonth: (number | null)[]
}

export function AnalyticsCharts({ data }: { data: ChartData }) {
  const { months, generalByMonth, acbByMonth, nsxByMonth, complianceByMonth } = data

  // Max for test volume scale
  const maxTests = Math.max(
    ...generalByMonth.map((g, i) => g + acbByMonth[i] + nsxByMonth[i]),
    1
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Test Volume Chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-5">Test Volume (Last 12 Months)</h2>
        <div className="flex items-end gap-1.5 h-48">
          {months.map((month, i) => {
            const gen = generalByMonth[i]
            const acb = acbByMonth[i]
            const nsx = nsxByMonth[i]
            const total = gen + acb + nsx
            const heightPct = maxTests > 0 ? (total / maxTests) * 100 : 0

            return (
              <div key={month} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full flex flex-col justify-end" style={{ height: '180px' }}>
                  <div className="w-full flex flex-col-reverse gap-0.5">
                    {gen > 0 && (
                      <div
                        className="w-full bg-sky-400 rounded-sm shadow-sm hover:shadow-md transition-shadow"
                        style={{ height: `${(gen / maxTests) * 180}px` }}
                        title={`General: ${gen}`}
                      />
                    )}
                    {acb > 0 && (
                      <div
                        className="w-full bg-blue-700 rounded-sm shadow-sm hover:shadow-md transition-shadow"
                        style={{ height: `${(acb / maxTests) * 180}px` }}
                        title={`ACB: ${acb}`}
                      />
                    )}
                    {nsx > 0 && (
                      <div
                        className="w-full bg-amber-400 rounded-sm shadow-sm hover:shadow-md transition-shadow"
                        style={{ height: `${(nsx / maxTests) * 180}px` }}
                        title={`NSX: ${nsx}`}
                      />
                    )}
                    {total === 0 && (
                      <div className="w-full bg-gray-100 rounded-sm" style={{ height: '2px' }} />
                    )}
                  </div>
                </div>
                <span className="text-[9px] text-eq-grey whitespace-nowrap font-medium">{month}</span>
              </div>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-5 text-xs">
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-sky-400 inline-block" /> <span>General</span></span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-blue-700 inline-block" /> <span>ACB</span></span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" /> <span>NSX</span></span>
        </div>
      </div>

      {/* Compliance Trend Chart */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-5">Maintenance Compliance Trend</h2>
        <div className="flex items-end gap-1.5 h-48">
          {months.map((month, i) => {
            const val = complianceByMonth[i]
            const heightPct = val !== null ? val : 0
            const color = val === null
              ? 'bg-gray-100'
              : val >= 80
                ? 'bg-green-500'
                : val >= 50
                  ? 'bg-amber-500'
                  : 'bg-red-500'

            return (
              <div key={month} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full flex flex-col justify-end" style={{ height: '180px' }}>
                  <div
                    className={`w-full ${color} rounded-sm shadow-sm hover:shadow-md transition-all`}
                    style={{ height: val !== null ? `${(val / 100) * 180}px` : '2px' }}
                    title={val !== null ? `${val}%` : 'No data'}
                  />
                </div>
                <span className="text-[9px] text-eq-grey whitespace-nowrap font-medium">{month}</span>
              </div>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-5 text-xs">
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block" /> <span>≥80%</span></span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-amber-500 inline-block" /> <span>50–79%</span></span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> <span>&lt;50%</span></span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-gray-100 inline-block" /> <span>No data</span></span>
        </div>
      </div>
    </div>
  )
}
