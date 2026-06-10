import type { JobPlanItem } from '@/lib/types'

/**
 * Compact frequency badge strip for a maintenance plan item. Renders only the
 * frequencies that are flagged true. Used by the Maintenance Plans master register
 * and the Maintenance Plan edit panel item table.
 *
 * Order is fixed (shortest → longest) so a row's badges always read the same.
 * Dark-site is rendered first as a separate dark pill so it's distinguishable
 * at a glance.
 */

export type FrequencyKey =
  | 'freq_monthly'
  | 'freq_quarterly'
  | 'freq_semi_annual'
  | 'freq_annual'
  | 'freq_2yr'
  | 'freq_3yr'
  | 'freq_5yr'
  | 'freq_8yr'
  | 'freq_10yr'

export const FREQUENCY_DEFS: { key: FrequencyKey; short: string; label: string }[] = [
  { key: 'freq_monthly',     short: 'M',   label: 'Monthly' },
  { key: 'freq_quarterly',   short: 'Q',   label: 'Quarterly' },
  { key: 'freq_semi_annual', short: '6M',  label: 'Semi-annual' },
  { key: 'freq_annual',      short: 'A',   label: 'Annual' },
  { key: 'freq_2yr',         short: '2Y',  label: '2 yearly' },
  { key: 'freq_3yr',         short: '3Y',  label: '3 yearly' },
  { key: 'freq_5yr',         short: '5Y',  label: '5 yearly' },
  { key: 'freq_8yr',         short: '8Y',  label: '8 yearly' },
  { key: 'freq_10yr',        short: '10Y', label: '10 yearly' },
]

type FrequencyFlags = Pick<JobPlanItem, FrequencyKey | 'dark_site'>

interface Props {
  item: FrequencyFlags
  size?: 'xs' | 'sm'
}

export function FrequencyBadges({ item, size = 'sm' }: Props) {
  const padding = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
  const active = FREQUENCY_DEFS.filter((f) => item[f.key])

  if (active.length === 0 && !item.dark_site) {
    return <span className="text-[10px] text-gray-300 italic">none</span>
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {item.dark_site && (
        <span
          className={`${padding} font-bold uppercase tracking-wide rounded bg-eq-ink text-white`}
          title="Dark site task"
        >
          DS
        </span>
      )}
      {active.map((f) => (
        <span
          key={f.key}
          className={`${padding} font-semibold rounded bg-eq-ice text-eq-deep border border-eq-sky/30`}
          title={f.label}
        >
          {f.short}
        </span>
      ))}
    </div>
  )
}
