/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * CollapsibleSection — generic progressive-disclosure wrapper used on
 * dense pages (initially the check detail page). Header is clickable;
 * actions only render when expanded. Summary text shows in the header
 * regardless of state so the user always sees the rollup.
 *
 * Pattern intentionally matches the existing white-card / gray-border
 * convention used across Asset table, AttachmentList, and similar
 * panels. No new visual language — just a chevron + toggle.
 */
'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface CollapsibleSectionProps {
  /** Heading text shown in the bar (left side). */
  title: string
  /** Optional rollup text shown next to the title, always visible. */
  summary?: string
  /** Whether the section is open on first render. */
  defaultOpen?: boolean
  /** Inline header actions (filters, buttons). Only rendered when expanded. */
  actions?: ReactNode
  /** Optional tone — affects the header background. */
  tone?: 'default' | 'subtle'
  children: ReactNode
}

export function CollapsibleSection({
  title,
  summary,
  defaultOpen = true,
  actions,
  tone = 'default',
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 flex-wrap',
          tone === 'subtle' && 'bg-eq-ice',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 text-sm font-bold text-eq-ink hover:text-eq-deep transition-colors shrink-0"
        >
          {open ? (
            <ChevronDown className="w-4 h-4 text-eq-grey" aria-hidden />
          ) : (
            <ChevronRight className="w-4 h-4 text-eq-grey" aria-hidden />
          )}
          <span>{title}</span>
          {summary && (
            <span className="text-eq-grey font-normal text-xs ml-1">· {summary}</span>
          )}
        </button>
        {open && actions && (
          <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">{actions}</div>
        )}
      </div>
      {open && <div>{children}</div>}
    </div>
  )
}
