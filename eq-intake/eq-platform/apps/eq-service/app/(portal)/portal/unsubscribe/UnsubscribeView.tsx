'use client'

import { useState, useTransition } from 'react'
import { resubscribeAction } from './actions'

type Result =
  | { success: true; contactName: string | null; customerName: string | null; scope: 'monthly' | 'upcoming' | 'all'; appliedMonthly: boolean; appliedUpcoming: boolean }
  | { success: false; error: string }

interface Props {
  result: Result
  token: string
}

function scopeLabel(scope: 'monthly' | 'upcoming' | 'all'): string {
  if (scope === 'monthly') return 'monthly summary emails'
  if (scope === 'upcoming') return 'upcoming visit notifications'
  return 'all email notifications'
}

export function UnsubscribeView({ result, token }: Props) {
  const [resubscribed, setResubscribed] = useState(false)
  const [resubError, setResubError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!result.success) {
    return (
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <span className="text-red-500 text-2xl">!</span>
        </div>
        <h1 className="text-xl font-bold text-eq-ink mb-2">Link not valid</h1>
        <p className="text-sm text-eq-grey">{result.error}</p>
      </div>
    )
  }

  if (resubscribed) {
    return (
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
          <span className="text-green-500 text-2xl">✓</span>
        </div>
        <h1 className="text-xl font-bold text-eq-ink mb-2">You're back on the list</h1>
        <p className="text-sm text-eq-grey">
          We've re-enabled your {scopeLabel(result.scope)}. You can change preferences at any time
          {' '}from the customer portal settings.
        </p>
      </div>
    )
  }

  function handleResubscribe() {
    setResubError(null)
    startTransition(async () => {
      const r = await resubscribeAction(token)
      if (r.success) setResubscribed(true)
      else setResubError(r.error)
    })
  }

  return (
    <div className="text-center">
      <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
        <span className="text-green-500 text-2xl">✓</span>
      </div>
      <h1 className="text-xl font-bold text-eq-ink mb-2">You've been unsubscribed</h1>
      <p className="text-sm text-eq-grey mb-6">
        {result.contactName ? <>Hi {result.contactName.split(' ')[0]}, we've </> : <>We've </>}
        removed{' '}
        {result.customerName ? <strong className="text-eq-ink">{result.customerName}</strong> : <>this contact</>}
        {' '}from {scopeLabel(result.scope)}. You won't receive these emails any more.
      </p>

      <div className="border-t border-gray-200 pt-6 mt-6">
        <p className="text-xs text-eq-grey mb-3">Changed your mind?</p>
        <button
          type="button"
          onClick={handleResubscribe}
          disabled={pending}
          className="text-sm text-eq-sky hover:text-eq-deep underline disabled:opacity-50"
        >
          {pending ? 'Re-subscribing…' : 'Re-subscribe to these emails'}
        </button>
        {resubError && (
          <p className="text-xs text-red-600 mt-2">{resubError}</p>
        )}
      </div>
    </div>
  )
}
