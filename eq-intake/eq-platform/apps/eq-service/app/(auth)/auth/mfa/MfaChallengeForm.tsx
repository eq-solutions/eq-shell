'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { mfaChallengeVerifyAction, mfaRecoveryAction } from './actions'

export function MfaChallengeForm() {
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp')
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    setError(undefined)
    startTransition(async () => {
      const res = mode === 'totp'
        ? await mfaChallengeVerifyAction(formData)
        : await mfaRecoveryAction(formData)
      if (res?.error) setError(res.error)
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      {mode === 'totp' ? (
        <FormInput
          label="6-digit code"
          name="code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoComplete="one-time-code"
          disabled={pending}
        />
      ) : (
        <FormInput
          label="Recovery code"
          name="code"
          required
          disabled={pending}
          hint="Format: XXXXX-XXXXX"
        />
      )}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Verifying…' : 'Verify'}
      </Button>
      <button
        type="button"
        onClick={() => { setMode(mode === 'totp' ? 'recovery' : 'totp'); setError(undefined) }}
        className="text-sm text-eq-deep hover:text-eq-sky transition-colors text-center"
      >
        {mode === 'totp' ? 'Use a recovery code instead' : 'Use authenticator app instead'}
      </button>
      <a
        href="/auth/signout"
        className="text-sm text-eq-grey hover:text-red-600 transition-colors text-center"
      >
        Sign out
      </a>
    </form>
  )
}
