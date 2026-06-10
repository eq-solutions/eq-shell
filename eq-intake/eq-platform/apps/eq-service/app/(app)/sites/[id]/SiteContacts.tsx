'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { Card } from '@/components/ui/Card'
import { createSiteContactAction, updateSiteContactAction, deleteSiteContactAction } from './contact-actions'
import type { SiteContact } from '@/lib/types'
import { Star, Pencil, Trash2, Plus, X } from 'lucide-react'
import { useConfirm } from '@/components/ui/ConfirmDialog'

interface SiteContactsProps {
  siteId: string
  contacts: SiteContact[]
  isAdmin: boolean
}

export function SiteContacts({ siteId, contacts, isAdmin }: SiteContactsProps) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<SiteContact | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const confirm = useConfirm()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = editing
      ? await updateSiteContactAction(editing.id, siteId, formData)
      : await createSiteContactAction(siteId, formData)

    setLoading(false)
    if (result.success) {
      setShowForm(false)
      setEditing(null)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleDelete(contact: SiteContact) {
    const ok = await confirm({
      title: `Remove contact "${contact.name}"?`,
      message: 'This will detach the contact from this site. You can re-add them later.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    setLoading(true)
    const result = await deleteSiteContactAction(contact.id, siteId)
    setLoading(false)
    if (!result.success) {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  function startEdit(contact: SiteContact) {
    setEditing(contact)
    setShowForm(true)
    setError(null)
  }

  function cancelForm() {
    setShowForm(false)
    setEditing(null)
    setError(null)
  }

  const primary = contacts.find(c => c.is_primary)
  const others = contacts.filter(c => !c.is_primary)
  const sorted = primary ? [primary, ...others] : others

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-eq-ink">Site Contacts</h2>
        {isAdmin && !showForm && (
          <Button size="sm" onClick={() => { setShowForm(true); setEditing(null); setError(null) }}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Contact
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-eq-deep">{editing ? 'Edit Contact' : 'New Contact'}</h3>
              <button type="button" onClick={cancelForm} className="text-eq-grey hover:text-eq-ink">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormInput label="Name" name="name" required defaultValue={editing?.name ?? ''} placeholder="Contact name" />
              <FormInput label="Role" name="role" defaultValue={editing?.role ?? ''} placeholder="e.g. Facility Manager" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormInput label="Email" name="email" type="email" defaultValue={editing?.email ?? ''} placeholder="contact@example.com" />
              <FormInput label="Phone" name="phone" defaultValue={editing?.phone ?? ''} placeholder="+61 400 000 000" />
            </div>
            <label className="flex items-center gap-2 text-sm text-eq-ink cursor-pointer">
              <input type="checkbox" name="is_primary" defaultChecked={editing?.is_primary ?? false} className="w-4 h-4 rounded border-gray-300 text-eq-sky focus:ring-eq-sky" />
              Primary contact
            </label>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" loading={loading}>
                {editing ? 'Update' : 'Add'}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={cancelForm}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {sorted.length === 0 ? (
        <p className="text-sm text-eq-grey">No contacts added yet.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((contact) => (
            <div
              key={contact.id}
              className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-lg"
            >
              {contact.is_primary && (
                <Star className="w-4 h-4 text-amber-500 fill-amber-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-eq-ink text-sm">{contact.name}</span>
                  {contact.role && <span className="text-xs text-eq-grey">({contact.role})</span>}
                </div>
                <div className="flex items-center gap-4 text-xs text-eq-grey mt-0.5">
                  {contact.email && <span>{contact.email}</span>}
                  {contact.phone && <span>{contact.phone}</span>}
                </div>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => startEdit(contact)} className="p-1.5 text-eq-grey hover:text-eq-sky transition-colors" title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(contact)} className="p-1.5 text-eq-grey hover:text-red-500 transition-colors" title="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
