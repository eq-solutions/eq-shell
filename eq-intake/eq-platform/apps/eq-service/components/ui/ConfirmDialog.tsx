'use client'

/**
 * ConfirmDialog — programmatic confirmation modal.
 *
 * Drop-in replacement for `window.confirm(...)`. Mount <ConfirmProvider /> once
 * near the root of the tree (we mount it in <AppProviders /> inside
 * app/(app)/layout.tsx) and call useConfirm() from any client component:
 *
 *   const confirm = useConfirm()
 *   const ok = await confirm({ title, message, destructive: true })
 *   if (!ok) return
 *
 * Visual: centered modal, backdrop blur, brand-coloured title rule, large
 * readable Plus Jakarta Sans (inherited from the global font stack). Mirrors
 * components/ui/Modal.tsx so the aesthetic is consistent.
 *
 * Focus: traps focus inside the dialog while open, restores focus on close.
 * Escape always cancels. Backdrop-click cancels EXCEPT on destructive prompts
 * (where the user must explicitly click Cancel).
 */

import { cn } from '@/lib/utils/cn'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type Resolver = (value: boolean) => void

interface ConfirmState {
  options: ConfirmOptions
  resolve: Resolver
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm() called outside of <ConfirmProvider>. Mount the provider in app/(app)/layout.tsx (or its AppProviders child).')
  }
  return ctx
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ options, resolve })
    })
  }, [])

  const handleResolve = useCallback((value: boolean) => {
    if (!state) return
    state.resolve(value)
    setState(null)
  }, [state])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmDialogModal
          options={state.options}
          onConfirm={() => handleResolve(true)}
          onCancel={() => handleResolve(false)}
        />
      )}
    </ConfirmContext.Provider>
  )
}

function ConfirmDialogModal({
  options,
  onConfirm,
  onCancel,
}: {
  options: ConfirmOptions
  onConfirm: () => void
  onCancel: () => void
}) {
  const {
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
  } = options

  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<Element | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Focus management: capture the element that was focused before the dialog
  // opened, focus the safest control (Cancel on destructive, Confirm
  // otherwise), and restore focus on unmount.
  useEffect(() => {
    previouslyFocused.current = document.activeElement
    // Defer focus to the next paint so the buttons exist.
    const id = requestAnimationFrame(() => {
      if (destructive) {
        cancelBtnRef.current?.focus()
      } else {
        confirmBtnRef.current?.focus()
      }
    })
    return () => {
      cancelAnimationFrame(id)
      const prev = previouslyFocused.current as HTMLElement | null
      if (prev && typeof prev.focus === 'function') {
        prev.focus()
      }
    }
  }, [destructive])

  // Keyboard: Escape cancels (even destructive — Escape is universally an
  // affordance to abort). Tab cycles focus inside the dialog.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  // Lock body scroll while the dialog is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  if (!mounted) return null

  const dialog = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-eq-ink/40 backdrop-blur-sm p-4"
      onClick={() => {
        // Destructive prompts require an explicit Cancel click — accidental
        // backdrop taps should not silently dismiss a delete dialog.
        if (!destructive) onCancel()
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="bg-white rounded-lg max-w-md w-full overflow-hidden border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={cn(
            'h-1 w-full',
            destructive ? 'bg-red-500' : 'bg-eq-sky'
          )}
        />
        <div className="px-6 pt-5 pb-2">
          <h2
            id="confirm-dialog-title"
            className="text-lg font-bold text-eq-ink tracking-tight"
          >
            {title}
          </h2>
        </div>
        <div className="px-6 pb-5">
          <p
            id="confirm-dialog-message"
            className="text-sm text-eq-grey leading-relaxed whitespace-pre-line"
          >
            {message}
          </p>
        </div>
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            className="h-9 px-4 text-sm font-semibold rounded-md border border-gray-200 bg-white text-eq-ink hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-eq-sky focus:ring-offset-2"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className={cn(
              'h-9 px-4 text-sm font-semibold rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2',
              destructive
                ? 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500'
                : 'bg-eq-sky text-white hover:bg-eq-deep focus:ring-eq-sky'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(dialog, document.body)
}
