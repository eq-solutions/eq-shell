/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */
import Link from 'next/link'

/**
 * Global copyright footer — medium-form ownership disclosure.
 *
 * Rendered on every page in every route group (app, auth, portal).
 * This line satisfies the ASIC Business Names Registration Act s.18
 * requirement to disclose the legal entity on every outward-facing surface.
 *
 * Tenant skins MUST NOT replace this footer — skinning applies to headers,
 * colours and logos only. Ownership attribution is non-negotiable.
 */
export function EqFooter() {
  return (
    <footer className="w-full border-t border-gray-200 bg-white/60 px-4 py-3 text-center text-[11px] leading-relaxed text-gray-500">
      <span>
        © {new Date().getFullYear()} EQ · CDC Solutions Pty Ltd · ABN 40 651 962 935 · All rights reserved.
      </span>
      <span className="mx-2 text-gray-300" aria-hidden="true">
        ·
      </span>
      <Link href="/terms" className="underline-offset-2 hover:text-eq-deep hover:underline">
        Terms of Use
      </Link>
    </footer>
  )
}
