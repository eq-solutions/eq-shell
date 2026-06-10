import { cn } from '@/lib/utils/cn'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Pre-built shapes for common loading scenarios. Use `custom` (or omit) to size with className. */
  shape?: 'text' | 'line' | 'circle' | 'card' | 'custom'
}

/**
 * Animated grey placeholder block — use as a stand-in for content that's still
 * loading. Shimmer pulse via Tailwind `animate-pulse`.
 *
 * Common patterns:
 *   <Skeleton shape="text" className="w-32" />        → one line of text
 *   <Skeleton shape="circle" className="w-10 h-10" /> → avatar
 *   <Skeleton shape="card" />                         → full card placeholder
 *
 * Pair with <SkeletonRows count={5} /> for table loading states.
 */
export function Skeleton({ shape = 'custom', className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse bg-gray-200',
        {
          'h-4 rounded': shape === 'text',
          'h-2 rounded-full': shape === 'line',
          'rounded-full': shape === 'circle',
          'h-32 w-full rounded-lg': shape === 'card',
        },
        className
      )}
      {...props}
    />
  )
}

/**
 * Renders N rows of skeleton placeholders sized to fit a DataTable row.
 * Use inside <tbody> when data is loading.
 */
export function SkeletonRows({ count = 5, columns = 4 }: { count?: number; columns?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, rowIdx) => (
        <tr key={rowIdx} className="border-b border-gray-100">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <td key={colIdx} className="px-4 py-3">
              <Skeleton
                shape="text"
                className={cn({
                  'w-3/4': colIdx === 0,
                  'w-1/2': colIdx === 1,
                  'w-2/3': colIdx === 2,
                  'w-1/3': colIdx > 2,
                })}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

/**
 * Card-shaped skeleton grid — use for KPI cards, dashboard tiles, or anywhere
 * you'd render a grid of cards while data loads.
 */
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
          <Skeleton shape="text" className="w-1/2" />
          <Skeleton shape="text" className="w-3/4 h-8" />
          <Skeleton shape="text" className="w-1/3" />
        </div>
      ))}
    </div>
  )
}
