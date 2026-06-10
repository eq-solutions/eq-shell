'use client'
import { cn } from '@/lib/utils/cn'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

interface SlidePanelProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
  wide?: boolean
  /**
   * Optional sticky footer slot — rendered below the scrollable content
   * with a top border. Use to keep submit / cancel buttons visible on
   * long forms (UX audit §A.12 / §3.6 — iPad portrait was the worst
   * offender: admin scrolls past Submit to fill optional fields, then
   * scrolls back to submit).
   *
   * Forms that opt in typically place a `<Button type="submit" form="…" />`
   * here, with the form element carrying a matching `id`. HTML's `form="…"`
   * attribute lets a submit button live outside the `<form>` and still
   * trigger it.
   */
  footer?: React.ReactNode
}

export function SlidePanel({ open, onClose, title, children, className, wide, footer }: SlidePanelProps) {
  // Defer unmount so the slide-out animation can complete. Without this,
  // closing the panel would rip the children out instantly and the
  // transition would look like a snap. 200ms matches duration-200 below.
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const t = window.setTimeout(() => setMounted(false), 200)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 transition-opacity duration-200',
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      )}
    >
      <div
        className="absolute inset-0 bg-eq-ink/40"
        onClick={onClose}
      />
      <aside
        className={cn(
          'absolute right-0 top-0 h-full w-full bg-white shadow-xl transition-transform duration-200 flex flex-col',
          wide ? 'max-w-4xl' : 'max-w-md',
          open ? 'translate-x-0' : 'translate-x-full',
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-eq-ink">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-gray-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-eq-grey" />
            </button>
          </div>
        )}
        {/* Unmount children while closed so uncontrolled form inputs
            (defaultValue) reinitialise the next time the panel opens
            with a different record. Keeps the fade-out smooth by
            deferring the unmount by one transition cycle. */}
        <div className="flex-1 overflow-y-auto p-5">{mounted ? children : null}</div>
        {footer && mounted && (
          <div className="border-t border-gray-200 px-5 py-3 bg-white">
            {footer}
          </div>
        )}
      </aside>
    </div>
  )
}
