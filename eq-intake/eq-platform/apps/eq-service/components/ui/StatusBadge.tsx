import { cn } from '@/lib/utils/cn'

/**
 * Canonical status pill across the app.
 *
 * 2026-04-28 polish:
 *   - Leading coloured dot for stronger at-a-glance signal.
 *   - Dropped uppercase + wide tracking — reads more naturally in dense
 *     tables. Bold weight retained for discrimination.
 *   - `tone="soft" | "solid"` variant. Soft (default) = light bg / dark
 *     text (existing). Solid = saturated bg / white text for surfaces
 *     that need the badge to dominate.
 *   - `size="sm" | "md"` density control.
 *
 * Anywhere an existing surface still uses an inline `<span>` with hard-
 * coded `bg-*-50 text-*-700` classes is a candidate for migration here.
 */
export type StatusKind =
  | 'not-started'
  | 'in-progress'
  | 'complete'
  | 'blocked'
  | 'cancelled'
  | 'overdue'
  | 'active'
  | 'inactive'

interface StatusConfig {
  label: string
  /** Soft tone — light bg, dark text. Default. */
  soft: string
  /** Solid tone — saturated bg, white text. */
  solid: string
  /** Dot colour for the leading indicator (soft tone). */
  dot: string
}

const statusConfig: Record<StatusKind, StatusConfig> = {
  'not-started': { label: 'Not Started', soft: 'bg-gray-100 text-gray-700',   solid: 'bg-gray-500 text-white',   dot: 'bg-gray-400' },
  'in-progress': { label: 'In Progress', soft: 'bg-eq-ice text-eq-deep',      solid: 'bg-eq-sky text-white',     dot: 'bg-eq-sky' },
  'complete':    { label: 'Complete',    soft: 'bg-green-50 text-green-700',  solid: 'bg-green-600 text-white',  dot: 'bg-green-500' },
  'blocked':     { label: 'Blocked',     soft: 'bg-red-50 text-red-700',      solid: 'bg-red-600 text-white',    dot: 'bg-red-500' },
  'cancelled':   { label: 'Cancelled',   soft: 'bg-gray-100 text-gray-600',   solid: 'bg-gray-500 text-white',   dot: 'bg-gray-400' },
  'overdue':     { label: 'Overdue',     soft: 'bg-amber-50 text-amber-700',  solid: 'bg-amber-600 text-white',  dot: 'bg-amber-500' },
  'active':      { label: 'Active',      soft: 'bg-green-50 text-green-700',  solid: 'bg-green-600 text-white',  dot: 'bg-green-500' },
  'inactive':    { label: 'Inactive',    soft: 'bg-gray-100 text-gray-600',   solid: 'bg-gray-500 text-white',   dot: 'bg-gray-400' },
}

export interface StatusBadgeProps {
  status: StatusKind
  label?: string
  tone?: 'soft' | 'solid'
  size?: 'sm' | 'md'
  /** Render the leading dot. Default true. */
  dot?: boolean
}

export function StatusBadge({
  status,
  label,
  tone = 'soft',
  size = 'sm',
  dot = true,
}: StatusBadgeProps) {
  const config = statusConfig[status]
  const palette = tone === 'solid' ? config.solid : config.soft
  const sizing = size === 'md'
    ? 'px-2.5 py-1 text-sm gap-1.5'
    : 'px-2 py-0.5 text-xs gap-1'

  return (
    <span className={cn(
      'inline-flex items-center rounded-full font-semibold whitespace-nowrap',
      sizing,
      palette,
    )}>
      {dot && (
        <span
          aria-hidden
          className={cn(
            'inline-block rounded-full',
            size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5',
            tone === 'solid' ? 'bg-white/80' : config.dot,
          )}
        />
      )}
      {label ?? config.label}
    </span>
  )
}
