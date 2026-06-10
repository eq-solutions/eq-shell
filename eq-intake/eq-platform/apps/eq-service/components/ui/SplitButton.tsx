'use client'

import { useState, useRef, useEffect, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface SplitOption {
  /** Display text in the dropdown menu. */
  label: string
  /** Optional secondary line of small grey text under the label. */
  description?: string
  /** Called when this option is selected. */
  onSelect: () => void
  /** Mark one option as the recommended/default — bold + checkmark indicator. */
  recommended?: boolean
}

interface SplitButtonProps {
  /** Primary button label (the click-target). */
  label: ReactNode
  /** Click handler for the primary button — usually triggers the default action. */
  onClick: () => void
  /** Options shown when the caret is opened. */
  options: SplitOption[]
  /** Visual variant — matches Button.tsx variants. */
  variant?: 'primary' | 'secondary' | 'gray'
  /** Disable the entire control. */
  disabled?: boolean
  /** Optional icon rendered before the primary label. */
  icon?: ReactNode
  /** Tooltip text for the primary button. */
  title?: string
}

/**
 * Split button: primary action on the left, dropdown caret on the right.
 *
 *   [ Generate Report  v ]
 *                      └─ menu opens here on caret click
 *
 * The primary button fires the default action immediately. The caret reveals
 * a menu of overrides. Pattern borrowed from GitHub's "Create pull request"
 * dropdown — familiar, accessible, doesn't need a modal for one-off picks.
 *
 * Closes on outside click + Escape.
 */
export function SplitButton({
  label,
  onClick,
  options,
  variant = 'primary',
  disabled = false,
  icon,
  title,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const baseStyles = cn(
    'inline-flex items-center text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    {
      'bg-eq-sky text-white hover:bg-eq-deep': variant === 'primary',
      'bg-white text-eq-deep border border-eq-deep hover:bg-eq-ice': variant === 'secondary',
      'bg-gray-600 text-white hover:bg-gray-700': variant === 'gray',
    },
  )

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={cn(baseStyles, 'gap-2 px-3 py-1.5 rounded-l border-r border-r-white/20')}
      >
        {icon}
        {label}
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More options"
        className={cn(baseStyles, 'px-2 py-1.5 rounded-r')}
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 min-w-[16rem] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
        >
          {options.map((opt, idx) => (
            <button
              key={idx}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                opt.onSelect()
              }}
              className="w-full text-left px-4 py-2.5 hover:bg-eq-ice transition-colors border-b border-gray-100 last:border-b-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn('text-sm', opt.recommended ? 'font-semibold text-eq-ink' : 'font-medium text-eq-ink')}>
                  {opt.label}
                </span>
                {opt.recommended && (
                  <span className="text-[10px] uppercase tracking-wide text-eq-deep bg-eq-ice px-1.5 py-0.5 rounded-full font-semibold">
                    Default
                  </span>
                )}
              </div>
              {opt.description && (
                <div className="text-xs text-eq-grey mt-0.5">{opt.description}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
