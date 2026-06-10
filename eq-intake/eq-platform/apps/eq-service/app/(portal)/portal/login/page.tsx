'use client'

import { useState } from 'react'

/**
 * Customer portal login — magic-link only.
 * Customer enters their email, receives a one-time link,
 * clicks it, and lands on the portal reports page.
 *
 * No password, no portal fatigue, no customer-role to manage.
 * The magic link resolves to a Supabase session scoped to the
 * customer's email, which the portal pages use to look up
 * report_deliveries.delivered_to.
 */
export default function PortalLoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/portal/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const result = await res.json()
      if (!res.ok || !result.success) {
        setError(result.error ?? 'Something went wrong. Please try again.')
      } else {
        setSent(true)
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
          <span className="text-green-500 text-2xl">✓</span>
        </div>
        <h1 className="text-xl font-bold text-eq-ink mb-2">Check your email</h1>
        <p className="text-sm text-eq-grey">
          We sent a login link to <strong className="text-eq-ink">{email}</strong>.
          Click the link to access your reports. The link expires in 1 hour.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto py-16">
      <div className="text-center mb-8">
        <h1 className="text-xl font-bold text-eq-ink">Customer Portal</h1>
        <p className="text-sm text-eq-grey mt-1">Enter your email to access your maintenance reports.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="text-xs font-bold text-eq-grey uppercase block mb-1">Email address</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full text-sm border border-gray-200 rounded-lg px-4 py-2.5 bg-white focus:border-eq-sky focus:ring-1 focus:ring-eq-sky/20 outline-none transition-all"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !email.trim()}
          className="w-full px-4 py-2.5 rounded-lg bg-eq-sky text-white text-sm font-medium hover:bg-eq-deep transition-colors disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Send login link'}
        </button>
      </form>

      <p className="text-xs text-eq-grey text-center mt-6">
        No password required. We will send a secure one-time link to your email.
      </p>
    </div>
  )
}
