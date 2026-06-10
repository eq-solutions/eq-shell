'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { createAssetAction, updateAssetAction, toggleAssetActiveAction } from './actions'
import { formatDate, formatSiteLabel } from '@/lib/utils/format'
import type { Asset, Site, JobPlan } from '@/lib/types'

interface AssetFormProps {
  open: boolean
  onClose: () => void
  asset?: Asset | null
  sites: (Pick<Site, 'id' | 'name'> & {
    code?: string | null
    customers?: { name?: string | null } | { name?: string | null }[] | null
  })[]
  jobPlans?: Pick<JobPlan, 'id' | 'name' | 'code'>[]
  isAdmin: boolean
  canWrite: boolean
  /**
   * Pre-fill the Site dropdown when this form opens in create mode.
   * Used when the form is reached from a site-scoped surface (e.g.
   * `/assets?site_id=X` with the URL param threaded through, or a
   * site detail page's "Add Asset" button). Ignored in edit mode
   * (UX audit PR #149 §A.5).
   */
  prefillSiteId?: string | null
  /**
   * Distinct existing asset types in this tenant — fed to a `<datalist>`
   * autocomplete so admins reuse "Switchboard" instead of typing
   * "SB" / "switchboard" / "Switch Board" inconsistently
   * (UX audit PR #149 §A.4 — A.5 smart defaults bullet for Asset Type).
   * Optional — defaults to no autocomplete.
   */
  assetTypes?: string[]
}

export function AssetForm({ open, onClose, asset, sites, jobPlans = [], isAdmin, canWrite: canWriteRole, prefillSiteId, assetTypes = [] }: AssetFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [editMode, setEditMode] = useState(false)

  const isEdit = !!asset
  const showForm = !isEdit || editMode

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setErrors({})
    setSuccess(false)
    setLoading(true)

    const form = e.currentTarget
    const formData = new FormData(form)
    const result = isEdit
      ? await updateAssetAction(asset!.id, formData)
      : await createAssetAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
      setTimeout(() => { onClose(); setEditMode(false) }, 500)
    } else {
      setError(result.error ?? 'Something went wrong.')
      // PR H follow-on (form polish bundle): per-field errors + scroll-to-first.
      const fieldErrors = (result as { errors?: Record<string, string> }).errors ?? {}
      setErrors(fieldErrors)
      const firstKey = Object.keys(fieldErrors)[0]
      if (firstKey) {
        const el = form.querySelector(`[name="${firstKey}"]`) as HTMLElement | null
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        ;(el as HTMLInputElement | null)?.focus?.()
      }
    }
  }

  async function handleToggleActive() {
    if (!asset) return
    setLoading(true)
    const result = await toggleAssetActiveAction(asset.id, !asset.is_active)
    setLoading(false)
    if (result.success) {
      onClose()
      setEditMode(false)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  function handleClose() {
    onClose()
    setEditMode(false)
    setError(null)
    setSuccess(false)
  }

  // Detail view (read-only)
  if (isEdit && !showForm) {
    const siteName = sites.find((s) => s.id === asset!.site_id)?.name ?? '—'
    return (
      <SlidePanel open={open} onClose={handleClose} title={asset!.name}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <StatusBadge status={asset!.is_active ? 'active' : 'inactive'} />
            {canWriteRole && (
              <Button size="sm" onClick={() => setEditMode(true)}>Edit</Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Type</dt>
              <dd className="text-eq-ink mt-1">{asset!.asset_type}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Site</dt>
              <dd className="text-eq-ink mt-1">{siteName}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Manufacturer</dt>
              <dd className="text-eq-ink mt-1">{asset!.manufacturer ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Model</dt>
              <dd className="text-eq-ink mt-1">{asset!.model ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Serial Number</dt>
              <dd className="text-eq-ink mt-1">{asset!.serial_number ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Maximo ID</dt>
              <dd className="text-eq-ink mt-1">{asset!.maximo_id ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Location</dt>
              <dd className="text-eq-ink mt-1">{asset!.location ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Install Date</dt>
              <dd className="text-eq-ink mt-1">{asset!.install_date ? formatDate(asset!.install_date) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Maintenance Plan</dt>
              <dd className="text-eq-ink mt-1">
                {asset!.job_plan_id && jobPlans.length > 0 ? (
                  (() => {
                    const jp = jobPlans.find((j) => j.id === asset!.job_plan_id)
                    return jp ? (
                      <a href={`/job-plans?search=${encodeURIComponent(jp.name)}`} className="text-eq-sky hover:text-eq-deep transition-colors">
                        {jp.name}{jp.code ? ` (${jp.code})` : ''}
                      </a>
                    ) : '—'
                  })()
                ) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-eq-grey uppercase">Dark Site Test</dt>
              <dd className="text-eq-ink mt-1">{asset!.dark_site_test ? 'Yes' : 'No'}</dd>
            </div>
          </div>
        </div>
      </SlidePanel>
    )
  }

  // Create/Edit form
  return (
    <SlidePanel open={open} onClose={handleClose} title={isEdit ? 'Edit Asset' : 'Add Asset'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide">Identification</h3>
        <FormInput label="Name" name="name" required defaultValue={asset?.name ?? ''} placeholder="Asset name" error={errors.name} />
        <FormInput
          label="Asset Type"
          name="asset_type"
          required
          defaultValue={asset?.asset_type ?? ''}
          placeholder="e.g. ACB, Switchboard"
          list={assetTypes.length > 0 ? 'asset-types-suggestions' : undefined}
          autoComplete="off"
          error={errors.asset_type}
        />
        {assetTypes.length > 0 && (
          <datalist id="asset-types-suggestions">
            {assetTypes.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        )}
        <FormInput label="Manufacturer" name="manufacturer" defaultValue={asset?.manufacturer ?? ''} placeholder="Manufacturer" />
        <FormInput label="Model" name="model" defaultValue={asset?.model ?? ''} placeholder="Model" />
        <FormInput label="Serial Number" name="serial_number" defaultValue={asset?.serial_number ?? ''} placeholder="Serial number" />
        <FormInput label="Maximo ID" name="maximo_id" defaultValue={asset?.maximo_id ?? ''} placeholder="Maximo ID" />

        <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide pt-4">Location</h3>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site</label>
          <select
            name="site_id"
            required
            defaultValue={asset?.site_id ?? prefillSiteId ?? ''}
            className={`h-10 px-4 border rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:ring-2 ${errors.site_id ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : 'border-gray-200 focus:border-eq-deep focus:ring-eq-sky/20'}`}
          >
            <option value="">Select site...</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{formatSiteLabel(s)}</option>
            ))}
          </select>
          {errors.site_id && <p className="text-xs text-red-500 mt-1">{errors.site_id}</p>}
        </div>
        <FormInput label="Location" name="location" defaultValue={asset?.location ?? ''} placeholder="e.g. Level 2, DB-03" />

        <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide pt-4">Maintenance</h3>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Maintenance Plan</label>
          <select
            name="job_plan_id"
            defaultValue={asset?.job_plan_id ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">No maintenance plan</option>
            {jobPlans.map((jp) => (
              <option key={jp.id} value={jp.id}>{jp.name}{jp.code ? ` (${jp.code})` : ''}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-eq-ink">
          <input
            type="checkbox"
            name="dark_site_test"
            defaultChecked={asset?.dark_site_test ?? false}
            className="rounded border-gray-300 text-eq-sky focus:ring-eq-sky"
          />
          Dark Site Test asset
        </label>

        <h3 className="text-xs font-bold text-eq-grey uppercase tracking-wide pt-4">Details</h3>
        <FormInput label="Install Date" name="install_date" type="date" defaultValue={asset?.install_date ?? ''} />

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Saved successfully.</p>}

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" loading={loading}>
            {isEdit ? 'Update Asset' : 'Create Asset'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
        </div>

        {isEdit && isAdmin && (
          <div className="pt-4 border-t border-gray-200 mt-4">
            <Button
              type="button"
              variant={asset!.is_active ? 'danger' : 'primary'}
              size="sm"
              onClick={handleToggleActive}
              disabled={loading}
            >
              {asset!.is_active ? 'Deactivate Asset' : 'Reactivate Asset'}
            </Button>
          </div>
        )}
      </form>
    </SlidePanel>
  )
}
