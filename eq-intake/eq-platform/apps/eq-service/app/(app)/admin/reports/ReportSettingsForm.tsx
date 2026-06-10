'use client'

import { useState } from 'react'
import { FormInput } from '@/components/ui/FormInput'
import { Button } from '@/components/ui/Button'
import { MediaPicker } from '@/components/ui/MediaPicker'
import { updateReportSettingsAction } from './actions'
import type { TenantSettings } from '@/lib/types'
import { Eye, EyeOff, Plus, Trash2, GripVertical, Image, FileText } from 'lucide-react'

interface Props {
  settings: TenantSettings
}

interface ReportSection {
  label: string
  key: 'cover' | 'overview' | 'contents' | 'summary' | 'signoff'
  enabled: boolean
}

export function ReportSettingsForm({ settings }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  // Section toggles. Site Overview, Customer Logo and Site Photos used to
  // be configurable here but were removed 26-Apr-2026 (audit items 6-8) —
  // they were either dead settings (site_photos was read by no generator)
  // or only consumed by one of six generators (site_overview, customer_logo)
  // which made the form dishonest about what it controlled. Behaviour is
  // now baked in: site overview always shown, customer logo always shown
  // when present, site photo block dropped entirely.
  const [showCover, setShowCover] = useState(settings.report_show_cover_page ?? true)
  const [showContents, setShowContents] = useState(settings.report_show_contents ?? true)
  const [showSummary, setShowSummary] = useState(settings.report_show_executive_summary ?? true)
  const [showSignOff, setShowSignOff] = useState(settings.report_show_sign_off ?? true)

  // Logo
  const [logoUrl, setLogoUrl] = useState(settings.report_logo_url ?? '')
  const [logoUrlOnDark, setLogoUrlOnDark] = useState(
    (settings as unknown as { report_logo_url_on_dark?: string | null }).report_logo_url_on_dark ?? '',
  )
  const [complexity, setComplexity] = useState<'summary' | 'standard' | 'detailed'>(settings.report_complexity ?? 'standard')

  // Custom text
  const [headerText, setHeaderText] = useState(settings.report_header_text ?? '')
  const [footerText, setFooterText] = useState(settings.report_footer_text ?? '')

  // Company details
  const [companyName, setCompanyName] = useState(settings.report_company_name ?? '')
  const [companyAddress, setCompanyAddress] = useState(settings.report_company_address ?? '')
  const [companyAbn, setCompanyAbn] = useState(settings.report_company_abn ?? '')
  const [companyPhone, setCompanyPhone] = useState(settings.report_company_phone ?? '')

  // Report sections list. Site Overview is always on (was a dead toggle).
  const reportSections: ReportSection[] = [
    { label: 'Cover Page', key: 'cover', enabled: showCover },
    { label: 'Site Overview', key: 'overview', enabled: true },
    { label: 'Table of Contents', key: 'contents', enabled: showContents },
    { label: 'Executive Summary', key: 'summary', enabled: showSummary },
    { label: 'Asset Details', key: 'overview', enabled: true }, // Always shown
    { label: 'Sign-off Page', key: 'signoff', enabled: showSignOff },
  ]

  // Sign-off fields
  const [signOffFields, setSignOffFields] = useState<string[]>(
    Array.isArray(settings.report_sign_off_fields) ? settings.report_sign_off_fields : ['Technician Signature', 'Supervisor Signature']
  )

  function addSignOffField() {
    setSignOffFields([...signOffFields, ''])
  }

  function removeSignOffField(idx: number) {
    setSignOffFields(signOffFields.filter((_, i) => i !== idx))
  }

  function updateSignOffField(idx: number, value: string) {
    const updated = [...signOffFields]
    updated[idx] = value
    setSignOffFields(updated)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const result = await updateReportSettingsAction({
      report_show_cover_page: showCover,
      report_show_contents: showContents,
      report_show_executive_summary: showSummary,
      report_show_sign_off: showSignOff,
      report_header_text: headerText || null,
      report_footer_text: footerText || null,
      report_company_name: companyName || null,
      report_company_address: companyAddress || null,
      report_company_abn: companyAbn || null,
      report_company_phone: companyPhone || null,
      report_sign_off_fields: signOffFields.filter(f => f.trim().length > 0),
      report_logo_url: logoUrl || null,
      report_logo_url_on_dark: logoUrlOnDark || null,
      report_complexity: complexity,
    })

    setLoading(false)
    if (result.success) {
      setSuccess(true)
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  const sections = [
    { label: 'Cover Page', description: 'Title page with report name, site info, and logo', value: showCover, toggle: setShowCover },
    { label: 'Contents Page', description: 'Table of contents with links to each asset section', value: showContents, toggle: setShowContents },
    { label: 'Executive Summary', description: 'KPI dashboard with pass rates, task breakdown, key findings', value: showSummary, toggle: setShowSummary },
    { label: 'Sign-off Page', description: 'Approval table with signature lines', value: showSignOff, toggle: setShowSignOff },
  ]

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Left Column - Settings */}
      <div className="lg:col-span-2 space-y-8">
        {/* Section Toggles */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm font-bold text-eq-ink mb-1">Report Sections</h2>
          <p className="text-xs text-eq-grey mb-4">Choose which sections to include in generated reports. Asset detail sections are always included.</p>
          <div className="space-y-3">
            {sections.map(s => (
              <button
                key={s.label}
                type="button"
                onClick={() => s.toggle(!s.value)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors text-left hover:bg-gray-50"
                style={{ borderColor: s.value ? 'var(--eq-sky, #3DA8D8)' : '#e5e7eb' }}
              >
                <div>
                  <p className="text-sm font-medium text-eq-ink">{s.label}</p>
                  <p className="text-xs text-eq-grey">{s.description}</p>
                </div>
                {s.value ? (
                  <Eye className="w-5 h-5 text-eq-sky shrink-0" />
                ) : (
                  <EyeOff className="w-5 h-5 text-gray-300 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Company Details */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm font-bold text-eq-ink mb-1">Company Details</h2>
          <p className="text-xs text-eq-grey mb-4">Shown on the cover page and report headers. Logo and brand colours are inherited from Tenant Settings.</p>
          <div className="space-y-4">
            <FormInput
              label="Company Name"
              name="report_company_name"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder="e.g. SKS Technologies"
            />
            <FormInput
              label="Address"
              name="report_company_address"
              value={companyAddress}
              onChange={e => setCompanyAddress(e.target.value)}
              placeholder="e.g. 123 Industrial Ave, Sydney NSW 2000"
            />
            <div className="grid grid-cols-2 gap-4">
              <FormInput
                label="ABN"
                name="report_company_abn"
                value={companyAbn}
                onChange={e => setCompanyAbn(e.target.value)}
                placeholder="e.g. 12 345 678 901"
              />
              <FormInput
                label="Phone"
                name="report_company_phone"
                value={companyPhone}
                onChange={e => setCompanyPhone(e.target.value)}
                placeholder="e.g. +61 2 9876 5432"
              />
            </div>
          </div>
        </div>

        {/* Report Complexity */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm font-bold text-eq-ink mb-1">Default Report Style</h2>
          <p className="text-xs text-eq-grey mb-4">Sets the default detail level for all reports. Users can override this when generating individual reports.</p>
          <div className="grid grid-cols-3 gap-3">
            {([
              { value: 'summary' as const, label: 'Summary', desc: 'KPIs, pass/fail counts, and high-level overview only' },
              { value: 'standard' as const, label: 'Standard', desc: 'Asset details, test results, and recommendations' },
              { value: 'detailed' as const, label: 'Detailed', desc: 'Full data including all readings, photos, and commentary' },
            ]).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setComplexity(opt.value)}
                className="flex flex-col items-start p-4 rounded-lg border transition-colors text-left hover:bg-gray-50"
                style={{ borderColor: complexity === opt.value ? 'var(--eq-sky, #3DA8D8)' : '#e5e7eb' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <FileText className={`w-4 h-4 ${complexity === opt.value ? 'text-eq-sky' : 'text-gray-300'}`} />
                  <p className="text-sm font-medium text-eq-ink">{opt.label}</p>
                </div>
                <p className="text-xs text-eq-grey">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Logos & Photos */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm font-bold text-eq-ink mb-1">Logos & Photos</h2>
          <p className="text-xs text-eq-grey mb-4">Configure logo display and site photography for report cover pages.</p>
          <div className="space-y-4">
            <div>
              <MediaPicker
                label="Report Logo — Light Surface"
                value={logoUrl || null}
                onChange={(url) => setLogoUrl(url ?? '')}
                category="report_image"
                surface="light"
                previewBackground="light"
                placeholder="Select light-surface logo…"
              />
              <p className="text-xs text-eq-grey mt-1">Used on report bodies and light headers. Falls back to tenant logo if empty.</p>
            </div>
            <div>
              <MediaPicker
                label="Report Logo — Dark Surface"
                value={logoUrlOnDark || null}
                onChange={(url) => setLogoUrlOnDark(url ?? '')}
                category="report_image"
                surface="dark"
                previewBackground="dark"
                placeholder="Select dark-surface logo…"
              />
              <p className="text-xs text-eq-grey mt-1">Used on report cover pages. Falls back to light logo if empty.</p>
            </div>
            {/* Customer Logo + Site Photos toggles removed 26-Apr-2026
                (audit items 7, 8 + 6). Customer logo always shown when
                present; site photos block was a dead setting (read by no
                generator) so it's gone entirely. */}
          </div>
        </div>

        {/* Header / Footer */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm font-bold text-eq-ink mb-1">Header & Footer Text</h2>
          <p className="text-xs text-eq-grey mb-4">Custom text shown in the report header and footer on every page. Leave blank to use defaults.</p>
          <div className="space-y-4">
            <FormInput
              label="Header Text"
              name="report_header_text"
              value={headerText}
              onChange={e => setHeaderText(e.target.value)}
              placeholder="e.g. CONFIDENTIAL — SKS Technologies Pty Ltd"
            />
            <FormInput
              label="Footer Text"
              name="report_footer_text"
              value={footerText}
              onChange={e => setFooterText(e.target.value)}
              placeholder="e.g. © 2026 SKS Technologies. All rights reserved."
            />
          </div>
        </div>

        {/* Sign-off Fields */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm font-bold text-eq-ink mb-1">Sign-off Fields</h2>
          <p className="text-xs text-eq-grey mb-4">Customise the signature lines on the sign-off page. Add or remove as needed.</p>
          <div className="space-y-2">
            {signOffFields.map((field, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                <input
                  type="text"
                  value={field}
                  onChange={e => updateSignOffField(idx, e.target.value)}
                  placeholder="e.g. Client Representative"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
                />
                {signOffFields.length > 1 && (
                  <button type="button" onClick={() => removeSignOffField(idx)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addSignOffField}
              className="flex items-center gap-1 text-xs font-medium text-eq-sky hover:text-eq-deep transition-colors mt-2"
            >
              <Plus className="w-4 h-4" /> Add field
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Report settings saved.</p>}

        <Button type="submit" loading={loading}>
          Save Report Settings
        </Button>
      </div>

      {/* Right Column - Live Preview */}
      <div className="lg:sticky lg:top-6 lg:h-fit">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h2 className="text-sm font-bold text-eq-ink mb-4">Report Preview</h2>
          <p className="text-xs text-eq-grey mb-4">Visual preview of your report layout</p>

          {/* A4-ratio preview container */}
          <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200" style={{ aspectRatio: '210/297' }}>
            <div className="p-3 h-full overflow-y-auto space-y-2 text-[10px]">
              {/* Report style indicator */}
              <div className="bg-eq-ice/50 border border-eq-sky/20 p-2 rounded text-center">
                <p className="text-[9px] text-eq-deep font-semibold uppercase">{complexity} report</p>
              </div>

              {/* Cover Page */}
              {showCover && (
                <div className="bg-white border border-gray-300 p-3 rounded min-h-[60px] flex flex-col items-center justify-center text-center">
                  <p className="font-bold text-gray-800">COVER PAGE</p>
                  <p className="text-gray-500 text-[9px] mt-1">{logoUrl ? '🏢 Company logo' : ''}{logoUrl ? ' + ' : ''}🏪 Customer logo</p>
                  {companyName && <p className="text-gray-600 text-[9px] mt-1">{companyName}</p>}
                  {companyAddress && <p className="text-gray-500 text-[9px]">{companyAddress.substring(0, 30)}...</p>}
                </div>
              )}

              {/* Site Overview — always rendered (was a dead toggle) */}
              <div className="bg-white border border-gray-300 p-2 rounded">
                <p className="font-bold text-gray-800">SITE OVERVIEW</p>
                <div className="text-gray-600 text-[9px] mt-1 space-y-0.5">
                  <p>• Site details and dates</p>
                  <p>• Outstanding counts</p>
                </div>
              </div>

              {/* Table of Contents */}
              {showContents && (
                <div className="bg-white border border-gray-300 p-2 rounded">
                  <p className="font-bold text-gray-800">TABLE OF CONTENTS</p>
                  <div className="text-gray-600 text-[9px] mt-1 space-y-0.5">
                    <p>1. Cover Page</p>
                    <p>2. Site Overview</p>
                    <p>3. Executive Summary</p>
                  </div>
                </div>
              )}

              {/* Executive Summary */}
              {showSummary && (
                <div className="bg-white border border-gray-300 p-2 rounded">
                  <p className="font-bold text-gray-800">EXECUTIVE SUMMARY</p>
                  <div className="text-gray-600 text-[9px] mt-1 space-y-0.5">
                    <p>• KPI dashboard</p>
                    <p>• Pass rates chart</p>
                    <p>• Key findings</p>
                  </div>
                </div>
              )}

              {/* Asset Details - Always shown */}
              <div className="bg-white border border-blue-300 p-2 rounded border-dashed">
                <p className="font-bold text-blue-800">ASSET DETAILS</p>
                <p className="text-blue-600 text-[9px] mt-1">Always included</p>
              </div>

              {/* Sign-off Page */}
              {showSignOff && (
                <div className="bg-white border border-gray-300 p-2 rounded">
                  <p className="font-bold text-gray-800">SIGN-OFF PAGE</p>
                  <div className="text-gray-600 text-[9px] mt-1 space-y-1">
                    {signOffFields.slice(0, 2).map((field, idx) => (
                      <p key={idx}>_____ {field}</p>
                    ))}
                    {signOffFields.length > 2 && <p className="text-gray-500">+ {signOffFields.length - 2} more fields</p>}
                  </div>
                </div>
              )}

              {/* Hidden sections indicator */}
              <div className="text-gray-400 text-[8px] mt-2">
                {!showCover && <p>✓ Cover Page (hidden)</p>}
                {!showContents && <p>✓ Table of Contents (hidden)</p>}
                {!showSummary && <p>✓ Executive Summary (hidden)</p>}
                {!showSignOff && <p>✓ Sign-off Page (hidden)</p>}
              </div>
            </div>
          </div>

          <p className="text-xs text-eq-grey mt-3">Updates in real-time as you toggle sections</p>
        </div>
      </div>
    </form>
  )
}
