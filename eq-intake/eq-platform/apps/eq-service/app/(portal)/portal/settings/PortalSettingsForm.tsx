'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Mail, Calendar, AlertTriangle, FileSignature, FileText, CheckCircle2 } from 'lucide-react'
import { updatePortalNotificationPrefsAction } from './actions'

interface InitialPrefs {
  receive_monthly_summary: boolean
  receive_upcoming_visit: boolean
  receive_critical_defect: boolean
  receive_variation_approved: boolean
  receive_report_delivery: boolean
  monthly_summary_day: number
  consent_given_at: string | null
}

interface Props {
  initial: InitialPrefs
}

export function PortalSettingsForm({ initial }: Props) {
  const [prefs, setPrefs] = useState<InitialPrefs>(initial)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function set<K extends keyof InitialPrefs>(key: K, value: InitialPrefs[K]) {
    setPrefs(p => ({ ...p, [key]: value }))
  }

  async function handleSave() {
    setBusy(true)
    setMessage(null)
    const result = await updatePortalNotificationPrefsAction({
      receive_monthly_summary: prefs.receive_monthly_summary,
      receive_upcoming_visit: prefs.receive_upcoming_visit,
      receive_critical_defect: prefs.receive_critical_defect,
      receive_variation_approved: prefs.receive_variation_approved,
      receive_report_delivery: prefs.receive_report_delivery,
      monthly_summary_day: prefs.monthly_summary_day,
    })
    setBusy(false)
    if (result.success) {
      setMessage({ kind: 'ok', text: 'Preferences saved.' })
    } else {
      setMessage({ kind: 'err', text: result.error ?? 'Could not save preferences.' })
    }
  }

  const consentLabel = prefs.consent_given_at
    ? `Consent recorded ${new Date(prefs.consent_given_at).toLocaleDateString('en-AU')}`
    : 'No consent timestamp yet — saving any toggle on records consent now.'

  return (
    <Card>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-eq-ink">Email preferences</h2>
            <p className="text-sm text-eq-grey mt-1">
              Choose which updates you'd like to receive about your account. You can change this any time.
            </p>
          </div>
          <span className="text-[10px] text-eq-grey shrink-0 mt-1">{consentLabel}</span>
        </div>

        <div className="space-y-2">
          <Toggle
            label="Monthly summary"
            description="A 1st-of-month email with KPIs, completed visits, open defects, and any approved variations."
            icon={<Calendar className="w-4 h-4 text-eq-deep" />}
            checked={prefs.receive_monthly_summary}
            onChange={v => set('receive_monthly_summary', v)}
          />
          <Toggle
            label="Upcoming visit notice"
            description="An email 7 days before any scheduled maintenance visit at one of your sites."
            icon={<Calendar className="w-4 h-4 text-eq-deep" />}
            checked={prefs.receive_upcoming_visit}
            onChange={v => set('receive_upcoming_visit', v)}
          />
          <Toggle
            label="Critical defect alerts"
            description="An email when a critical-severity defect is raised on one of your assets."
            icon={<AlertTriangle className="w-4 h-4 text-amber-600" />}
            checked={prefs.receive_critical_defect}
            onChange={v => set('receive_critical_defect', v)}
          />
          <Toggle
            label="Variation approved"
            description="An email when a contract variation against your account is approved."
            icon={<FileSignature className="w-4 h-4 text-eq-deep" />}
            checked={prefs.receive_variation_approved}
            onChange={v => set('receive_variation_approved', v)}
          />
          <Toggle
            label="Report deliveries"
            description="An email each time a maintenance report is delivered for your records."
            icon={<FileText className="w-4 h-4 text-eq-deep" />}
            checked={prefs.receive_report_delivery}
            onChange={v => set('receive_report_delivery', v)}
          />
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Monthly summary day:</label>
          <input
            type="number"
            min={1}
            max={28}
            value={prefs.monthly_summary_day}
            onChange={e => set('monthly_summary_day', Math.max(1, Math.min(28, Number(e.target.value) || 1)))}
            className="h-9 w-20 px-2 border border-gray-200 rounded text-sm"
          />
          <span className="text-xs text-eq-grey">of each month, 7am AEST</span>
        </div>

        {message && (
          <p className={message.kind === 'ok' ? 'text-sm text-green-700 flex items-center gap-1.5' : 'text-sm text-red-600'}>
            {message.kind === 'ok' && <CheckCircle2 className="w-4 h-4" />}
            {message.text}
          </p>
        )}

        <div>
          <Button onClick={handleSave} loading={busy}>
            <Mail className="w-4 h-4 mr-2" /> Save preferences
          </Button>
        </div>
      </div>
    </Card>
  )
}

function Toggle({
  label, description, icon, checked, onChange,
}: {
  label: string
  description: string
  icon: React.ReactNode
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5"
      />
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-eq-ink">{label}</p>
        <p className="text-xs text-eq-grey mt-0.5">{description}</p>
      </div>
    </label>
  )
}
