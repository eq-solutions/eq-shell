'use client'

/**
 * TidyClient — the interactive "Tidy Our Data" review + approval UI.
 *
 * States:
 *   idle       — initial state, scan button visible
 *   scanning   — scan in progress, spinner shown
 *   reviewing  — report displayed, user selects fixes
 *   committing — commit in progress
 *   done       — commit result shown with rollback info
 *   error      — scan or commit error
 */

import { useState, useTransition } from 'react'
import { runTidyScanAction, commitTidyFixesAction } from './actions'
import type { TidyReport, TidyFix, GapItem, OrphanItem } from '@eq/intake'
import {
  Sparkles, AlertCircle, CheckCircle2, ChevronRight,
  ExternalLink, RefreshCw, ShieldAlert,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENTITY_LABELS: Record<string, string> = {
  customer: 'Customer',
  site:     'Site',
  contact:  'Contact',
  staff:    'Staff',
  licence:  'Licence',
  asset:    'Asset',
}

const FIX_TYPE_LABELS: Record<string, string> = {
  phone:    'Phone',
  au_state: 'State',
  email:    'Email',
  abn:      'ABN',
  date:     'Date',
  string:   'Text',
  boolean:  'Yes/No',
  other:    'Other',
}

const FIX_TYPE_COLOURS: Record<string, string> = {
  phone:    'bg-sky-50 text-sky-700',
  au_state: 'bg-violet-50 text-violet-700',
  email:    'bg-indigo-50 text-indigo-700',
  abn:      'bg-amber-50 text-amber-700',
  date:     'bg-teal-50 text-teal-700',
  string:   'bg-slate-50 text-slate-700',
  boolean:  'bg-green-50 text-green-700',
  other:    'bg-gray-50 text-gray-600',
}

const GAP_TYPE_LABELS: Record<string, string> = {
  required_missing: 'Missing',
  format_invalid:   'Invalid format',
  fk_no_match:      'No match found',
}

const ORPHAN_TYPE_LABELS: Record<string, string> = {
  asset_no_site:      'Asset → no site',
  contact_no_parent:  'Contact → no parent',
  licence_no_staff:   'Licence → no staff',
  site_no_customer:   'Site → no customer',
}

function entityHref(entity: string, rowId: string): string {
  const base: Record<string, string> = {
    customer: '/customers',
    site:     '/sites',
    contact:  '/contacts',
    staff:    '/staff',
    licence:  '/staff',
    asset:    '/assets',
  }
  return `${base[entity] ?? ''}/${rowId}`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryBar({ report }: { report: TidyReport }) {
  const { summary } = report
  const items = [
    { label: 'Auto-fixes ready',  count: summary.auto_fixes_found,   colour: 'text-eq-deep bg-eq-ice' },
    { label: 'Gaps found',        count: summary.gaps_found,          colour: 'text-amber-700 bg-amber-50' },
    { label: 'Orphaned records',  count: summary.orphans_found,       colour: 'text-rose-700 bg-rose-50' },
    { label: 'Needs review',      count: summary.review_flags_found,  colour: 'text-violet-700 bg-violet-50' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map((item) => (
        <div key={item.label} className={`rounded-xl px-4 py-3 ${item.colour}`}>
          <div className="text-2xl font-bold tabular-nums">{item.count}</div>
          <div className="text-xs mt-0.5 opacity-75">{item.label}</div>
        </div>
      ))}
    </div>
  )
}

function AutoFixesTab({
  fixes,
  selected,
  onToggle,
  onSelectAll,
}: {
  fixes:       TidyFix[]
  selected:    Set<string>
  onToggle:    (key: string) => void
  onSelectAll: (all: boolean) => void
}) {
  if (fixes.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-eq-grey">
        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
        All values are already in canonical form — nothing to fix here.
      </div>
    )
  }

  const allSelected = fixes.length > 0 && fixes.every((f) => selected.has(fixKey(f)))

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <label className="flex items-center gap-2 text-sm text-eq-ink cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => onSelectAll(e.target.checked)}
            className="accent-eq-deep"
          />
          Select all {fixes.length} fix{fixes.length === 1 ? '' : 'es'}
        </label>
        <span className="text-xs text-eq-grey">{selected.size} selected</span>
      </div>

      <div className="border border-eq-line rounded-xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-eq-grey border-b border-eq-line bg-eq-ice/40">
              <th className="w-8 py-2.5 pl-4" />
              <th className="py-2.5 pr-3">Entity</th>
              <th className="py-2.5 pr-3">Record</th>
              <th className="py-2.5 pr-3">Field</th>
              <th className="py-2.5 pr-3">Current</th>
              <th className="py-2.5 pr-3">Will become</th>
              <th className="py-2.5 pr-4">Type</th>
            </tr>
          </thead>
          <tbody>
            {fixes.map((fix) => {
              const key = fixKey(fix)
              return (
                <tr
                  key={key}
                  className="border-b border-eq-line/60 last:border-b-0 hover:bg-eq-ice/30 cursor-pointer"
                  onClick={() => onToggle(key)}
                >
                  <td className="pl-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => onToggle(key)}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-eq-deep"
                    />
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="text-[11px] font-medium text-eq-deep">
                      {ENTITY_LABELS[fix.entity] ?? fix.entity}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <a
                      href={entityHref(fix.entity, fix.row_id)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-eq-ink hover:text-eq-deep flex items-center gap-1 w-fit"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {fix.row_label}
                      <ExternalLink className="w-3 h-3 opacity-40" />
                    </a>
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-xs text-eq-grey">{fix.field}</td>
                  <td className="py-2.5 pr-3 text-xs text-rose-600 line-through opacity-70 max-w-[140px] truncate">
                    {fix.old_value || <span className="italic not-italic opacity-40">empty</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-emerald-700 font-medium max-w-[140px] truncate">
                    {fix.new_value}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${FIX_TYPE_COLOURS[fix.fix_type] ?? FIX_TYPE_COLOURS.other}`}>
                      {FIX_TYPE_LABELS[fix.fix_type] ?? fix.fix_type}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GapsTab({ gaps }: { gaps: GapItem[] }) {
  if (gaps.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-eq-grey">
        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
        No gaps found — all required fields are present.
      </div>
    )
  }

  return (
    <div className="border border-eq-line rounded-xl overflow-hidden">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-eq-grey border-b border-eq-line bg-eq-ice/40">
            <th className="py-2.5 pl-4 pr-3">Entity</th>
            <th className="py-2.5 pr-3">Record</th>
            <th className="py-2.5 pr-3">Field</th>
            <th className="py-2.5 pr-3">Issue</th>
            <th className="py-2.5 pr-4">Type</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((gap, i) => (
            <tr key={i} className="border-b border-eq-line/60 last:border-b-0 hover:bg-amber-50/30">
              <td className="py-2.5 pl-4 pr-3">
                <span className="text-[11px] font-medium text-amber-700">
                  {ENTITY_LABELS[gap.entity] ?? gap.entity}
                </span>
              </td>
              <td className="py-2.5 pr-3">
                <a
                  href={entityHref(gap.entity, gap.row_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-eq-ink hover:text-eq-deep flex items-center gap-1 w-fit"
                >
                  {gap.row_label}
                  <ExternalLink className="w-3 h-3 opacity-40" />
                </a>
              </td>
              <td className="py-2.5 pr-3 font-mono text-xs text-eq-grey">{gap.field}</td>
              <td className="py-2.5 pr-3 text-xs text-eq-ink">{gap.message}</td>
              <td className="py-2.5 pr-4">
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">
                  {GAP_TYPE_LABELS[gap.gap_type] ?? gap.gap_type}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OrphansTab({ orphans }: { orphans: OrphanItem[] }) {
  if (orphans.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-eq-grey">
        <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
        No orphaned records — all FK relationships are intact.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-eq-grey mb-3">
        These records have broken links — the related record they point to no longer exists.
        Fix them by updating the linked record in each row.
      </p>
      <div className="border border-eq-line rounded-xl overflow-hidden">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-eq-grey border-b border-eq-line bg-eq-ice/40">
              <th className="py-2.5 pl-4 pr-3">Entity</th>
              <th className="py-2.5 pr-3">Record</th>
              <th className="py-2.5 pr-3">Problem</th>
              <th className="py-2.5 pr-4">Broken link</th>
            </tr>
          </thead>
          <tbody>
            {orphans.map((orphan, i) => (
              <tr key={i} className="border-b border-eq-line/60 last:border-b-0 hover:bg-rose-50/30">
                <td className="py-2.5 pl-4 pr-3">
                  <span className="text-[11px] font-medium text-rose-700">
                    {ENTITY_LABELS[orphan.entity] ?? orphan.entity}
                  </span>
                </td>
                <td className="py-2.5 pr-3">
                  <a
                    href={entityHref(orphan.entity, orphan.row_id)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-eq-ink hover:text-eq-deep flex items-center gap-1 w-fit"
                  >
                    {orphan.row_label}
                    <ExternalLink className="w-3 h-3 opacity-40" />
                  </a>
                </td>
                <td className="py-2.5 pr-3">
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-medium">
                    {ORPHAN_TYPE_LABELS[orphan.orphan_type] ?? orphan.orphan_type}
                  </span>
                </td>
                <td className="py-2.5 pr-4 font-mono text-[11px] text-eq-grey truncate max-w-[200px]">
                  {orphan.bad_fk_id ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fix key (unique identifier for a fix — used for checkbox selection)
// ---------------------------------------------------------------------------

function fixKey(fix: TidyFix): string {
  return `${fix.table}:${fix.row_id}:${fix.field}`
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

type Phase = 'idle' | 'scanning' | 'reviewing' | 'committing' | 'done' | 'error'
type TabId  = 'fixes' | 'gaps' | 'orphans'

export function TidyClient() {
  const [phase,    setPhase]    = useState<Phase>('idle')
  const [report,   setReport]   = useState<TidyReport | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<TabId>('fixes')
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)
  const [doneResult, setDoneResult] = useState<{ applied: number; intakeId: string | null } | null>(null)

  const [isPending, startTransition] = useTransition()

  // ── Scan ──────────────────────────────────────────────────────────────────

  function handleScan() {
    setPhase('scanning')
    setErrorMsg(null)
    setReport(null)
    setSelected(new Set())

    startTransition(async () => {
      const result = await runTidyScanAction()
      if (!result.ok) {
        setErrorMsg(result.error)
        setPhase('error')
        return
      }
      setReport(result.report)
      // Default tab to whichever section has results
      if (result.report.auto_fixes.length > 0) setActiveTab('fixes')
      else if (result.report.gaps.length > 0)   setActiveTab('gaps')
      else                                       setActiveTab('orphans')
      // Pre-select all auto-fixes
      const allKeys = new Set(result.report.auto_fixes.map(fixKey))
      setSelected(allKeys)
      setPhase('reviewing')
    })
  }

  // ── Toggle selection ──────────────────────────────────────────────────────

  function handleToggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function handleSelectAll(all: boolean) {
    if (!report) return
    setSelected(all ? new Set(report.auto_fixes.map(fixKey)) : new Set())
  }

  // ── Commit ────────────────────────────────────────────────────────────────

  function handleCommit() {
    if (!report || selected.size === 0) return
    setPhase('committing')

    const toCommit = report.auto_fixes.filter((f) => selected.has(fixKey(f)))

    startTransition(async () => {
      const result = await commitTidyFixesAction(toCommit)
      if (!result.ok) {
        setErrorMsg(result.error)
        setPhase('error')
        return
      }
      setDoneResult({ applied: result.result.applied, intakeId: result.result.intakeId })
      setPhase('done')
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-5 text-center">
        <div className="w-14 h-14 rounded-2xl bg-eq-ice flex items-center justify-center">
          <Sparkles className="w-7 h-7 text-eq-deep" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-eq-ink">Ready to scan</h2>
          <p className="text-sm text-eq-grey mt-1 max-w-sm">
            Checks phones, states, emails, ABNs, required fields, and broken links
            across all your records.
          </p>
        </div>
        <button
          onClick={handleScan}
          className="px-5 py-2.5 bg-eq-deep text-white text-sm font-medium rounded-lg hover:bg-eq-sky transition-colors"
        >
          Scan our data
        </button>
      </div>
    )
  }

  if (phase === 'scanning') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <RefreshCw className="w-8 h-8 text-eq-deep animate-spin" />
        <div>
          <h2 className="text-base font-semibold text-eq-ink">Scanning…</h2>
          <p className="text-sm text-eq-grey mt-1">Reading and validating all records.</p>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <AlertCircle className="w-8 h-8 text-rose-500" />
        <div>
          <h2 className="text-base font-semibold text-eq-ink">Scan failed</h2>
          <p className="text-sm text-rose-600 mt-1 max-w-sm">{errorMsg}</p>
        </div>
        <button
          onClick={() => setPhase('idle')}
          className="px-4 py-2 text-sm text-eq-deep border border-eq-deep rounded-lg hover:bg-eq-ice transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  if (phase === 'done' && doneResult) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-500" />
        <div>
          <h2 className="text-lg font-semibold text-eq-ink">
            {doneResult.applied} fix{doneResult.applied === 1 ? '' : 'es'} applied
          </h2>
          {doneResult.intakeId && (
            <p className="text-xs text-eq-grey mt-2">
              Audit ID:{' '}
              <code className="font-mono bg-eq-ice px-1.5 py-0.5 rounded text-eq-ink">
                {doneResult.intakeId}
              </code>
              <br />
              This operation is logged and rollback-able from the audit log.
            </p>
          )}
        </div>
        <button
          onClick={() => { setPhase('idle'); setReport(null); setDoneResult(null) }}
          className="px-4 py-2 text-sm text-eq-deep border border-eq-deep rounded-lg hover:bg-eq-ice transition-colors"
        >
          Run another scan
        </button>
      </div>
    )
  }

  if (!report) return null

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: 'fixes',   label: 'Auto-fixes',       count: report.auto_fixes.length },
    { id: 'gaps',    label: 'Gaps',              count: report.gaps.length },
    { id: 'orphans', label: 'Orphaned records',  count: report.orphans.length },
  ]

  const isCommitting = phase === 'committing'

  return (
    <div className="space-y-5">
      {/* Summary */}
      <SummaryBar report={report} />

      {/* Scan metadata */}
      <p className="text-xs text-eq-grey">
        Scanned {report.summary.total_rows_scanned.toLocaleString()} records
        {' '}·{' '}
        {new Date(report.generated_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
        {' '}·{' '}
        <button onClick={handleScan} className="text-eq-deep hover:underline">Re-scan</button>
      </p>

      {/* Tabs */}
      <div className="border-b border-eq-line flex gap-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
              activeTab === tab.id
                ? 'border-eq-deep text-eq-deep'
                : 'border-transparent text-eq-grey hover:text-eq-ink'
            }`}
          >
            {tab.label}
            <span className={`text-[11px] rounded-full px-1.5 py-0 font-semibold ${
              activeTab === tab.id ? 'bg-eq-deep text-white' : 'bg-eq-line text-eq-grey'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'fixes' && (
        <AutoFixesTab
          fixes={report.auto_fixes}
          selected={selected}
          onToggle={handleToggle}
          onSelectAll={handleSelectAll}
        />
      )}
      {activeTab === 'gaps' && <GapsTab gaps={report.gaps} />}
      {activeTab === 'orphans' && <OrphansTab orphans={report.orphans} />}

      {/* Commit bar — only shown on auto-fixes tab */}
      {activeTab === 'fixes' && report.auto_fixes.length > 0 && (
        <div className="sticky bottom-0 bg-white border-t border-eq-line py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-eq-grey">
            <ShieldAlert className="w-4 h-4 text-eq-deep" />
            Changes are logged and rollback-able via the audit log.
          </div>
          <button
            onClick={handleCommit}
            disabled={selected.size === 0 || isCommitting}
            className="px-5 py-2.5 bg-eq-deep text-white text-sm font-medium rounded-lg hover:bg-eq-sky transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isCommitting ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Applying…</>
            ) : (
              <><ChevronRight className="w-4 h-4" /> Apply {selected.size} fix{selected.size === 1 ? '' : 'es'}</>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
