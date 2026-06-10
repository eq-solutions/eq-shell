'use client'

/**
 * Client-side providers stitched together for the (app) route group.
 *
 * Currently:
 *  - <ConfirmProvider /> — programmatic confirm() replacement
 *  - <ToastProvider />   — programmatic alert() replacement
 *
 * Mount in app/(app)/layout.tsx wrapping {children}. Both providers are pure
 * client wrappers so the surrounding server layout stays a server component
 * (and continues to read user/membership from Supabase).
 */

import { ConfirmProvider } from '@/components/ui/ConfirmDialog'
import { ToastProvider } from '@/components/ui/Toast'

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConfirmProvider>
      <ToastProvider>{children}</ToastProvider>
    </ConfirmProvider>
  )
}
