'use client'

/**
 * Toast — programmatic transient notification, replaces window.alert(...).
 *
 *   const toast = useToast()
 *   toast.error('Failed to update task result.')
 *   toast.success('Invite sent.')
 *   toast.info('Check archived.')
 *
 * Brand-styled, auto-dismiss after ~5s, stacks at the bottom-right, dismissible
 * by clicking the X. No animation library — short CSS transition only, to
 * stay inside the "no gradients, no shadow-heavy" brand brief.
 *
 * Mount <ToastProvider /> once in the tree (we mount it in <AppProviders />
 * inside app/(app)/layout.tsx).
 */

import { cn } from '@/lib/utils/cn'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastItem {
  id: string
  kind: ToastKind
  message: string
  durationMs: number
}

export interface ToastApi {
  success: (message: string, opts?: { durationMs?: number }) => void
  error: (message: string, opts?: { durationMs?: number }) => void
  info: (message: string, opts?: { durationMs?: number }) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast() called outside of <ToastProvider>. Mount the provider in app/(app)/layout.tsx (or its AppProviders child).')
  }
  return ctx
}

const DEFAULT_DURATION_MS = 5000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [mounted, setMounted] = useState(false)
  const counterRef = useRef(0)

  useEffect(() => {
    setMounted(true)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((kind: ToastKind, message: string, durationMs?: number) => {
    counterRef.current += 1
    // ID combines timestamp + a counter so two toasts queued in the same
    // tick never collide on React's reconciliation key.
    const id = `${Date.now()}-${counterRef.current}`
    const duration = durationMs ?? DEFAULT_DURATION_MS
    setToasts((prev) => [...prev, { id, kind, message, durationMs: duration }])
  }, [])

  const api = useRef<ToastApi>({
    success: (message, opts) => push('success', message, opts?.durationMs),
    error: (message, opts) => push('error', message, opts?.durationMs),
    info: (message, opts) => push('info', message, opts?.durationMs),
    dismiss,
  })

  // Re-bind on push/dismiss change so closures see the latest setToasts.
  api.current = {
    success: (message, opts) => push('success', message, opts?.durationMs),
    error: (message, opts) => push('error', message, opts?.durationMs),
    info: (message, opts) => push('info', message, opts?.durationMs),
    dismiss,
  }

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      {mounted &&
        createPortal(
          <ToastViewport toasts={toasts} onDismiss={dismiss} />,
          document.body
        )}
    </ToastContext.Provider>
  )
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)]"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem
  onDismiss: (id: string) => void
}) {
  const [leaving, setLeaving] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const enterId = requestAnimationFrame(() => setEntered(true))
    const dismissTimer = setTimeout(() => {
      setLeaving(true)
      setTimeout(() => onDismiss(toast.id), 200)
    }, toast.durationMs)
    return () => {
      cancelAnimationFrame(enterId)
      clearTimeout(dismissTimer)
    }
  }, [toast.id, toast.durationMs, onDismiss])

  const kindStyles: Record<ToastKind, { border: string; accent: string; icon: typeof Info }> = {
    success: {
      border: 'border-green-200',
      accent: 'text-green-600',
      icon: CheckCircle2,
    },
    error: {
      border: 'border-red-200',
      accent: 'text-red-600',
      icon: AlertCircle,
    },
    info: {
      border: 'border-eq-sky/30',
      accent: 'text-eq-sky',
      icon: Info,
    },
  }

  const { border, accent, icon: Icon } = kindStyles[toast.kind]

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 bg-white border rounded-lg px-4 py-3 transition-all duration-200',
        border,
        entered && !leaving ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      )}
    >
      <Icon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', accent)} />
      <p className="flex-1 text-sm text-eq-ink leading-snug whitespace-pre-line break-words">
        {toast.message}
      </p>
      <button
        type="button"
        onClick={() => {
          setLeaving(true)
          setTimeout(() => onDismiss(toast.id), 200)
        }}
        className="flex-shrink-0 p-0.5 rounded text-eq-grey hover:text-eq-ink hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-eq-sky"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
