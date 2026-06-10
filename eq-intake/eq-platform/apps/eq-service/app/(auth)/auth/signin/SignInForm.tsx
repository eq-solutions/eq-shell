/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * Proprietary and confidential.
 *
 * Sign-in entry with Live vs Demo chooser.
 *
 * View states:
 *   'chooser' — two tiles: "Sign in" and "Try the demo"
 *   'form'    — email + password for real accounts
 *   'demo'    — reveals demo credentials + one-click "Sign in as demo"
 *
 * Back arrow returns to the chooser from either sub-view.
 */
'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, LogIn, Sparkles, Copy, Check, FileText } from 'lucide-react'
import { signInAction, startDemoSessionAction } from './actions'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/lib/utils/demo'

type View = 'chooser' | 'form' | 'demo'

export function SignInForm({
  next,
  initialError,
}: {
  next: string
  initialError?: string
}) {
  const [view, setView] = useState<View>('chooser')
  const [error, setError] = useState<string | undefined>(initialError)
  const [pending, startTransition] = useTransition()
  const [demoPending, startDemoTransition] = useTransition()
  const [copiedField, setCopiedField] = useState<'email' | 'password' | null>(null)

  const anyPending = pending || demoPending

  function onSubmit(formData: FormData) {
    setError(undefined)
    startTransition(async () => {
      const res = await signInAction(formData)
      if (res?.error) setError(res.error)
    })
  }

  function onDemo() {
    setError(undefined)
    startDemoTransition(async () => {
      const res = await startDemoSessionAction()
      if (res?.error) setError(res.error)
    })
  }

  async function copyField(field: 'email' | 'password') {
    const text = field === 'email' ? DEMO_EMAIL : DEMO_PASSWORD
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 1500)
    } catch {
      // clipboard blocked — silently fall through
    }
  }

  // ── Chooser view ─────────────────────────────────────────────
  if (view === 'chooser') {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-eq-ink tracking-tight">Welcome to EQ Solves Service</h1>
          <p className="text-sm text-eq-grey mt-1">Choose how you&apos;d like to start.</p>
        </div>

        {initialError && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
            {initialError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3">
          {/* Live sign-in tile */}
          <button
            type="button"
            onClick={() => { setError(undefined); setView('form') }}
            className="group text-left rounded-xl border border-gray-200 hover:border-eq-sky/60 hover:bg-eq-ice/20 bg-white p-4 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-eq-ice flex items-center justify-center flex-shrink-0">
                <LogIn className="w-5 h-5 text-eq-deep" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-eq-ink">Sign in to your account</div>
                <div className="text-xs text-eq-grey mt-0.5">For existing EQ Solves users</div>
              </div>
              <ArrowRight className="w-4 h-4 text-eq-grey group-hover:text-eq-deep group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
            </div>
          </button>

          {/* Demo tile */}
          <button
            type="button"
            onClick={() => { setError(undefined); setView('demo') }}
            className="group text-left rounded-xl border border-eq-sky/30 hover:border-eq-sky bg-eq-ice/40 hover:bg-eq-ice p-4 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white border border-eq-sky/30 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-eq-deep" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-eq-ink flex items-center gap-2">
                  Try the demo
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-eq-sky text-white">
                    No signup
                  </span>
                </div>
                <div className="text-xs text-eq-grey mt-0.5">
                  Explore with sample data — 3 customers, 8 sites, 16 ACBs
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-eq-deep group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
            </div>
          </button>
        </div>

        {/* Sample reports row */}
        <div className="pt-4 border-t border-gray-100">
          <p className="text-[11px] uppercase tracking-[0.15em] text-eq-grey font-semibold mb-2">See a sample</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            <a
              href="/samples/compliance-report-sample.pdf"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 text-eq-deep hover:text-eq-sky underline underline-offset-2"
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              Compliance report (PDF)
            </a>
            <a
              href="/samples/acb-test-report-sample.pdf"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 text-eq-deep hover:text-eq-sky underline underline-offset-2"
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              ACB test report (PDF)
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ── Live sign-in form ────────────────────────────────────────
  if (view === 'form') {
    return (
      <div className="flex flex-col gap-5">
        <button
          type="button"
          onClick={() => { setError(undefined); setView('chooser') }}
          className="inline-flex items-center gap-1.5 text-xs text-eq-grey hover:text-eq-ink transition-colors w-fit -mb-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Back
        </button>

        <div>
          <h1 className="text-2xl font-bold text-eq-ink tracking-tight">Sign in</h1>
          <p className="text-sm text-eq-grey mt-1">Use your EQ Solves credentials.</p>
        </div>

        <form action={onSubmit} className="flex flex-col gap-5">
          <input type="hidden" name="next" value={next} />

          <div>
            <label htmlFor="email" className="block text-xs font-medium text-eq-ink mb-1.5">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              disabled={anyPending}
              placeholder="you@company.com"
              className="w-full px-3.5 py-2.5 text-sm text-eq-ink bg-gray-50 border border-gray-200 rounded-lg placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-eq-sky/40 focus:border-eq-sky focus:bg-white transition-all disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-eq-ink mb-1.5">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              disabled={anyPending}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 text-sm text-eq-ink bg-gray-50 border border-gray-200 rounded-lg placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-eq-sky/40 focus:border-eq-sky focus:bg-white transition-all disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={anyPending}
            className="w-full min-h-[44px] py-2.5 px-4 text-sm font-semibold text-white bg-eq-sky rounded-lg hover:bg-eq-deep focus:outline-none focus:ring-2 focus:ring-eq-sky focus:ring-offset-2 transition-all touch-manipulation active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Signing in…
              </span>
            ) : (
              'Sign in'
            )}
          </button>

          <div className="flex items-center justify-between text-sm -mt-1">
            <Link
              href="/auth/forgot-password"
              className="text-eq-deep hover:text-eq-sky transition-colors text-xs"
            >
              Forgot password?
            </Link>
          </div>
        </form>
      </div>
    )
  }

  // ── Demo credentials view ────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={() => { setError(undefined); setView('chooser') }}
        className="inline-flex items-center gap-1.5 text-xs text-eq-grey hover:text-eq-ink transition-colors w-fit -mb-1"
      >
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
        Back
      </button>

      <div>
        <h1 className="text-2xl font-bold text-eq-ink tracking-tight flex items-center gap-2">
          Demo access
          <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-eq-sky text-white">
            No signup
          </span>
        </h1>
        <p className="text-sm text-eq-grey mt-1">
          Use these credentials to sign in — or click the button below for a one-click entry.
        </p>
      </div>

      {/* Credentials reveal */}
      <div className="rounded-xl border border-eq-sky/30 bg-eq-ice/40 p-4 flex flex-col gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-eq-deep uppercase tracking-[0.15em] mb-1.5">
            Email
          </label>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 min-w-0 px-3 py-2 text-sm font-mono text-eq-ink bg-white border border-gray-200 rounded-lg truncate">
              {DEMO_EMAIL}
            </code>
            <button
              type="button"
              onClick={() => copyField('email')}
              aria-label="Copy demo email"
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-eq-deep bg-white border border-gray-200 rounded-lg hover:bg-eq-ice hover:border-eq-sky/40 transition-colors flex-shrink-0"
            >
              {copiedField === 'email' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedField === 'email' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-eq-deep uppercase tracking-[0.15em] mb-1.5">
            Password
          </label>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 min-w-0 px-3 py-2 text-sm font-mono text-eq-ink bg-white border border-gray-200 rounded-lg truncate">
              {DEMO_PASSWORD}
            </code>
            <button
              type="button"
              onClick={() => copyField('password')}
              aria-label="Copy demo password"
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-eq-deep bg-white border border-gray-200 rounded-lg hover:bg-eq-ice hover:border-eq-sky/40 transition-colors flex-shrink-0"
            >
              {copiedField === 'password' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedField === 'password' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onDemo}
        disabled={anyPending}
        className="w-full min-h-[44px] py-2.5 px-4 text-sm font-semibold text-white bg-eq-sky rounded-lg hover:bg-eq-deep focus:outline-none focus:ring-2 focus:ring-eq-sky focus:ring-offset-2 transition-all touch-manipulation active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {demoPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading demo…
          </span>
        ) : (
          'Sign in as demo →'
        )}
      </button>

      <p className="text-[11px] text-eq-grey leading-relaxed">
        You&apos;re entering a sandbox. Sample data only — changes may be reset. See the sample reports on the previous screen to preview report output.
      </p>
    </div>
  )
}
