/**
 * Coloured pill for a maintenance_check.kind discriminator. Surfaces "is this
 * a PPM check or an ACB/NSX/RCD test bench?" at a glance in lists and panels.
 *
 * Promoted out of MaintenanceList.tsx so the pattern can be reused (defect
 * lists, dashboard cards, future surfaces) without copy-paste — and to bring
 * it under the canonical components/ui/ pill family alongside StatusBadge.
 */

export type CheckKind = 'maintenance' | 'acb' | 'nsx' | 'rcd' | 'general'

const KIND_CONFIG: Record<CheckKind, { label: string; cls: string }> = {
  maintenance: { label: 'PPM',     cls: 'bg-eq-ice text-eq-deep' },
  acb:         { label: 'ACB',     cls: 'bg-purple-50 text-purple-700' },
  nsx:         { label: 'NSX',     cls: 'bg-indigo-50 text-indigo-700' },
  rcd:         { label: 'RCD',     cls: 'bg-amber-50 text-amber-700' },
  general:     { label: 'General', cls: 'bg-gray-100 text-gray-700' },
}

export function KindPill({ kind }: { kind: CheckKind | string | null | undefined }) {
  const c = KIND_CONFIG[(kind ?? 'maintenance') as CheckKind] ?? KIND_CONFIG.maintenance
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ${c.cls}`}>
      {c.label}
    </span>
  )
}
