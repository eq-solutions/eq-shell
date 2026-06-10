'use client'

import { useState } from 'react'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { MediaPicker } from '@/components/ui/MediaPicker'
import { createSiteAction, updateSiteAction, toggleSiteActiveAction } from './actions'
import { geocodeSiteAddressAction } from './geocode-action'
import { cascadeArchiveAction } from '@/app/(app)/admin/archive/actions'
import type { Site, Customer } from '@/lib/types'
import { useConfirm } from '@/components/ui/ConfirmDialog'

interface SiteFormProps {
  open: boolean
  onClose: () => void
  site?: Site | null
  customers: Pick<Customer, 'id' | 'name'>[]
  isAdmin: boolean
  /**
   * Pre-fill the Customer dropdown when this form opens in create mode.
   * Used when the form is reached from a customer-scoped surface (e.g.
   * a customer detail page's "Add Site" button, or `/sites?customer_id=X`
   * with the URL param threaded through). Ignored in edit mode — an
   * existing site's customer wins (UX audit PR #149 §A.5).
   */
  prefillCustomerId?: string | null
}

export function SiteForm({ open, onClose, site, customers, isAdmin, prefillCustomerId }: SiteFormProps) {
  const [error, setError] = useState<string | null>(null)
  // Per-field validation errors (PR H — UX audit §2.11 / §3.5). Mirrors
  // the legacy `error` banner: both come from the same server-action
  // response. Form keys (`name`, `code`, `customer_id`, ...) match the
  // input names.
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(site?.photo_url ?? null)
  const [logoUrl, setLogoUrl] = useState<string | null>(
    (site as unknown as { logo_url?: string | null })?.logo_url ?? null,
  )
  const [logoUrlOnDark, setLogoUrlOnDark] = useState<string | null>(
    (site as unknown as { logo_url_on_dark?: string | null })?.logo_url_on_dark ?? null,
  )
  // Lat/lng are controlled so the Geocode button can populate them.
  const [latitude, setLatitude] = useState<string>(site?.latitude != null ? String(site.latitude) : '')
  const [longitude, setLongitude] = useState<string>(site?.longitude != null ? String(site.longitude) : '')
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeMsg, setGeocodeMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const confirm = useConfirm()

  const isEdit = !!site

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setErrors({})
    setSuccess(false)
    setLoading(true)

    const form = e.currentTarget
    const formData = new FormData(form)
    const result = isEdit
      ? await updateSiteAction(site!.id, formData)
      : await createSiteAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
      setTimeout(() => onClose(), 500)
    } else {
      const r = result as { error?: string; errors?: Record<string, string> }
      setError(r.error ?? 'Something went wrong.')
      const fieldErrors = r.errors ?? {}
      setErrors(fieldErrors)
      // Scroll-to-first-error (PR H §3.5 / §A.11 — bottom-only red line
      // forced the admin to scroll, guess which field, fix, resubmit).
      // Pick the first field with an error and scroll its input into view.
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

  async function handleGeocode(form: HTMLFormElement) {
    setGeocodeMsg(null)
    const fd = new FormData(form)
    // Only the address fields — strip everything else.
    const trimmed = new FormData()
    for (const k of ['address', 'city', 'state', 'postcode', 'country']) {
      const v = fd.get(k)
      if (typeof v === 'string') trimmed.set(k, v)
    }
    if (!String(trimmed.get('address') ?? '').trim()) {
      setGeocodeMsg({ kind: 'err', text: 'Enter an address first.' })
      return
    }
    setGeocoding(true)
    const res = await geocodeSiteAddressAction(trimmed)
    setGeocoding(false)
    if (!res.ok) {
      setGeocodeMsg({ kind: 'err', text: res.error })
      return
    }
    setLatitude(String(res.latitude))
    setLongitude(String(res.longitude))
    setGeocodeMsg({
      kind: 'ok',
      text: `Geocoded to ${res.latitude.toFixed(6)}, ${res.longitude.toFixed(6)} — ${res.displayName}`,
    })
  }

  async function handleToggleActive() {
    if (!site) return
    // Reactivating is simple — flip the flag.
    if (!site.is_active) {
      setLoading(true)
      const result = await toggleSiteActiveAction(site.id, true)
      setLoading(false)
      if (result.success) onClose()
      else setError(result.error ?? 'Something went wrong.')
      return
    }
    // Archiving cascades: site + assets all flip is_active=false so the
    // whole subtree lands in /admin/archive together. Reversible inside
    // the grace window via the Archive page.
    const ok = await confirm({
      title: `Archive "${site.name}"?`,
      message: 'All its assets will move to /admin/archive and auto-delete after the grace period unless restored.',
      confirmLabel: 'Archive',
    })
    if (!ok) return
    setLoading(true)
    const fd = new FormData()
    fd.set('entity_type', 'site')
    fd.set('entity_id', site.id)
    const result = await cascadeArchiveAction(fd)
    setLoading(false)
    if (result && 'error' in result && result.error) {
      setError(result.error)
    } else {
      onClose()
    }
  }

  // Sticky-footer migration (form polish bundle — §A.12 / §3.6). The submit
  // and cancel buttons live in the SlidePanel `footer` slot so they stay
  // visible while the admin scrolls through the long Address / MediaPicker
  // section on iPad portrait. The submit button lives OUTSIDE the form and
  // uses HTML's `form="site-form"` attribute to dispatch the form's submit
  // event — see SlidePanel.footer JSDoc.
  const formId = 'site-form'
  const footer = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button type="submit" form={formId} loading={loading}>
          {isEdit ? 'Update Site' : 'Create Site'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {isEdit && isAdmin && (
        <div className="pt-3 border-t border-gray-100">
          <Button
            type="button"
            variant={site!.is_active ? 'danger' : 'primary'}
            size="sm"
            onClick={handleToggleActive}
            disabled={loading}
          >
            {site!.is_active ? 'Archive Site (cascade)' : 'Reactivate Site'}
          </Button>
          {site!.is_active && (
            <p className="text-xs text-eq-grey mt-2">
              Cascades to all assets under this site. Reversible from /admin/archive inside the grace period.
            </p>
          )}
        </div>
      )}
    </div>
  )

  return (
    <SlidePanel open={open} onClose={onClose} title={isEdit ? 'Edit Site' : 'Add Site'} footer={footer}>
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <FormInput
          label="Name"
          name="name"
          required
          defaultValue={site?.name ?? ''}
          placeholder="Site name"
          error={errors.name}
        />
        <FormInput
          label="Code"
          name="code"
          defaultValue={site?.code ?? ''}
          placeholder="e.g. SY1"
          error={errors.code}
        />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Customer</label>
          <select
            name="customer_id"
            defaultValue={site?.customer_id ?? prefillCustomerId ?? ''}
            className="h-10 px-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
          >
            <option value="">— No customer —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <FormInput
          label="Address"
          name="address"
          defaultValue={site?.address ?? ''}
          placeholder="Street address"
        />
        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="City"
            name="city"
            defaultValue={site?.city ?? ''}
            placeholder="City"
          />
          <FormInput
            label="State"
            name="state"
            defaultValue={site?.state ?? ''}
            placeholder="e.g. NSW"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Postcode"
            name="postcode"
            defaultValue={site?.postcode ?? ''}
            placeholder="2000"
          />
          <FormInput
            label="Country"
            name="country"
            defaultValue={site?.country ?? 'Australia'}
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-eq-grey">
            Geocoding fills the lat/lng below from the address fields above.
            Save the form to persist.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={geocoding}
            onClick={(e) => {
              const form = (e.currentTarget as HTMLButtonElement).closest('form')
              if (form) void handleGeocode(form)
            }}
          >
            Geocode from address
          </Button>
        </div>
        {geocodeMsg && (
          <p className={
            'text-xs ' +
            (geocodeMsg.kind === 'ok' ? 'text-green-600' : 'text-red-500')
          }>
            {geocodeMsg.text}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Latitude"
            name="latitude"
            type="number"
            step="any"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
            placeholder="-33.9219"
          />
          <FormInput
            label="Longitude"
            name="longitude"
            type="number"
            step="any"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
            placeholder="151.1880"
          />
        </div>

        {/* Site Photo */}
        <div className="space-y-1">
          <MediaPicker
            label="Site Photo"
            value={photoUrl}
            onChange={(url) => setPhotoUrl(url)}
            category="site_photo"
            placeholder="Select site photo from media library…"
          />
          <input type="hidden" name="photo_url" value={photoUrl ?? ''} />
        </div>

        {/* Site Logo — optional override of customer logo */}
        <div className="space-y-3 pt-2 border-t border-gray-100">
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site Logo Override</p>
            <p className="text-xs text-eq-grey mt-0.5">Optional. Leave empty to inherit from customer.</p>
          </div>
          <MediaPicker
            label="Logo on light backgrounds"
            value={logoUrl}
            onChange={(url) => setLogoUrl(url)}
            category="customer_logo"
            surface="light"
            previewBackground="light"
            placeholder="Select light-surface logo…"
          />
          <MediaPicker
            label="Logo on dark backgrounds"
            value={logoUrlOnDark}
            onChange={(url) => setLogoUrlOnDark(url)}
            category="customer_logo"
            surface="dark"
            previewBackground="dark"
            placeholder="Select dark-surface logo…"
          />
          <input type="hidden" name="logo_url" value={logoUrl ?? ''} />
          <input type="hidden" name="logo_url_on_dark" value={logoUrlOnDark ?? ''} />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Saved successfully.</p>}
      </form>
    </SlidePanel>
  )
}
