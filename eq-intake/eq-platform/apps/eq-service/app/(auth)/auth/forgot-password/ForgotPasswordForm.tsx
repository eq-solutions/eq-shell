'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { forgotPasswordAction, verifyRecoveryOtpAction } from './actions'

interface Props {
  /** Skip step 1 and land on the code-entry form, pre-filled with this email. */
  initialEmail?: string
  /** Force the form to start on the verify step (used by /auth/reset-password). */
  initialStep?: 'email' | 'verify'
}

/**
 * Two-step OTP password reset.
 * Step 1: email entry -> forgotPasswordAction fires recovery email with 8-digit code.
 * Step 2: code + new password -> verifyRecoveryOtpAction exchanges code for session
 *         and sets the new password atomically. No clickable email link in either
 *         direction - Defender Safe Links would burn one-shot tokens.
 */
export function ForgotPasswordForm({ initialEmail, initialStep }: Props = {}) {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'verify'>(
    initialStep ?? (initialEmail ? 'verify' : 'email'),
  )
  const [email, setEmail] = useState(initialEmail ?? '')
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()

  function onSubmitEmail(formData: FormData) {
    setError(undefined)
    startTransition(async () => {
      const res = await forgotPasswordAction(formData)
      if (res?.error) {
        setError(res.error)
        return
      }
      if (res?.ok) {
        setEmail(res.email)
        setStep('verify')
      }
    })
  }

  function onSubmitVerify(formData: FormData) {
    setError(undefined)
    formData.set('email', email)
    startTransition(async () => {
      const res = await verifyRecoveryOtpAction(formData)
      if (res?.error) {
        setError(res.error)
        return
      }
      if (res?.ok) {
        router.push('/auth/signin?reset=ok')
      }
    })
  }

  if (step === 'verify') {
    return (
      <form action={onSubmitVerify} className="flex flex-col gap-4">
        <div className="text-sm text-eq-ink bg-eq-ice border border-eq-sky/30 rounded-md p-4 leading-relaxed">
          We sent an 8-digit code to <strong>{email}</strong>.
          Check your inbox (and Junk folder) and enter the code below along
          with your new password.
        </div>

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
          label="New password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          placeholder="At least 10 characters"
          disabled={pending}
        />

        <FormInput
          label="Confirm new password"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          disabled={pending}
        />

        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
            {error}
          </div>
        )}

        <Button type="submit" disabled={pending}>
          {pending ? 'Verifying...' : 'Set new password'}
        </Button>

        <button
          type="button"
          onClick={() => {
            setStep('email')
            setError(undefined)
          }}
          className="text-xs text-eq-deep hover:text-eq-sky transition-colors text-center"
          disabled={pending}
        >
          Send a new code
        </button>
      </form>
    )
  }

  return (
    <form action={onSubmitEmail} className="flex flex-col gap-4">
      <FormInput
        label="Email"
        name="email"
        type="email"
        required
        autoComplete="email"
        disabled={pending}
      />
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Sending...' : 'Send reset code'}
      </Button>
      <p className="text-[11px] text-eq-grey leading-relaxed">
        We will email you an 8-digit code. Codes expire after 1 hour. We use
        a code instead of a link so corporate email scanners cannot
        accidentally use it before you do.
      </p>
      <p className="text-center">
        <Link
          href="/auth/signin"
          className="text-sm text-eq-deep hover:text-eq-sky transition-colors"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  )
}
