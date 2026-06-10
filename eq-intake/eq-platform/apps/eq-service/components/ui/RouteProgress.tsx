'use client'

import { useEffect, useState, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * Global top-of-page route progress indicator.
 *
 * A thin blue bar fixed to the very top of the viewport that animates across
 * whenever the user triggers a navigation. Solves the "did it freeze or is it
 * just slow?" confusion on server-rendered pages that take a second or two to
 * return (admin/users, /reports, /testing/summary).
 *
 * How it works:
 *   1. Intercepts click events on same-origin <a> elements (which is how Next
 *      <Link> renders) — flips to loading state immediately. This fires at
 *      click time rather than waiting for the pathname to change, so the bar
 *      appears the instant the user clicks.
 *   2. When the new pathname/search actually renders (React commits the new
 *      tree), the bar animates to 100% and fades out.
 *   3. Failsafe: if the navigation is cancelled / errors, auto-clears after
 *      10s so the bar doesn't stick on screen.
 *
 * No dependencies — pure CSS animation. Mounted once in app/layout.tsx inside
 * <Providers /> so it's alive for every route including the auth pages.
 */
export function RouteProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 1. Click interceptor — flip to loading as soon as a same-origin link is clicked.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Only plain left-clicks without modifier keys trigger a SPA navigation.
      if (e.defaultPrevented) return
      if (e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const target = (e.target as HTMLElement | null)?.closest('a')
      if (!target) return
      const href = target.getAttribute('href')
      if (!href) return
      // External links (new tab, mailto:, tel:, absolute other origin) — skip.
      if (target.target && target.target !== '_self') return
      if (href.startsWith('mailto:') || href.startsWith('tel:')) return
      try {
        const url = new URL(href, window.location.href)
        if (url.origin !== window.location.origin) return
        // Same-page anchor — skip.
        if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return
      } catch {
        return
      }
      setState('loading')
      // Failsafe — clear after 10s even if pathname never changes.
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setState('idle'), 10_000)
    }

    // Router.push() / Link submit don't emit click events — also listen for
    // form submits that end up as navigations (sign-in, invite accept, etc).
    function onSubmit(e: SubmitEvent) {
      const form = e.target as HTMLFormElement | null
      if (!form) return
      // Server actions are submitted to the current URL — skip those to avoid
      // a stuck bar when the action redirects. The pathname-change effect
      // below will pick up the redirect-driven navigation.
      if (!form.action || form.action === window.location.href) return
      setState('loading')
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setState('idle'), 10_000)
    }

    document.addEventListener('click', onClick, { capture: true })
    document.addEventListener('submit', onSubmit, { capture: true })
    return () => {
      document.removeEventListener('click', onClick, { capture: true })
      document.removeEventListener('submit', onSubmit, { capture: true })
    }
  }, [])

  // 2. When pathname OR searchParams commit a new value, the server component
  //    has rendered — slide to done, then back to idle.
  useEffect(() => {
    if (state === 'loading') {
      setState('done')
      const t = setTimeout(() => setState('idle'), 250)
      return () => clearTimeout(t)
    }
    // If a navigation happened that we didn't catch via click (e.g. programmatic),
    // still briefly animate so the user sees that the URL changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()])

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  // Render — classes drive a keyframe animation defined below (inline <style>
  // so this component stays dep-free and doesn't require a globals.css edit).
  return (
    <>
      <div
        aria-hidden
        className={`route-progress-bar route-progress-${state}`}
        data-state={state}
      />
      <style>{`
        .route-progress-bar {
          position: fixed;
          top: 0;
          left: 0;
          height: 2px;
          width: 0%;
          z-index: 9999;
          background: linear-gradient(90deg, #0ea5e9 0%, #3b82f6 50%, #6366f1 100%);
          box-shadow: 0 0 8px rgba(59, 130, 246, 0.6);
          transition: width 0.2s ease-out, opacity 0.2s ease-out;
          opacity: 0;
          pointer-events: none;
        }
        .route-progress-loading {
          width: 70%;
          opacity: 1;
          animation: route-progress-crawl 8s ease-out forwards;
        }
        .route-progress-done {
          width: 100%;
          opacity: 1;
          transition: width 0.2s ease-out, opacity 0.3s ease-out 0.1s;
        }
        .route-progress-idle {
          width: 0%;
          opacity: 0;
        }
        @keyframes route-progress-crawl {
          0%   { width: 0%; }
          25%  { width: 45%; }
          50%  { width: 65%; }
          75%  { width: 78%; }
          100% { width: 85%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .route-progress-bar { transition: none; animation: none; }
        }
      `}</style>
    </>
  )
}
