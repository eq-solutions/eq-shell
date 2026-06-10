'use client'

import { Printer } from 'lucide-react'

/**
 * Single-action button that opens the Field Run-Sheet in standard format
 * — explicitly labelled "Print Blank for Onsite" so techs know this is the
 * empty-form-for-handwriting use case. Calls the same `/api/maintenance-
 * checklist` endpoint as the SplitButton's standard option, just with a
 * clearer entry point. Royce 2026-04-28: "sometimes we print empty and
 * the guys complete on site".
 *
 * Survives a check.kind discriminator: the route synthesizes
 * ChecklistAsset entries from linked acb/nsx/rcd_tests when no
 * check_assets exist, so this works for test-bench checks too.
 */
export function PrintBlankButton({ checkId }: { checkId: string }) {
  return (
    <button
      onClick={() =>
        window.open(
          `/api/maintenance-checklist?check_id=${checkId}&format=standard`,
          '_blank',
          'noopener',
        )
      }
      title="Print an empty run-sheet for the technician to complete onsite by hand. Same as Field Run-Sheet > Standard."
      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-gray-300 bg-white text-eq-ink rounded hover:border-eq-deep hover:text-eq-deep transition-colors"
    >
      <Printer className="w-4 h-4" /> Print Blank for Onsite
    </button>
  )
}
