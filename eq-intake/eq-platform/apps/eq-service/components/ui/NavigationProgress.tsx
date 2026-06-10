'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * Top-of-page progress bar that animates during route transitions.
 *
 * Click feedback for server-component navigation: when the user clicks
 * an internal link, a thin sky-blue bar slides in at the top of the
 * viewport and fills as the new page loads. Disappears when the
 * pathname / searchParams change settles.
 *
 * Implementation: listens to mousedown on internal anchors so feedback
 * is instant (before Next.js starts the fetch). Completion is detected
 * via a usePathname + useSearchParams effect — when the rendered route
 * key changes, the bar snaps to 100% and fades.
 *
 * No external dep (no nprogress). Mounted once in app/(app)/layout.tsx.
 */
export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressInner />
    </Suspense>
  )
}

function NavigationProgressInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastKey = useRef<string>(`${pathname}?${searchParams?.toString() ?? ''}`)

  // Start the bar on internal-link click. mousedown fires before Next.js
  // begins the route fetch, so users see immediate feedback.
  useEffect(() => {
    function isInternalLinkClick(e: MouseEvent): boolean {
      // Only left-click without modifiers. Cmd/Ctrl/Shift/Alt-click opens
      // a new tab/window — let the browser handle it without our bar.
      if (e.button !== 0) return false
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
      const target = e.target as Element | null
      const anchor = target?.closest?.('a')
      if (!anchor) return false
      const href = anchor.getAttribute('href')
      if (!href) return false
      // Hashes, mailto, tel, external — skip.
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false
      if (/^https?:\/\//i.test(href)) {
        // External URL — only count as internal when it points back to our origin.
        try {
          const u = new URL(href)
          if (u.origin !== window.location.origin) return false
        } catch {
          return false
        }
      }
      // Skip _blank / download links.
      if (anchor.getAttribute('target') === '_blank') return false
      if (anchor.hasAttribute('download')) return false
      return true
    }

    function start() {
      if (animationTimer.current) clearTimeout(animationTimer.current)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      setVisible(true)
      // Two-step ramp so the bar doesn't pre-finish before slow fetches.
      setProgress(15)
      animationTimer.current = setTimeout(() => setProgress(70), 250)
    }

    function onMouseDown(e: MouseEvent) {
      if (isInternalLinkClick(e)) start()
    }

    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  // Complete the bar when the route key changes — that's when the new
  // server component finished rendering and is on screen.
  useEffect(() => {
    const key = `${pathname}?${searchParams?.toString() ?? ''}`
    if (key === lastKey.current) return
    lastKey.current = key

    if (animationTimer.current) clearTimeout(animationTimer.current)
    setVisible(true)
    setProgress(100)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      setVisible(false)
      setProgress(0)
    }, 220)
  }, [pathname, searchParams])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 right-0 z-[100] h-0.5"
    >
      <div
        className="h-full bg-eq-sky shadow-[0_0_8px_rgba(61,168,216,0.6)] transition-[width,opacity] duration-200 ease-out"
        style={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
        }}
      />
    </div>
  )
}
