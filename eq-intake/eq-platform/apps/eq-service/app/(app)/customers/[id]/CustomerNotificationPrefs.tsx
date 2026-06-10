'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { upsertCustomerNotificationPrefsAction } from './contact-actions'
import { Mail, Calendar, AlertTriangle, FileSignature, FileText } from 'lucide-react'

export interface CustomerContactWithPrefs {
  id: string
  name: string | null
  email: string | null
  prefs: {
    receive_monthly_summary: boolean
    receive_upcoming_visit: boolean
    receive_critical_defect: boolean
    receive_variation_approved: boolean
    receive_report_delivery: boolean
    monthly_summary_day: number
    consent_given_at: string | null
  } | null
}

interface Props {
  customerId: string
  contacts: CustomerContactWithPrefs[]
  /** Tenant has commercial_features_enabled — gate the whole block. */
  commercialEnabled: boolean
  /** Caller is admin or supervisor — write affordances enabled. */
  canWrite: boolean
}

const DEFAULT_PREFS = {
  receive_monthly_summary: true,
  receive_upcoming_visit: true,
  receive_critical_defect: false,
  receive_variation_approved: false,
  receive_report_delivery: true,
  monthly_summary_day: 1,
  consent_given_at: null,
}

export function CustomerNotificationPrefs({ customerId, contacts, commercialEnabled, canWrite }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Local optimistic state — keyed by contact.id.
  const [local, setLocal] = useState<Record<string, CustomerContactWithPrefs['prefs']>>(() => {
    const out: Record<string, CustomerContactWithPrefs['prefs']> = {}
    for (const c of contacts) out[c.id] = c.prefs ?? { ...DEFAULT_PREFS }
    return out
  })

  if (!commercialEnabled) {
    return (
      <Card>
        <div className="px-4 py-3 flex items-start gap-3">
          <Mail className="w-4 h-4 text-eq-grey shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-eq-deep">Customer Email Preferences</h3>
            <p className="text-xs text-eq-grey mt-1">
              Customer-facing emails (monthly summaries, upcoming-visit notices, defect alerts) are part of the commercial-tier feature set. Switch on in Admin → Settings to enable.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  if (contacts.length === 0) {
    return (
      <Card>
        <div className="px-4 py-3">
          <h3 className="text-sm font-bold text-eq-deep">Customer Email Preferences</h3>
          <p className="text-xs text-eq-grey mt-1">Add a contact above to set up customer-facing email preferences.</p>
        </div>
      </Card>
    )
  }

  function setField<K extends keyof NonNullable<CustomerContactWithPrefs['prefs']>>(
    contactId: string,
    key: K,
    value: NonNullable<CustomerContactWithPrefs['prefs']>[K],
  ) {
    setLocal(prev => ({
      ...prev,
      [contactId]: { ...(prev[contactId] ?? DEFAULT_PREFS), [key]: value },
    }))
  }

  async function save(contactId: string) {
    setError(null)
    setBusyId(contactId)
    const p = local[contactId] ?? DEFAULT_PREFS
    const result = await upsertCustomerNotificationPrefsAction(customerId, contactId, {
      receive_monthly_summary: p.receive_monthly_summary,
      receive_upcoming_visit: p.receive_upcoming_visit,
      receive_critical_defect: p.receive_critical_defect,
      receive_variation_approved: p.receive_variation_approved,
      receive_report_delivery: p.receive_report_delivery,
      monthly_summary_day: p.monthly_summary_day,
    })
    setBusyId(null)
    if (!result.success) setError(result.error ?? 'Could not save preferences.')
  }

  return (
    <Card>
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Mail className="w-4 h-4 text-eq-deep" />
          <h3 className="text-sm font-bold text-eq-deep">Customer Email Preferences</h3>
          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-eq-ice text-eq-deep">Commercial tier</span>
        </div>
        <p className="text-xs text-eq-grey mb-3">
          Per-contact opt-in for the customer-facing emails the cron sends. Toggle the categories the customer agreed to receive.
        </p>

        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

        <div className="space-y-3">
          {contacts.map(c => {
            const p = local[c.id] ?? DEFAULT_PREFS
            const consentLabel = p.consent_given_at
              ? `Consent recorded ${new Date(p.consent_given_at).toLocaleDateString('en-AU')}`
              : 'No consent timestamp yet'
            return (
              <div key={c.id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-eq-ink truncate">{c.name ?? '(unnamed)'}</p>
                    <p className="text-xs text-eq-grey truncate">{c.email ?? 'no email'}</p>
                  </div>
                  <span className="text-[10px] text-eq-grey">{consentLabel}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <Toggle
                    label="Monthly summary"
                    icon={<Calendar className="w-3.5 h-3.5" />}
                    checked={p.receive_monthly_summary}
                    onChange={v => setField(c.id, 'receive_monthly_summary', v)}
                    disabled={!canWrite || !c.email}
                  />
                  <Toggle
                    label="Upcoming visit (7d before)"
                    icon={<Calendar className="w-3.5 h-3.5" />}
                    checked={p.receive_upcoming_visit}
                    onChange={v => setField(c.id, 'receive_upcoming_visit', v)}
                    disabled={!canWrite || !c.email}
                  />
                  <Toggle
                    label="Critical defect alerts"
                    icon={<AlertTriangle className="w-3.5 h-3.5" />}
                    checked={p.receive_critical_defect}
                    onChange={v => setField(c.id, 'receive_critical_defect', v)}
                    disabled={!canWrite || !c.email}
                  />
                  <Toggle
                    label="Variation approved"
                    icon={<FileSignature className="w-3.5 h-3.5" />}
                    checked={p.receive_variation_approved}
                    onChange={v => setField(c.id, 'receive_variation_approved', v)}
                    disabled={!canWrite || !c.email}
                  />
                  <Toggle
                    label="Report deliveries"
                    icon={<FileText className="w-3.5 h-3.5" />}
                    checked={p.receive_report_delivery}
                    onChange={v => setField(c.id, 'receive_report_delivery', v)}
                    disabled={!canWrite || !c.email}
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-eq-grey shrink-0">Monthly summary day:</label>
                    <input
                      type="number"
                      min={1}
                      max={28}
                      value={p.monthly_summary_day}
                      onChange={e => setField(c.id, 'monthly_summary_day', Math.max(1, Math.min(28, Number(e.target.value) || 1)))}
                      disabled={!canWrite}
                      className="h-8 w-16 px-2 border border-gray-200 rounded text-sm"
                    />
                  </div>
                </div>
                {canWrite && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => save(c.id)}
                      loading={busyId === c.id}
                      disabled={!c.email}
                    >
                      Save preferences
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

function Toggle({
  label, icon, checked, onChange, disabled,
}: {
  label: string
  icon: React.ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={
      'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-sm ' +
      (disabled ? 'border-gray-100 bg-gray-50 text-eq-grey cursor-not-allowed' :
        checked ? 'border-eq-sky/40 bg-eq-ice/40 text-eq-deep cursor-pointer' :
          'border-gray-200 bg-white text-eq-ink cursor-pointer hover:border-eq-sky/40')
    }>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        className="shrink-0"
      />
      {icon}
      <span>{label}</span>
    </label>
  )
}
