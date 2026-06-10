'use client'

import { useState, useTransition } from 'react'
import {
  setActiveAction,
  setRoleAction,
  removeUserFromTenantAction,
  resendInviteAction,
  repairUserTenantAction,
  hardDeleteUserAction,
} from './actions'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useConfirm } from '@/components/ui/ConfirmDialog'

interface Profile {
  id: string
  email: string
  full_name: string | null
  role: string
  /** Account-level: signs them out across all tenants if false. */
  is_active: boolean
  /**
   * Tenant-level: false means their `tenant_members` row in the current
   * tenant is soft-deleted. They keep showing up on this page so the admin
   * can re-attach them via the "Attach" button.
   */
  is_active_in_tenant: boolean
  last_login_at: string | null
  created_at: string
  has_tenant_membership: boolean
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  // Pin timeZone so server (UTC) and client (AEST) render the same string.
  // Without this, `last_login_at` values near midnight UTC trigger React
  // hydration error #418 because the server renders one day and the browser
  // another.
  return new Date(s).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Australia/Sydney',
  })
}

export function UsersTable({
  users,
  currentUserId,
  callerRole,
  showArchived,
}: {
  users: Profile[]
  currentUserId: string
  /** Role of the admin viewing this page — gates the Permanently Delete button. */
  callerRole: string
  /** Whether the page is currently showing archived users. Empty-state copy adapts. */
  showArchived: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const confirm = useConfirm()

  const isSuperAdmin = callerRole === 'super_admin'

  function show(kind: 'ok' | 'err', text: string) {
    setNotice({ kind, text })
  }

  function toggleActive(userId: string, newVal: boolean) {
    const fd = new FormData()
    fd.set('user_id', userId)
    fd.set('is_active', String(newVal))
    setNotice(null)
    startTransition(async () => {
      const res = await setActiveAction(fd)
      if (res && 'error' in res && res.error) show('err', res.error)
    })
  }

  function changeRole(userId: string, newRole: string) {
    const fd = new FormData()
    fd.set('user_id', userId)
    fd.set('role', newRole)
    setNotice(null)
    startTransition(async () => {
      const res = await setRoleAction(fd)
      if (res && 'error' in res && res.error) show('err', res.error)
    })
  }

  async function archiveFromTenant(userId: string, label: string) {
    const ok = await confirm({
      title: `Archive ${label}?`,
      message: 'Remove them from this workspace. Their login stays in place and you can add them back later. Use Show archived to find them again.',
      confirmLabel: 'Archive',
    })
    if (!ok) return
    setNotice(null)
    const fd = new FormData()
    fd.set('user_id', userId)
    startTransition(async () => {
      const res = await removeUserFromTenantAction(fd)
      if (res && 'error' in res && res.error) show('err', res.error)
    })
  }

  async function resendInvite(userId: string, label: string) {
    const ok = await confirm({
      title: 'Resend invite?',
      message: `Resend the invite email to ${label}?`,
      confirmLabel: 'Resend',
    })
    if (!ok) return
    setNotice(null)
    const fd = new FormData()
    fd.set('user_id', userId)
    startTransition(async () => {
      const res = await resendInviteAction(fd)
      if (res && 'error' in res && res.error) show('err', res.error)
      else show('ok', 'Invite resent.')
    })
  }

  async function repairUser(userId: string, label: string, role: string) {
    const ok = await confirm({
      title: 'Add user to workspace?',
      message: `Add ${label} to this workspace as ${role}?`,
      confirmLabel: 'Add',
    })
    if (!ok) return
    setNotice(null)
    const fd = new FormData()
    fd.set('user_id', userId)
    fd.set('role', role || 'technician')
    startTransition(async () => {
      const res = await repairUserTenantAction(fd)
      if (res && 'error' in res && res.error) show('err', res.error)
      else show('ok', 'User added to this workspace.')
    })
  }

  async function hardDelete(userId: string, label: string) {
    // Two confirmations because this is irreversible — the second prompt
    // forces the admin to type the user's email/name to proceed.
    const ok = await confirm({
      title: `Permanently delete ${label}?`,
      message: 'This wipes their auth account and CANNOT be undone. Historical records keep their name as a string.',
      confirmLabel: 'Continue',
      destructive: true,
    })
    if (!ok) return
    const typed = prompt(`Type "${label}" exactly to confirm permanent deletion:`)
    if (typed?.trim() !== label) {
      show('err', 'Confirmation text did not match — deletion cancelled.')
      return
    }
    setNotice(null)
    const fd = new FormData()
    fd.set('user_id', userId)
    startTransition(async () => {
      const res = await hardDeleteUserAction(fd)
      if (res && 'error' in res && res.error) show('err', res.error)
      else show('ok', `${label} permanently deleted.`)
    })
  }

  return (
    <>
      {notice && (
        <div
          className={
            'px-4 py-2 border-b text-xs ' +
            (notice.kind === 'ok'
              ? 'bg-eq-ice border-eq-sky/30 text-eq-deep'
              : 'bg-red-50 border-red-100 text-red-700')
          }
        >
          {notice.text}
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs font-bold text-eq-grey uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-3">Email</th>
            <th className="text-left px-4 py-3">Name</th>
            <th className="text-left px-4 py-3">Role</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Last login</th>
            <th className="text-right px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {users.map((u) => {
            const isSelf = u.id === currentUserId
            // `has_tenant_membership` is true only for ACTIVE tenant members.
            // A row with `is_active_in_tenant === false` represents a user who
            // was previously in this tenant but has been soft-archived — they
            // only appear when the admin opted into Show archived.
            const removedFromTenant = !u.is_active_in_tenant
            const label = u.full_name || u.email
            return (
              <tr key={u.id} className={u.is_active && !removedFromTenant ? '' : 'bg-gray-50/50'}>
                <td className="px-4 py-3 text-eq-ink font-medium">{u.email}</td>
                <td className="px-4 py-3 text-eq-grey">{u.full_name || '—'}</td>
                <td className="px-4 py-3">
                  <select
                    value={u.role}
                    disabled={pending || isSelf || removedFromTenant}
                    onChange={(e) => changeRole(u.id, e.target.value)}
                    className="h-8 px-2 border border-gray-200 rounded text-xs text-eq-ink bg-white disabled:opacity-50"
                    title={removedFromTenant ? 'Add this user to your workspace first' : undefined}
                  >
                    <option value="super_admin">Super Admin</option>
                    <option value="admin">Admin</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="technician">Technician</option>
                    <option value="read_only">Read Only</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  {removedFromTenant ? (
                    <span title="Removed from this workspace. Click Add to bring them back, or (top-level admin) Delete permanently to wipe their login.">
                      <StatusBadge status="overdue" label="Archived" />
                    </span>
                  ) : (
                    <StatusBadge
                      status={u.is_active ? 'active' : 'inactive'}
                      label={u.is_active ? 'Active' : 'Disabled'}
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-eq-grey text-xs">{fmtDate(u.last_login_at)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {removedFromTenant && (
                      <button
                        type="button"
                        onClick={() => repairUser(u.id, label, u.role)}
                        disabled={pending}
                        className="text-xs font-semibold text-eq-deep hover:text-eq-sky disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                        title="Add this user back into this workspace"
                      >
                        Add
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => resendInvite(u.id, label)}
                      disabled={pending || removedFromTenant}
                      className="text-xs font-semibold text-eq-deep hover:text-eq-sky disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                      title={removedFromTenant
                        ? 'Add the user to the workspace first before resending an invite'
                        : 'Resend the invite / password reset email'}
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(u.id, !u.is_active)}
                      disabled={pending || isSelf}
                      className="text-xs font-semibold text-eq-deep hover:text-eq-sky disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                      title={u.is_active
                        ? 'Stop this person signing into ANY workspace — different from Archive (this workspace only)'
                        : 'Let this person sign in again across every workspace'}
                    >
                      {u.is_active ? 'Disable account' : 'Enable account'}
                    </button>
                    {!removedFromTenant && (
                      <button
                        type="button"
                        onClick={() => archiveFromTenant(u.id, label)}
                        disabled={pending || isSelf}
                        className="text-xs font-semibold text-amber-700 hover:text-amber-800 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                        title="Archive this user from this workspace (you can bring them back via Show archived)"
                      >
                        Archive
                      </button>
                    )}
                    {isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => hardDelete(u.id, label)}
                        disabled={pending || isSelf}
                        className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                        title="PERMANENTLY delete this user's login. Cannot be undone. Top-level admins only."
                      >
                        Delete permanently
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
          {users.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-eq-grey text-sm">
                {showArchived
                  ? 'No archived users in this workspace.'
                  : 'No active users in this workspace — invite someone above to get started.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  )
}
