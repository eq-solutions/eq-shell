'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { updateNotificationPreferencesAction } from './actions'
import { Bell, Mail, Calendar, Clock } from 'lucide-react'

export interface NotificationPreferencesValues {
  digest_time: string                    // 'HH:MM'
  digest_days: string[]                  // ['mon','tue',...]
  pre_due_reminder_days: number[]        // [14,7,1]
  event_type_opt_outs: string[]          // ['defect_raised',...]
  bell_enabled: boolean
  email_enabled: boolean
  digest_enabled: boolean
  timezone: string
}

interface Props {
  initial: NotificationPreferencesValues
  /** Whether the initial values came from a row the user owns (vs the
   * tenant default fallback). Drives the "Reset to default" affordance. */
  hasOwnRow: boolean
}

const DAYS = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
]

const EVENT_TYPES = [
  { value: 'check_assigned', label: 'Check assigned to me' },
  { value: 'check_due_soon', label: 'Pre-due reminders (14d / 7d / 1d)' },
  { value: 'check_overdue', label: 'Check overdue' },
  { value: 'check_completed', label: 'Check completed' },
  { value: 'defect_raised', label: 'Defect raised' },
]

const COMMON_TIMEZONES = [
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Hobart',
  'Australia/Darwin',
]

export function NotificationPreferencesForm({ initial, hasOwnRow }: Props) {
  const [digestTime, setDigestTime] = useState(initial.digest_time.slice(0, 5))
  const [digestDays, setDigestDays] = useState<string[]>(initial.digest_days)
  const [reminderDaysStr, setReminderDaysStr] = useState(initial.pre_due_reminder_days.join(', '))
  const [optOuts, setOptOuts] = useState<string[]>(initial.event_type_opt_outs)
  const [bellEnabled, setBellEnabled] = useState(initial.bell_enabled)
  const [emailEnabled, setEmailEnabled] = useState(initial.email_enabled)
  const [digestEnabled, setDigestEnabled] = useState(initial.digest_enabled)
  const [timezone, setTimezone] = useState(initial.timezone)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function toggleDay(d: string) {
    setDigestDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  function toggleOptOut(t: string) {
    setOptOuts(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const fd = new FormData()
    fd.set('digest_time', digestTime)
    fd.set('digest_days', digestDays.join(','))
    fd.set('pre_due_reminder_days', reminderDaysStr)
    fd.set('event_type_opt_outs', optOuts.join(','))
    fd.set('bell_enabled', bellEnabled ? 'true' : 'false')
    fd.set('email_enabled', emailEnabled ? 'true' : 'false')
    fd.set('digest_enabled', digestEnabled ? 'true' : 'false')
    fd.set('timezone', timezone)
    const result = await updateNotificationPreferencesAction(fd)
    setLoading(false)
    if (result.success) {
      setMessage({ kind: 'ok', text: 'Preferences saved.' })
    } else {
      setMessage({ kind: 'err', text: result.error ?? 'Could not save preferences.' })
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-6 p-1">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-eq-deep" />
          <h2 className="text-sm font-bold text-eq-ink">Notification Preferences</h2>
          {!hasOwnRow && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-eq-grey">
              Using the workspace default — saving will create your own settings
            </span>
          )}
        </div>

        {/* Master switches */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Channels</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
              <input type="checkbox" checked={bellEnabled} onChange={e => setBellEnabled(e.target.checked)} />
              <Bell className="w-4 h-4 text-eq-deep" />
              <span className="text-sm">Bell inside the app</span>
            </label>
            <label className="flex items-center gap-2 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
              <input type="checkbox" checked={emailEnabled} onChange={e => setEmailEnabled(e.target.checked)} />
              <Mail className="w-4 h-4 text-eq-deep" />
              <span className="text-sm">Email</span>
            </label>
            <label className="flex items-center gap-2 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
              <input type="checkbox" checked={digestEnabled} onChange={e => setDigestEnabled(e.target.checked)} />
              <Calendar className="w-4 h-4 text-eq-deep" />
              <span className="text-sm">Daily summary email</span>
            </label>
          </div>
        </div>

        {/* Daily summary delivery time + days (Outlook-style) */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">When my daily summary arrives</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormInput
              label="Delivery time"
              name="digest_time"
              type="time"
              value={digestTime}
              onChange={e => setDigestTime(e.target.value)}
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Timezone</label>
              <select
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
              >
                {COMMON_TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {DAYS.map(d => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={
                  'px-3 py-1.5 text-xs rounded-full border transition-colors ' +
                  (digestDays.includes(d.value)
                    ? 'bg-eq-sky text-white border-eq-sky'
                    : 'bg-white text-eq-grey border-gray-200 hover:border-eq-sky/40')
                }
              >
                {d.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-eq-grey">Summary lands within 15 minutes of your chosen time.</p>
        </div>

        {/* Heads-up reminders */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-eq-deep" />
            <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Heads-up before due date</label>
          </div>
          <FormInput
            label="Days before due (comma-separated)"
            name="pre_due_reminder_days"
            value={reminderDaysStr}
            onChange={e => setReminderDaysStr(e.target.value)}
            placeholder="14, 7, 1"
          />
          <p className="text-[11px] text-eq-grey">Default 14, 7, 1. Use <code>30, 14, 7, 1</code> for a longer lead-time, or leave blank to turn heads-up reminders off.</p>
        </div>

        {/* Turn specific notifications off */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Turn specific notifications off</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {EVENT_TYPES.map(t => (
              <label key={t.value} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={optOuts.includes(t.value)}
                  onChange={() => toggleOptOut(t.value)}
                />
                <span className="text-sm">{t.label}</span>
                {optOuts.includes(t.value) && (
                  <span className="ml-auto text-[10px] text-amber-600 font-semibold">off</span>
                )}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-eq-grey">Tick to turn that notification off. The bell stays quiet too, and we won&apos;t email you about it.</p>
        </div>

        {message && (
          <p className={message.kind === 'ok' ? 'text-sm text-green-700' : 'text-sm text-red-600'}>
            {message.text}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" loading={loading}>Save preferences</Button>
        </div>
      </form>
    </Card>
  )
}
