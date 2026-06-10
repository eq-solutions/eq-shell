'use client'

import { useState } from 'react'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { MediaPicker } from '@/components/ui/MediaPicker'
import { updateTenantSettingsAction } from './actions'
import { extractColoursFromImage } from '@/lib/utils/extract-colours'
import type { TenantSettings } from '@/lib/types'
import { Wand2, RotateCcw } from 'lucide-react'

const DEFAULT_COLOURS = {
  primary: '#3DA8D8',
  deep: '#2986B4',
  ice: '#EAF5FB',
  ink: '#1A1A2E',
} as const

interface TenantSettingsFormProps {
  settings: TenantSettings
}

export function TenantSettingsForm({ settings }: TenantSettingsFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  // Live preview of colours
  const [primary, setPrimary] = useState(settings.primary_colour)
  const [deep, setDeep] = useState(settings.deep_colour)
  const [ice, setIce] = useState(settings.ice_colour)
  const [ink, setInk] = useState(settings.ink_colour)

  // Logos — picked from Media Library (single source of truth).
  // Uploads happen in Admin → Media Library; this form just references.
  const [logoUrl, setLogoUrl] = useState(settings.logo_url ?? '')
  const [logoUrlOnDark, setLogoUrlOnDark] = useState(
    (settings as unknown as { logo_url_on_dark?: string | null }).logo_url_on_dark ?? '',
  )
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)

  // Commercial-tier toggle. When off (default for SKS NSW etc.), the
  // contract-scope period-locking, audit history view, variations register,
  // service-credit risk, renewal pack and customer-facing scope statement
  // all stay hidden. The universal tier (scope-context display on checks,
  // auto gap-close, out-of-scope block) runs regardless.
  const [commercialFeaturesEnabled, setCommercialFeaturesEnabled] = useState<boolean>(
    settings.commercial_features_enabled ?? false,
  )

  // Module toggles (migration 0097). Existing tenants land here with
  // every flag true; new tenants default false. Filters which non-core
  // entries appear in the sidebar.
  const [calendarEnabled, setCalendarEnabled] = useState<boolean>(settings.calendar_enabled ?? true)
  const [defectsEnabled, setDefectsEnabled] = useState<boolean>(settings.defects_enabled ?? true)
  const [analyticsEnabled, setAnalyticsEnabled] = useState<boolean>(settings.analytics_enabled ?? true)
  const [contractScopeEnabled, setContractScopeEnabled] = useState<boolean>(settings.contract_scope_enabled ?? true)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    formData.set('logo_url', logoUrl)
    formData.set('logo_url_on_dark', logoUrlOnDark)
    const result = await updateTenantSettingsAction(formData)

    setLoading(false)
    if (result.success) {
      setSuccess(true)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleExtractColours() {
    if (!logoUrl) {
      setExtractError('Pick a logo from Media Library first.')
      return
    }
    setExtractError(null)
    setExtracting(true)
    const colours = await extractColoursFromImage(logoUrl)
    setExtracting(false)
    if (colours) {
      setPrimary(colours.primary)
      setDeep(colours.deep)
      setIce(colours.ice)
      setInk(colours.ink)
    } else {
      setExtractError('Could not extract colours from this logo.')
    }
  }

  function handleRestoreDefaults() {
    setPrimary(DEFAULT_COLOURS.primary)
    setDeep(DEFAULT_COLOURS.deep)
    setIce(DEFAULT_COLOURS.ice)
    setInk(DEFAULT_COLOURS.ink)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl">
      {/* Branding Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-1">Branding</h2>
        <p className="text-xs text-eq-grey mb-4">
          Logo dropdowns show images tagged with the{' '}
          <span className="font-mono font-semibold text-eq-deep">Report Image</span>{' '}
          category in the Media Library. Customer-scoped logos and site
          photos are excluded by design — they live on the relevant
          customer / site, not on the tenant brand. To make an image
          eligible here, add the <em>Report Image</em> tag via Admin → Media Library.
        </p>
        <div className="space-y-4">
          <FormInput
            label="Product Name"
            name="product_name"
            required
            defaultValue={settings.product_name}
            placeholder="e.g. EQ Solves"
          />

          {/* Light-surface logo — single source of truth: Media Library.
              Upload via Admin → Media Library, then pick here. */}
          <MediaPicker
            label="Logo (Light Surface)"
            value={logoUrl || null}
            onChange={(url) => setLogoUrl(url ?? '')}
            category="report_image"
            surface="light"
            previewBackground="light"
            placeholder="Pick your company logo from the Media Library…"
          />
          <p className="text-xs text-eq-grey -mt-2">
            Used in headers, body sections, and email signatures.
            Upload variants via Admin → Media Library.
          </p>

          {/* Dark-surface logo variant */}
          <MediaPicker
            label="Logo on Dark Surfaces"
            value={logoUrlOnDark || null}
            onChange={(url) => setLogoUrlOnDark(url ?? '')}
            category="report_image"
            surface="dark"
            previewBackground="dark"
            placeholder="Select dark-surface logo from Media Library…"
          />
          <p className="text-xs text-eq-grey -mt-2">
            Used on report covers and dark banners. Leave empty to fall back
            to the light logo.
          </p>

          {/* Hidden inputs for form submission */}
          <input type="hidden" name="logo_url" value={logoUrl} />
          <input type="hidden" name="logo_url_on_dark" value={logoUrlOnDark} />

          {/* Extract / Restore actions */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleExtractColours}
              disabled={extracting || !logoUrl}
            >
              <Wand2 className="w-4 h-4 mr-1" />
              {extracting ? 'Extracting…' : 'Extract Colours from Logo'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleRestoreDefaults}
            >
              <RotateCcw className="w-4 h-4 mr-1" />
              Restore Defaults
            </Button>
          </div>
          {extractError && <p className="text-xs text-red-500">{extractError}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Primary Colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="primary_colour"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  className="w-10 h-10 border border-gray-200 rounded cursor-pointer"
                />
                <span className="text-xs text-eq-ink font-mono">{primary}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Deep Colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="deep_colour"
                  value={deep}
                  onChange={(e) => setDeep(e.target.value)}
                  className="w-10 h-10 border border-gray-200 rounded cursor-pointer"
                />
                <span className="text-xs text-eq-ink font-mono">{deep}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Ice Colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="ice_colour"
                  value={ice}
                  onChange={(e) => setIce(e.target.value)}
                  className="w-10 h-10 border border-gray-200 rounded cursor-pointer"
                />
                <span className="text-xs text-eq-ink font-mono">{ice}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Ink Colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="ink_colour"
                  value={ink}
                  onChange={(e) => setInk(e.target.value)}
                  className="w-10 h-10 border border-gray-200 rounded cursor-pointer"
                />
                <span className="text-xs text-eq-ink font-mono">{ink}</span>
              </div>
            </div>
          </div>

          {/* Colour preview strip */}
          <div>
            <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-2">Preview</p>
            <div className="flex rounded-md overflow-hidden h-8">
              <div className="flex-1" style={{ backgroundColor: primary }} />
              <div className="flex-1" style={{ backgroundColor: deep }} />
              <div className="flex-1" style={{ backgroundColor: ice }} />
              <div className="flex-1" style={{ backgroundColor: ink }} />
            </div>
            <div className="flex text-[10px] text-eq-grey mt-1">
              <span className="flex-1">Primary</span>
              <span className="flex-1">Deep</span>
              <span className="flex-1">Ice</span>
              <span className="flex-1">Ink</span>
            </div>
          </div>
        </div>
      </div>

      {/* Contact Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-4">Contact</h2>
        <FormInput
          label="Support Email"
          name="support_email"
          type="email"
          defaultValue={settings.support_email ?? ''}
          placeholder="support@company.com"
        />
      </div>

      {/* Module toggles — sidebar visibility for non-core modules */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-1">Modules</h2>
        <p className="text-xs text-eq-grey mb-4">
          Show or hide non-core sidebar entries for your team. The core platform
          (Dashboard, Customers, Sites, Contacts, Assets, Maintenance Plans, Maintenance,
          Reports) is always on. URLs stay reachable when a module is off — only
          the sidebar entry is hidden.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md border border-gray-200 hover:bg-eq-ice/30 transition-colors">
            <input
              type="checkbox"
              name="calendar_enabled"
              checked={calendarEnabled}
              onChange={(e) => setCalendarEnabled(e.target.checked)}
              className="mt-0.5 w-4 h-4 cursor-pointer"
            />
            <div className="flex-1">
              <p className="text-sm font-semibold text-eq-ink">Calendar</p>
              <p className="text-xs text-eq-grey mt-1">PM calendar — list, monthly grid, and quarterly view of upcoming maintenance.</p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md border border-gray-200 hover:bg-eq-ice/30 transition-colors">
            <input
              type="checkbox"
              name="defects_enabled"
              checked={defectsEnabled}
              onChange={(e) => setDefectsEnabled(e.target.checked)}
              className="mt-0.5 w-4 h-4 cursor-pointer"
            />
            <div className="flex-1">
              <p className="text-sm font-semibold text-eq-ink">Defects</p>
              <p className="text-xs text-eq-grey mt-1">Defects register — track open / resolved defects raised on maintenance visits.</p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md border border-gray-200 hover:bg-eq-ice/30 transition-colors">
            <input
              type="checkbox"
              name="analytics_enabled"
              checked={analyticsEnabled}
              onChange={(e) => setAnalyticsEnabled(e.target.checked)}
              className="mt-0.5 w-4 h-4 cursor-pointer"
            />
            <div className="flex-1">
              <p className="text-sm font-semibold text-eq-ink">Analytics</p>
              <p className="text-xs text-eq-grey mt-1">Cross-cutting analytics dashboard — trends, throughput, completion rates.</p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md border border-gray-200 hover:bg-eq-ice/30 transition-colors">
            <input
              type="checkbox"
              name="contract_scope_enabled"
              checked={contractScopeEnabled}
              onChange={(e) => setContractScopeEnabled(e.target.checked)}
              className="mt-0.5 w-4 h-4 cursor-pointer"
            />
            <div className="flex-1">
              <p className="text-sm font-semibold text-eq-ink">Contract Scope</p>
              <p className="text-xs text-eq-grey mt-1">Per-customer scope register — included / excluded items by FY.</p>
            </div>
          </label>
        </div>
      </div>

      {/* Commercial features toggle */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-bold text-eq-ink mb-1">Commercial features</h2>
        <p className="text-xs text-eq-grey mb-4">
          Everyone gets the basics: scope info on each check, automatic
          gap-fill, and a warning when work is out of scope. The commercial
          pack below is optional — useful if you run formal contract
          administration; overkill for small contractors.
        </p>
        <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md border border-gray-200 hover:bg-eq-ice/30 transition-colors">
          <input
            type="checkbox"
            name="commercial_features_enabled"
            checked={commercialFeaturesEnabled}
            onChange={(e) => setCommercialFeaturesEnabled(e.target.checked)}
            className="mt-0.5 w-4 h-4 cursor-pointer"
          />
          <div className="flex-1">
            <p className="text-sm font-semibold text-eq-ink">
              Turn on the commercial pack
            </p>
            <ul className="text-xs text-eq-grey mt-1 space-y-0.5 list-disc list-inside">
              <li>Lock contract scope by financial year and track changes</li>
              <li>Capture out-of-scope work as variations</li>
              <li>Show dollar risk on the dashboard</li>
              <li>Generate a renewal pack at year-end</li>
              <li>Customer-facing scope statement PDF</li>
            </ul>
            <p className="text-[11px] text-eq-grey mt-2">
              Currently: <strong>{commercialFeaturesEnabled ? 'on' : 'off'}</strong>
            </p>
          </div>
        </label>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">Settings saved. Reload to see colour changes everywhere.</p>}

      <Button type="submit" loading={loading}>
        Save Settings
      </Button>
    </form>
  )
}
