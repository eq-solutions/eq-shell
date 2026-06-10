'use client'

import { useState } from 'react'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { updateProfileAction, changePasswordAction } from './actions'
import { formatDate } from '@/lib/utils/format'
import type { Role } from '@/lib/types'

interface UserSettingsFormProps {
  email: string
  fullName: string
  role: Role
  lastLogin: string | null
  createdAt: string
}

export function UserSettingsForm({ email, fullName, role, lastLogin, createdAt }: UserSettingsFormProps) {
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)

  const [pwError, setPwError] = useState<string | null>(null)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)

  async function handleProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setProfileError(null)
    setProfileSuccess(false)
    setProfileLoading(true)
    const formData = new FormData(e.currentTarget)
    const result = await updateProfileAction(formData)
    setProfileLoading(false)
    if (result.success) setProfileSuccess(true)
    else setProfileError(result.error ?? 'Failed to update profile.')
  }

  async function handlePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPwError(null)
    setPwSuccess(false)
    setPwLoading(true)
    const formData = new FormData(e.currentTarget)
    const result = await changePasswordAction(formData)
    setPwLoading(false)
    if (result.success) {
      setPwSuccess(true)
      e.currentTarget.reset()
    } else {
      setPwError(result.error ?? 'Failed to change password.')
    }
  }

  const roleLabel: Record<Role, string> = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    supervisor: 'Supervisor',
    technician: 'Technician',
    read_only: 'Read Only',
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Account Info */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-4">Account</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs font-bold text-eq-grey uppercase tracking-wide">Email</span>
            <p className="text-eq-ink mt-1">{email}</p>
          </div>
          <div>
            <span className="text-xs font-bold text-eq-grey uppercase tracking-wide">Role</span>
            <div className="mt-1">
              <StatusBadge status="active" label={roleLabel[role]} />
            </div>
          </div>
          <div>
            <span className="text-xs font-bold text-eq-grey uppercase tracking-wide">Member Since</span>
            <p className="text-eq-ink mt-1">{formatDate(createdAt)}</p>
          </div>
          <div>
            <span className="text-xs font-bold text-eq-grey uppercase tracking-wide">Last Login</span>
            <p className="text-eq-ink mt-1">{lastLogin ? formatDate(lastLogin) : '—'}</p>
          </div>
        </div>
      </div>

      {/* Profile */}
      <form onSubmit={handleProfile} className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-4">Profile</h2>
        <div className="space-y-4">
          <FormInput
            label="Full Name"
            name="full_name"
            defaultValue={fullName}
            placeholder="Your full name"
          />
          {profileError && <p className="text-sm text-red-500">{profileError}</p>}
          {profileSuccess && <p className="text-sm text-green-600">Profile updated.</p>}
          <Button type="submit" loading={profileLoading}>
            Update Profile
          </Button>
        </div>
      </form>

      {/* Change Password */}
      <form onSubmit={handlePassword} className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-4">Change Password</h2>
        <div className="space-y-4">
          <FormInput
            label="New Password"
            name="new_password"
            type="password"
            required
            placeholder="Minimum 8 characters"
          />
          <FormInput
            label="Confirm Password"
            name="confirm_password"
            type="password"
            required
            placeholder="Repeat new password"
          />
          {pwError && <p className="text-sm text-red-500">{pwError}</p>}
          {pwSuccess && <p className="text-sm text-green-600">Password changed successfully.</p>}
          <Button type="submit" loading={pwLoading}>
            Change Password
          </Button>
        </div>
      </form>
    </div>
  )
}
