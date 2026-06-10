'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import {
  createJobPlanAction,
  updateJobPlanAction,
  toggleJobPlanActiveAction,
  createJobPlanItemAction,
  updateJobPlanItemAction,
  deleteJobPlanItemAction,
} from './actions'
import type { JobPlan, JobPlanItem, Site } from '@/lib/types'
import { Plus, Trash2 } from 'lucide-react'
import { FrequencyBadges, FREQUENCY_DEFS, type FrequencyKey } from '@/components/ui/FrequencyBadges'
import { formatSiteLabel } from '@/lib/utils/format'

const FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'biannual', label: 'Bi-annual' },
  { value: 'annual', label: 'Annual' },
  { value: 'ad_hoc', label: 'Ad Hoc' },
]

interface JobPlanFormProps {
  open: boolean
  onClose: () => void
  jobPlan?: JobPlan | null
  items?: JobPlanItem[]
  sites: (Pick<Site, 'id' | 'name'> & {
    code?: string | null
    customers?: { name?: string | null } | { name?: string | null }[] | null
  })[]
  isAdmin: boolean
  canWrite: boolean
  /**
   * Pre-fill the Site dropdown when this form opens in create mode.
   * Used when the form is reached from a site-scoped surface (e.g.
   * `/job-plans?site_id=X` with the URL param threaded through). Smart-
   * defaults framework (PR D follow-on, deferred from #162). Ignored
   * in edit mode — existing plan's site wins.
   */
  prefillSiteId?: string | null
}

export function JobPlanForm({ open, onClose, jobPlan, items = [], sites, isAdmin, canWrite: canWriteRole, prefillSiteId }: JobPlanFormProps) {
  const [error, setError] = useState<string | null>(null)
  // Per-field validation errors (PR H pattern).
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [itemError, setItemError] = useState<string | null>(null)
  const [showAddItem, setShowAddItem] = useState(false)
  // Tracks a plan just created in this panel session — keeps the form
  // open so the user can add tasks inline instead of save-then-reopen.
  // UX audit §A.3 / §2.3 — addresses the "save empty plan, get empty
  // task list on site" silent failure.
  const [createdPlan, setCreatedPlan] = useState<{ id: string } | null>(null)

  const isEdit = !!jobPlan
  const effectivePlanId = jobPlan?.id ?? createdPlan?.id ?? null
  const showItemsSection = isEdit || createdPlan !== null

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setErrors({})
    setSuccess(false)
    setLoading(true)

    const form = e.currentTarget
    const formData = new FormData(form)
    const result = isEdit
      ? await updateJobPlanAction(jobPlan!.id, formData)
      : await createJobPlanAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
      if (!isEdit) {
        // Don't auto-close — switch to "just-created" mode so the user
        // sees the Items section and can add tasks inline. If createPlanAction
        // didn't return an id (legacy path), fall back to the old auto-close
        // behaviour so we don't leave the form in a broken state.
        const newId = (result as { data?: { id?: string } }).data?.id
        if (newId) {
          setCreatedPlan({ id: newId })
        } else {
          setTimeout(() => onClose(), 500)
        }
      }
    } else {
      const r = result as { error?: string; errors?: Record<string, string> }
      setError(r.error ?? 'Something went wrong.')
      const fieldErrors = r.errors ?? {}
      setErrors(fieldErrors)
      const firstKey = Object.keys(fieldErrors)[0]
      if (firstKey) {
        const target = form.querySelector(`[name="${CSS.escape(firstKey)}"]`) as HTMLElement | null
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' })
          if (typeof (target as HTMLInputElement).focus === 'function') {
            ;(target as HTMLInputElement).focus({ preventScroll: true })
          }
        }
      }
    }
  }

  async function handleToggleActive() {
    if (!jobPlan) return
    setLoading(true)
    const result = await toggleJobPlanActiveAction(jobPlan.id, !jobPlan.is_active)
    setLoading(false)
    if (result.success) {
      onClose()
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleAddItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!effectivePlanId) return
    setItemError(null)

    const formData = new FormData(e.currentTarget)
    const result = await createJobPlanItemAction(effectivePlanId, formData)
    if (result.success) {
      setShowAddItem(false)
      ;(e.target as HTMLFormElement).reset()
    } else {
      setItemError(result.error ?? 'Failed to add task.')
    }
  }

  async function handleDeleteItem(itemId: string) {
    if (!effectivePlanId) return
    await deleteJobPlanItemAction(effectivePlanId, itemId)
  }

  async function handleUpdateItem(itemId: string, formData: FormData) {
    if (!effectivePlanId) return
    setItemError(null)
    const result = await updateJobPlanItemAction(effectivePlanId, itemId, formData)
    if (!result.success) {
      setItemError(result.error ?? 'Failed to update task.')
    }
  }

  return (
    <SlidePanel open={open} onClose={onClose} title={isEdit ? 'Edit Maintenance Plan' : 'Add Maintenance Plan'} wide={isEdit}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Name" name="name" required defaultValue={jobPlan?.name ?? ''} placeholder="e.g. E1.12" error={errors.name} />
          <FormInput label="Job Code" name="code" defaultValue={jobPlan?.code ?? ''} placeholder="e.g. SJPNL1" error={errors.code} />
        </div>

        <FormInput label="Type" name="type" defaultValue={jobPlan?.type ?? ''} placeholder="e.g. CP Distribution Panel (RPP)" error={errors.type} />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site</label>
          <select
            name="site_id"
            defaultValue={jobPlan?.site_id ?? prefillSiteId ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">No site (global)</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{formatSiteLabel(s)}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Description</label>
          <textarea
            name="description"
            defaultValue={jobPlan?.description ?? ''}
            rows={3}
            placeholder="Optional description"
            className="px-4 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Frequency</label>
          <select
            name="frequency"
            defaultValue={jobPlan?.frequency ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">Per item (see tasks)</option>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Saved successfully.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" loading={loading}>
            {isEdit ? 'Update Maintenance Plan' : 'Create Maintenance Plan'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>

        {isEdit && isAdmin && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <Button
              type="button"
              variant={jobPlan!.is_active ? 'danger' : 'primary'}
              size="sm"
              onClick={handleToggleActive}
              disabled={loading}
            >
              {jobPlan!.is_active ? 'Deactivate Maintenance Plan' : 'Reactivate Maintenance Plan'}
            </Button>
          </div>
        )}
      </form>

      {/* Maintenance Plan Items / Tasks — visible in edit mode AND for a plan that
          was just created in this panel session (createdPlan state). The
          audit (PR #149 §A.3 / §2.3) flagged that hiding this in create-mode
          caused admins to save empty plans and discover the failure on-site
          when techs opened the corresponding check. */}
      {showItemsSection && (
        <div className="mt-6 pt-4 border-t border-gray-200">
          {createdPlan && !isEdit && (
            <div className="mb-3 px-3 py-2 rounded-md bg-eq-ice border border-eq-sky/30 text-xs text-eq-deep">
              Plan saved. Add at least one task below — a plan without tasks
              creates empty per-asset checklists when used in a maintenance check.
            </div>
          )}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-bold text-eq-ink">Maintenance Plan Items</h3>
              <p className="text-xs text-eq-grey mt-0.5">{items.length} task{items.length !== 1 ? 's' : ''}</p>
            </div>
            {canWriteRole && (
              <Button size="sm" onClick={() => setShowAddItem(true)} type="button">
                <Plus className="w-3 h-3 mr-1" /> Add Task
              </Button>
            )}
          </div>

          {itemError && <p className="text-xs text-red-500 mb-2">{itemError}</p>}

          {items.length === 0 && !showAddItem ? (
            <div className="text-center py-8 border border-dashed border-gray-200 rounded-md">
              <p className="text-sm text-eq-grey">No tasks yet.</p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-bold text-eq-grey uppercase w-16">#</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-eq-grey uppercase">Description</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-eq-grey uppercase w-64">Frequency</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-eq-grey uppercase w-24">Required</th>
                    {canWriteRole && (
                      <th className="px-3 py-2 text-right text-xs font-bold text-eq-grey uppercase w-28">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item) => (
                    <JobPlanItemRow
                      key={item.id}
                      item={item}
                      jobPlanId={effectivePlanId!}
                      canWrite={canWriteRole}
                      onUpdate={handleUpdateItem}
                      onDelete={handleDeleteItem}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {showAddItem && (
            <form onSubmit={handleAddItem} className="mt-3 p-3 border border-gray-200 rounded-md space-y-2">
              <FormInput label="Description" name="description" required placeholder="Task description" />
              <div className="grid grid-cols-2 gap-2">
                <FormInput label="Sort Order" name="sort_order" type="number" defaultValue={String(items.length)} />
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Required</label>
                  <select name="is_required" defaultValue="true" className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white">
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm">Save Task</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddItem(false)}>Cancel</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </SlidePanel>
  )
}

// Inline editable item row (table row)
function JobPlanItemRow({
  item,
  jobPlanId: _jobPlanId,
  canWrite: canWriteRole,
  onUpdate,
  onDelete,
}: {
  item: JobPlanItem
  jobPlanId: string
  canWrite: boolean
  onUpdate: (itemId: string, formData: FormData) => void
  onDelete: (itemId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [desc, setDesc] = useState(item.description)
  const [sortOrder, setSortOrder] = useState(String(item.sort_order))
  const [required, setRequired] = useState(String(item.is_required))
  const [flags, setFlags] = useState<Pick<JobPlanItem, FrequencyKey | 'dark_site'>>({
    dark_site: item.dark_site,
    freq_monthly: item.freq_monthly,
    freq_quarterly: item.freq_quarterly,
    freq_semi_annual: item.freq_semi_annual,
    freq_annual: item.freq_annual,
    freq_2yr: item.freq_2yr,
    freq_3yr: item.freq_3yr,
    freq_5yr: item.freq_5yr,
    freq_8yr: item.freq_8yr,
    freq_10yr: item.freq_10yr,
  })

  function toggleFlag(key: FrequencyKey | 'dark_site') {
    setFlags((f) => ({ ...f, [key]: !f[key] }))
  }

  function handleSave() {
    const formData = new FormData()
    formData.set('description', desc)
    formData.set('sort_order', sortOrder)
    formData.set('is_required', required)
    formData.set('dark_site', String(flags.dark_site))
    for (const f of FREQUENCY_DEFS) formData.set(f.key, String(flags[f.key]))
    onUpdate(item.id, formData)
    setEditing(false)
  }

  if (editing) {
    return (
      <tr className="bg-eq-ice/30">
        <td className="px-3 py-2">
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-12 h-8 px-2 border border-gray-200 rounded text-xs"
          />
        </td>
        <td className="px-3 py-2">
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="w-full h-8 px-2 border border-eq-sky rounded text-sm"
            autoFocus
          />
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1 text-[10px]">
            <label className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border border-gray-200 rounded cursor-pointer hover:border-eq-sky">
              <input type="checkbox" checked={flags.dark_site} onChange={() => toggleFlag('dark_site')} className="w-3 h-3" />
              <span className="font-bold">DS</span>
            </label>
            {FREQUENCY_DEFS.map((f) => (
              <label key={f.key} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white border border-gray-200 rounded cursor-pointer hover:border-eq-sky">
                <input type="checkbox" checked={flags[f.key]} onChange={() => toggleFlag(f.key)} className="w-3 h-3" />
                <span className="font-semibold">{f.short}</span>
              </label>
            ))}
          </div>
        </td>
        <td className="px-3 py-2">
          <select
            value={required}
            onChange={(e) => setRequired(e.target.value)}
            className="h-8 px-2 border border-gray-200 rounded text-xs bg-white"
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </td>
        {canWriteRole && (
          <td className="px-3 py-2 text-right">
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={handleSave}
                className="px-2 py-1 text-xs font-medium bg-eq-sky text-white rounded hover:bg-eq-deep"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setEditing(false); setDesc(item.description); setSortOrder(String(item.sort_order)); setRequired(String(item.is_required)) }}
                className="px-2 py-1 text-xs text-eq-grey hover:text-eq-ink"
              >
                Cancel
              </button>
            </div>
          </td>
        )}
      </tr>
    )
  }

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2 text-xs text-eq-grey font-mono align-top">{item.sort_order}</td>
      <td className="px-3 py-2 text-sm text-eq-ink align-top">
        {item.description}
      </td>
      <td className="px-3 py-2 align-top">
        <FrequencyBadges item={item} size="xs" />
      </td>
      <td className="px-3 py-2 align-top">
        {item.is_required ? (
          <span className="text-xs font-medium text-eq-sky">Yes</span>
        ) : (
          <span className="text-xs text-eq-grey">No</span>
        )}
      </td>
      {canWriteRole && (
        <td className="px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-2 py-1 text-xs text-eq-grey hover:text-eq-ink hover:bg-gray-100 rounded"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600"
              title="Delete task"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      )}
    </tr>
  )
}
