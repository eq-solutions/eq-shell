/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * Persistent top banner shown only when the current user is the
 * public demo fixture. Renders on every page inside (app) so demo
 * visitors always know they are in a sandbox.
 */
'use client'

import { useState } from 'react'
import { Info, Copy, Check } from 'lucide-react'

export function DemoBanner({ shareUrl }: { shareUrl: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard blocked — fall through silently
    }
  }

  return (
    <div className="w-full bg-eq-ice border-b border-eq-sky/30 text-eq-ink text-xs mt-14 lg:mt-0">
      <div className="flex items-center gap-3 px-4 py-2 lg:px-8">
        <Info className="w-4 h-4 text-eq-deep flex-shrink-0" aria-hidden="true" />
        <p className="flex-1 min-w-0 leading-snug">
          <span className="font-semibold text-eq-deep">Demo environment.</span>{' '}
          <span className="text-eq-grey">
            Sample data — changes may be reset. This is what EQ Solves Service looks like for a
            real contractor.
          </span>
        </p>
        <button
          type="button"
          onClick={copy}
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-eq-deep bg-white border border-eq-sky/40 rounded-md hover:bg-eq-sky hover:text-white hover:border-eq-sky transition-colors flex-shrink-0"
          aria-label="Copy shareable demo link"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Share demo link'}
        </button>
        <a
          href="/auth/signout"
          className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium text-eq-grey hover:text-eq-ink flex-shrink-0"
        >
          Exit demo
        </a>
      </div>
    </div>
  )
}
