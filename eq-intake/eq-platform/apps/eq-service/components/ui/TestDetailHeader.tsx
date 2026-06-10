import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { Breadcrumb } from '@/components/ui/Breadcrumb'

/**
 * Shared header chrome for the per-test detail pages.
 *
 * Pre-2026-04-28 the three test types each rendered their own breadcrumb +
 * heading + subtitle + back-link block (PR #32 introduced /testing/{acb,
 * nsx}/[testId] dedicated routes mirroring /testing/rcd/[id]). The blocks
 * were near-identical with small differences — type label, back label,
 * subtitle facts. PR P (Phase 4 medium) extracts that pattern into one
 * component so all three feel uniform.
 *
 * What this component DOES NOT touch: the workflow content below the
 * header. Each test type's existing client component (AcbWorkflow,
 * NsxWorkflow, RcdTestEditor) is unchanged.
 */
export interface TestDetailHeaderProps {
  /** "ACB Testing" / "NSX Testing" / "RCD Testing" — drives the breadcrumb. */
  testTypeLabel: string
  /** "/testing/acb" / "/testing/nsx" / "/testing/rcd" — back link target. */
  testTypePath: string
  /** Heading text. Asset name when available, otherwise generic fallback. */
  title: string
  /** Subtitle facts shown below the title. Render the line however you want. */
  subtitle?: React.ReactNode
}

export function TestDetailHeader({
  testTypeLabel,
  testTypePath,
  title,
  subtitle,
}: TestDetailHeaderProps) {
  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Testing', href: '/testing' },
          { label: testTypeLabel, href: testTypePath },
          { label: title },
        ]}
      />
      <div className="flex items-center justify-between mt-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-3xl font-bold text-eq-sky truncate">{title}</h2>
          {subtitle && (
            <p className="text-sm text-eq-grey mt-1">{subtitle}</p>
          )}
        </div>
        <Link
          href={testTypePath}
          className="text-sm text-eq-deep hover:text-eq-sky inline-flex items-center gap-1 shrink-0 ml-4"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </Link>
      </div>
    </div>
  )
}
