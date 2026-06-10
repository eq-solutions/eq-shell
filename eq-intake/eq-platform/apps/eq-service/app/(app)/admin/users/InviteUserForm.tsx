'use client'

import { useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { inviteUserAction } from './actions'

// Role-description microcopy (UX audit PR #149 §A.7 / §2.6 of decisions).
// Surfaced below the role select so a new admin picking a role for the
// first invite knows what each one actually does. Wording matches what
// canWrite / canCreateCheck / canDoTestWork actually permit — not a
// marketing description.
const ROLE_DESCRIPTIONS: Record<string, string> = {
  super_admin: 'Full system access including signing in as anyone. Reserved for the EQ team — most workspaces never need this.',
  admin: 'Full access in this workspace: invite users, edit billing, manage all records and checks. The first person to set up a workspace is usually the admin.',
  supervisor: 'Schedules checks, edits records (customers / sites / assets / plans), reviews defects. Cannot manage users or billing.',
  technician: 'Runs checks and tests on-site: marks items pass / fail, saves wizard steps, raises defects. Cannot manage records.',
  read_only: 'View-only access. Useful for customer-side stakeholders who want to see status but never edit.',
}

export function InviteUserForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string>()
  // Per-field validation errors (form polish bundle — PR H pattern).
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ok, setOk] = useState(false)
  const [pending, startTransition] = useTransition()
  const [selectedRole, setSelectedRole] = useState<string>('technician')

  const [okEmail, setOkEmail] = useState<string>()

  function onSubmit(formData: FormData) {
    setError(undefined); setErrors({}); setOk(false); setOkEmail(undefined)
    startTransition(async () => {
      const res = await inviteUserAction(formData)
      if ('error' in res && res.error) {
        setError(res.error)
        const fieldErrors = (res as { errors?: Record<string, string> }).errors ?? {}
        setErrors(fieldErrors)
        const firstKey = Object.keys(fieldErrors)[0]
        if (firstKey && formRef.current) {
          const el = formRef.current.querySelector(`[name="${firstKey}"]`) as HTMLElement | null
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          ;(el as HTMLInputElement | null)?.focus?.()
        }
      } else if ('ok' in res && res.ok) {
        setOk(true)
        setOkEmail(res.email)
        formRef.current?.reset()
      }
    })
  }

  return (
    <form ref={formRef} action={onSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
      <FormInput label="Email" name="email" type="email" required disabled={pending} error={errors.email} />
      <FormInput label="Full name" name="full_name" disabled={pending} error={errors.full_name} />
      <div className="flex flex-col gap-1">
        <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Role</label>
        <select
          name="role"
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
          disabled={pending}
          className={`h-10 px-4 border rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:ring-2 ${errors.role ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : 'border-gray-200 focus:border-eq-deep focus:ring-eq-sky/20'}`}
        >
          <option value="super_admin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="supervisor">Supervisor</option>
          <option value="technician">Technician</option>
          <option value="read_only">Read Only</option>
        </select>
        {errors.role && <p className="text-xs text-red-500 mt-1">{errors.role}</p>}
      </div>
      <div className="md:col-span-4 -mt-1 text-xs text-eq-grey leading-relaxed">
        <span className="font-semibold text-eq-deep">What this role can do:</span>{' '}
        {ROLE_DESCRIPTIONS[selectedRole]}
      </div>
      <Button type="submit" loading={pending}>
        Send invite
      </Button>
      {error && (
        <div className="md:col-span-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
          {error}
        </div>
      )}
      {ok && (
        <div className="md:col-span-4 text-xs text-eq-deep bg-eq-ice border border-eq-sky/30 rounded-md p-3">
          Invite sent to <strong>{okEmail}</strong>. They&apos;ll receive an email with a link to set their password.
          If they don&apos;t see it, use the Resend action in the table below.
        </div>
      )}
    </form>
  )
}
