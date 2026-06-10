'use client'

import { Printer } from 'lucide-react'
import { SplitButton } from '@/components/ui/SplitButton'

/**
 * Replaces the old "Print — Simple" / "Print — Detailed" pair with a single
 * action button + caret dropdown. Default action is the Standard report
 * (covers most use cases). Dropdown lets the user override to Summary or
 * Detailed for a given print.
 *
 * Each option opens a new tab against /api/maintenance-checklist with the
 * chosen format. The maintenance-checklist generator accepts:
 *   - 'summary'  → printable asset register (formerly 'simple')
 *   - 'standard' → standard run-sheet with task headings (default)
 *   - 'detailed' → full task-by-task breakdown per asset
 */
/**
 * Relabelled 26-Apr-2026 (audit item 9): "Print Report" → "Field Run-Sheet".
 * The output is a printable checklist for the tech to fill in onsite, not
 * the customer-facing PDF. The customer-facing PDF is the separate
 * "Customer Report" button (Download Report) elsewhere on this page.
 */
export function PrintReportSplit({ checkId }: { checkId: string }) {
  function open(format: 'summary' | 'standard' | 'detailed') {
    window.open(`/api/maintenance-checklist?check_id=${checkId}&format=${format}`, '_blank', 'noopener')
  }
  return (
    <SplitButton
      variant="gray"
      icon={<Printer className="w-4 h-4" />}
      label="Field Run-Sheet"
      title="Print a clipboard run-sheet for the tech onsite. For the customer-facing PDF, use Customer Report."
      onClick={() => open('standard')}
      options={[
        {
          label: 'Summary',
          description: 'Master register only — single page, supervisor hand-out',
          onSelect: () => open('summary'),
        },
        {
          label: 'Standard',
          description: 'Default. Master register page + per-asset detail cards. Supervisor keeps page 1, tech gets the rest.',
          onSelect: () => open('standard'),
          recommended: true,
        },
        {
          label: 'Detailed',
          description: 'Per-asset detail cards only (no master). For when supervisor already has the master.',
          onSelect: () => open('detailed'),
        },
      ]}
    />
  )
}
