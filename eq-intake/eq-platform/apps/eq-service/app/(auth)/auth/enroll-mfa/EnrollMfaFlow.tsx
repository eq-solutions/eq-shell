'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { enrollStartAction, enrollVerifyAction } from './actions'

export function EnrollMfaFlow() {
  const router = useRouter()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    enrollStartAction()
      .then((res) => {
        if ('error' in res) setError(res.error)
        else {
          setFactorId(res.factorId)
          setQrCode(res.qrCode)
          setSecret(res.secret)
        }
      })
      .catch((e) => setError(e?.message ?? 'Failed to start MFA enrolment.'))
  }, [])

  function onVerify(formData: FormData) {
    setError(undefined)
    startTransition(async () => {
      const res = await enrollVerifyAction(formData)
      if ('error' in res) setError(res.error)
      else setCodes(res.codes)
    })
  }

  if (codes) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-sm text-eq-ink bg-eq-ice border border-eq-sky/30 rounded-md p-4">
          <strong>Save these recovery codes now.</strong> Each can be used once if you lose your authenticator. They will not be shown again.
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-white border border-gray-200 rounded-md p-4">
          {codes.map((c) => (
            <div key={c} className="text-eq-ink">{c}</div>
          ))}
        </div>
        <Button
          onClick={() => {
            const blob = new Blob([codes.join('\n')], { type: 'text/plain' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'eq-solves-recovery-codes.txt'
            a.click()
            URL.revokeObjectURL(url)
          }}
          variant="secondary"
        >
          Download codes
        </Button>
        <Button onClick={() => router.push('/dashboard')}>
          I&apos;ve saved them, continue
        </Button>
      </div>
    )
  }

  if (!factorId || !qrCode) {
    return <div className="text-sm text-eq-grey">Loading…</div>
  }

  return (
    <form action={onVerify} className="flex flex-col gap-4">
      <input type="hidden" name="factorId" value={factorId} />
      <div className="flex items-center justify-center bg-white border border-gray-200 rounded-md p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrCode} alt="Scan with your authenticator app" className="w-64 h-64" />
      </div>
      {secret && (
        <div className="text-xs text-eq-grey text-center">
          Or enter this key manually: <span className="font-mono text-eq-ink">{secret}</span>
        </div>
      )}
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
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Verifying…' : 'Verify and continue'}
      </Button>
    </form>
  )
}
