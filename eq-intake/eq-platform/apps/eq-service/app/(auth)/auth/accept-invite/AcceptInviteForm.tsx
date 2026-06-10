'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { verifyInviteOtpAndSetupAction } from './actions'

interface Props {
  /** Email pre-filled from ?email= query param. Empty allowed - user types it. */
  initialEmail: string
}

/**
 * Single-shot invite OTP form. The user types: email (pre-filled if present),
 * 8-digit code, full name, password, confirm. On submit the server action
 * verifies the OTP, sets the password + name, and redirects to /dashboard.
 * No persistent session before submit - the OTP itself proves email ownership.
 */
export function AcceptInviteForm({ initialEmail }: Props) {
  const [error, setError] = useState<string>()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, startTransition] = useTransition()

  const strength = scorePassword(password)
  const mismatch = confirm.length > 0 && confirm !== password

  function onSubmit(formData: FormData) {
    setError(undefined)
    startTransition(async () => {
      const res = await verifyInviteOtpAndSetupAction(formData)
      if (res?.error) setError(res.error)
    })
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <FormInput
        label="Email"
        name="email"
        type="email"
        required
        autoComplete="email"
        defaultValue={initialEmail}
        readOnly={Boolean(initialEmail)}
        disabled={pending}
        className={initialEmail ? 'bg-eq-ice/40 text-eq-grey cursor-not-allowed' : undefined}
      />

      <FormInput
        label="8-digit code"
        name="code"
        type="text"
        required
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={8}
        placeholder="12345678"
        disabled={pending}
      />

      <FormInput
        label="Full name"
        name="full_name"
        required
        autoComplete="name"
        placeholder="Jane Smith"
        disabled={pending}
      />

      <div>
        <FormInput
          label="Create a password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          placeholder="At least 10 characters"
          disabled={pending}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <StrengthMeter score={strength} show={password.length > 0} />
      </div>

      <FormInput
        label="Confirm password"
        name="confirm"
        type="password"
        required
        autoComplete="new-password"
        disabled={pending}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={mismatch ? 'Passwords do not match' : undefined}
      />

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3 leading-relaxed">
          {error}
        </div>
      )}

      <Button
        type="submit"
        disabled={pending || mismatch || strength < 2}
        className="mt-1"
      >
        {pending ? 'Creating your account...' : 'Create my account'}
      </Button>
    </form>
  )
}

function scorePassword(pw: string): number {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 10) score++
  if (pw.length >= 14) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(score, 4)
}

function StrengthMeter({ score, show }: { score: number; show: boolean }) {
  if (!show) return null
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong']
  const colours = ['bg-red-300', 'bg-red-400', 'bg-yellow-400', 'bg-eq-sky', 'bg-eq-deep']
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex-1 grid grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-1 rounded ${i <= score ? colours[score] : 'bg-gray-200'}`}
          />
        ))}
      </div>
      <span className="text-[11px] text-eq-grey font-medium w-16 text-right">
        {labels[score]}
      </span>
    </div>
  )
}
