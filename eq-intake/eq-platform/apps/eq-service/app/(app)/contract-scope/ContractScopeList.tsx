'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { Card } from '@/components/ui/Card'
import { createScopeItemAction, updateScopeItemAction, deleteScopeItemAction, setContractScopePeriodStatusAction } from './actions'
import { generateScopeStatementAction } from './scope-statement-action'
import type { ContractScope, ContractScopePeriodStatus, Customer, Site } from '@/lib/types'
import { Plus, Pencil, Trash2, X, CheckCircle2, XCircle, Filter, Upload, Download, Lock, Unlock, Archive, FileText, FileDown } from 'lucide-react'
import { ImportCSVModal } from '@/components/ui/ImportCSVModal'
import type { ImportCSVConfig } from '@/components/ui/ImportCSVModal'
import { importScopeItemsAction } from './actions'
import { useConfirm } from '@/components/ui/ConfirmDialog'

/**
 * Render a financial_year value. Hyphenated values are Aus FY (Jul-Jun);
 * 4-digit values are calendar-year (Equinix-style). The dropdown surfaces
 * only what the data actually uses — see `fyOptions` in the component.
 */
function fyLabel(fy: string) {
  if (/^\d{4}$/.test(fy)) return `CY ${fy}`
  return `FY ${fy}`
}

interface ContractScopeListProps {
  items: (ContractScope & { customers: { name: string } | null; sites: { name: string } | null })[]
  customers: Pick<Customer, 'id' | 'name'>[]
  sites: Pick<Site, 'id' | 'name' | 'customer_id'>[]
  canWrite: boolean
  isAdmin: boolean
  /**
   * Tenant-level commercial-features flag (migration 0085). When true:
   *   - lock/unlock/archive controls + locked-row enforcement are surfaced
   *     (Phase 5 UI)
   *   - the "Scope Statement" download button appears (Phase 8)
   * When false the period_status badge is still visible for non-default
   * states (so data is never hidden) but action buttons stay off — matches
   * the BEFORE UPDATE/DELETE trigger on the DB.
   */
  commercialEnabled: boolean
}

/**
 * Map a ContractScope.period_status to a {label, classes} pair. We don't
 * route through StatusBadge here because the lifecycle vocabulary is
 * domain-specific (locked / archived) and worth a dedicated palette.
 */
function periodStatusTheme(status: ContractScopePeriodStatus) {
  switch (status) {
    case 'draft':
      return { label: 'Draft', classes: 'bg-amber-50 text-amber-700 border-amber-200' }
    case 'committed':
      return { label: 'Committed', classes: 'bg-eq-ice text-eq-deep border-eq-ice' }
    case 'locked':
      return { label: 'Locked', classes: 'bg-gray-100 text-gray-700 border-gray-300' }
    case 'archived':
      return { label: 'Archived', classes: 'bg-gray-50 text-gray-500 border-gray-200' }
  }
}

export function ContractScopeList({ items, customers, sites, canWrite: canWriteRole, isAdmin: isAdminRole, commercialEnabled }: ContractScopeListProps) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ContractScope | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const confirm = useConfirm()

  // The Add/Edit form lives between the summary strip and the customer-
  // grouped list. With Jemena onboarding the page got long enough that
  // clicking Edit on a row near the bottom would open the form off-screen
  // above — looked like the click did nothing. Scroll the form into view
  // whenever it opens.
  const formRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (showForm && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [showForm])

  // CSV export helper
  function handleExport() {
    const csvRows = filtered.map(item => ({
      customer: item.customers?.name ?? '',
      site: item.sites?.name ?? '',
      financial_year: item.financial_year,
      scope_item: item.scope_item,
      included: item.is_included ? 'Yes' : 'No',
      notes: item.notes ?? '',
    }))
    const headers = ['customer', 'site', 'financial_year', 'scope_item', 'included', 'notes']
    const csv = [headers.join(','), ...csvRows.map(r => headers.map(h => `"${(r[h as keyof typeof r] ?? '').toString().replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `contract-scope-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const scopeImportConfig: ImportCSVConfig<{
    customer_name: string
    site_name: string | null
    financial_year: string
    scope_item: string
    is_included: boolean
    notes: string | null
  }> = {
    entityName: 'Contract Scope Items',
    requiredColumns: ['customer', 'scope_item'],
    optionalColumns: ['site', 'financial_year', 'included', 'notes'],
    mapRow: (row, columnMap) => {
      const customer_name = row[columnMap['customer']]?.trim()
      const scope_item = row[columnMap['scope_item']]?.trim()
      if (!customer_name || !scope_item) return null
      const includedVal = row[columnMap['included']]?.trim()?.toLowerCase()
      return {
        customer_name,
        site_name: row[columnMap['site']]?.trim() || null,
        financial_year: row[columnMap['financial_year']]?.trim() || filterFY || currentCY(),
        scope_item,
        is_included: includedVal === 'no' ? false : true,
        notes: row[columnMap['notes']]?.trim() || null,
      }
    },
    importAction: importScopeItemsAction,
  }

  // Filters
  const [filterCustomer, setFilterCustomer] = useState('')
  const [filterSite, setFilterSite] = useState('')
  const [filterFY, setFilterFY] = useState(currentCY())
  const [filterIncluded, setFilterIncluded] = useState<'all' | 'yes' | 'no'>('all')

  // Form state for dynamic site filter
  const [formCustomerId, setFormCustomerId] = useState('')

  // Calendar-year default. Customers on Aus FY (e.g. Jemena) can still
  // file scope under hyphenated FY values — those appear in `fyOptions`
  // when data carries them — but new entries default to CY because that's
  // the dominant tenant pattern (Equinix + future SKS-direct customers).
  function currentCY() {
    return String(new Date().getFullYear())
  }

  // Sites filtered to the chosen customer (or all sites if none picked).
  // Used by both the filter row at the top and the form picker below.
  const filteredSites = useMemo(() => {
    if (!formCustomerId) return sites
    return sites.filter(s => s.customer_id === formCustomerId)
  }, [sites, formCustomerId])

  const filterSites = useMemo(() => {
    if (!filterCustomer) return sites
    return sites.filter(s => s.customer_id === filterCustomer)
  }, [sites, filterCustomer])

  // Distinct financial_year values present in items. CY (4-digit) values
  // sort first descending, then Aus-FY (hyphenated) descending. If the
  // data has no rows yet, fall back to current CY so the picker isn't
  // empty.
  const fyOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const i of items) {
      if (i.financial_year) seen.add(i.financial_year)
    }
    if (seen.size === 0) seen.add(currentCY())
    return Array.from(seen).sort((a, b) => {
      const aIsCal = /^\d{4}$/.test(a)
      const bIsCal = /^\d{4}$/.test(b)
      if (aIsCal !== bIsCal) return aIsCal ? -1 : 1
      return b.localeCompare(a)
    })
  }, [items])

  // Reset site filter if it no longer matches the customer filter.
  if (filterSite && !filterSites.some((s) => s.id === filterSite)) {
    setFilterSite('')
  }

  const filtered = useMemo(() => {
    let result = items
    if (filterCustomer) result = result.filter(i => i.customer_id === filterCustomer)
    if (filterSite) result = result.filter(i => i.site_id === filterSite)
    if (filterFY) result = result.filter(i => i.financial_year === filterFY)
    if (filterIncluded === 'yes') result = result.filter(i => i.is_included)
    if (filterIncluded === 'no') result = result.filter(i => !i.is_included)
    return result
  }, [items, filterCustomer, filterSite, filterFY, filterIncluded])

  // Group by customer
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>()
    for (const item of filtered) {
      const key = item.customers?.name ?? 'Unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = editing
      ? await updateScopeItemAction(editing.id, formData)
      : await createScopeItemAction(formData)

    setLoading(false)
    if (result.success) {
      setShowForm(false)
      setEditing(null)
      setFormCustomerId('')
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleDelete(item: ContractScope) {
    const ok = await confirm({
      title: 'Delete this scope item?',
      message: 'This row will be permanently removed from the contract scope.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    setLoading(true)
    const result = await deleteScopeItemAction(item.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Something went wrong.')
  }

  /**
   * Lock / unlock / archive flow. Asks the operator for an optional
   * reason — captured into audit_logs.metadata so the history viewer can
   * surface the rationale alongside the diff. Confirms before locking
   * because the action is high-friction to reverse (super_admin only).
   */
  async function handleSetStatus(item: ContractScope, target: ContractScopePeriodStatus) {
    const verb = target === 'locked' ? 'Lock' : target === 'archived' ? 'Archive' : target === 'committed' ? 'Unlock' : 'Move to draft'
    const warning = target === 'locked'
      ? 'Locking makes this row immutable for everyone except super_admin. The importer will refuse to wipe it.'
      : target === 'archived'
        ? 'Archive hides the row from active filters.'
        : null
    if (warning) {
      const ok = await confirm({
        title: `${verb} scope item?`,
        message: warning,
        confirmLabel: verb,
      })
      if (!ok) return
    }
    const reason = window.prompt(`${verb}: optional reason for the audit trail (leave blank to skip):`)
    if (reason === null) return // cancelled
    setLoading(true)
    const result = await setContractScopePeriodStatusAction(item.id, target, reason.trim() || null)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Could not change status.')
  }

  function startEdit(item: ContractScope) {
    setEditing(item)
    setFormCustomerId(item.customer_id)
    setShowForm(true)
    setError(null)
  }

  function cancelForm() {
    setShowForm(false)
    setEditing(null)
    setFormCustomerId('')
    setError(null)
  }

  /**
   * Phase 8 — generate the customer-facing scope statement docx (or PDF
   * if a conversion backend is configured). Requires the filter to have
   * narrowed to a single customer + a single FY so we know which slice
   * of scope rows to bake into the document.
   */
  async function handleScopeStatement(format: 'docx' | 'pdf') {
    if (!filterCustomer || !filterFY) {
      setError('Pick a single customer and a single financial year before exporting the scope statement.')
      return
    }
    setLoading(true)
    setError(null)
    const fd = new FormData()
    fd.set('customer_id', filterCustomer)
    fd.set('financial_year', filterFY)
    fd.set('format', format)
    fd.set('include_variations', 'true')
    const result = await generateScopeStatementAction(fd)
    setLoading(false)
    if (!result.success || !('data_b64' in result) || !result.data_b64) {
      setError(('error' in result && result.error) || 'Could not generate scope statement.')
      return
    }
    // Trigger browser download from the base64 payload.
    const bytes = Uint8Array.from(atob(result.data_b64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: result.content_type ?? 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename ?? 'scope-statement.docx'
    a.click()
    URL.revokeObjectURL(url)
  }

  const includedCount = filtered.filter(i => i.is_included).length
  const excludedCount = filtered.filter(i => !i.is_included).length

  return (
    <div className="space-y-4">
      {/* Filters + Add button */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-eq-grey" />
          <select
            value={filterFY}
            onChange={(e) => setFilterFY(e.target.value)}
            className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
          >
            <option value="">All Years</option>
            {fyOptions.map(fy => (
              <option key={fy} value={fy}>{fyLabel(fy)}</option>
            ))}
          </select>
          <select
            value={filterCustomer}
            onChange={(e) => { setFilterCustomer(e.target.value); setFilterSite('') }}
            className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
          >
            <option value="">All Customers</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={filterSite}
            onChange={(e) => setFilterSite(e.target.value)}
            disabled={filterSites.length === 0}
            className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky disabled:bg-gray-50 disabled:text-eq-grey"
          >
            <option value="">All Sites</option>
            {filterSites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            value={filterIncluded}
            onChange={(e) => setFilterIncluded(e.target.value as 'all' | 'yes' | 'no')}
            className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
          >
            <option value="all">All Items</option>
            <option value="yes">Included Only</option>
            <option value="no">Excluded Only</option>
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {canWriteRole && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          {/* Phase 8 — customer-facing scope statement. Only available on
              the commercial tier, and the operator must have narrowed to
              a single customer + single FY first. We disable the button
              when filters aren't narrow enough (rather than letting it
              click-through to a buried error) so the constraint is
              visible BEFORE the click — the title attribute spells out
              what's missing. */}
          {commercialEnabled && canWriteRole && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleScopeStatement('docx')}
              disabled={loading || !filterCustomer || !filterFY}
              title={
                !filterCustomer && !filterFY
                  ? 'Pick a customer and a year first'
                  : !filterCustomer
                    ? 'Pick a single customer first'
                    : !filterFY
                      ? 'Pick a financial year first'
                      : 'Generate the customer-facing scope statement (DOCX)'
              }
            >
              <FileDown className="w-4 h-4 mr-1" /> Scope Statement
            </Button>
          )}
          {canWriteRole && !showForm && (
            <Button size="sm" onClick={() => { setShowForm(true); setEditing(null); setError(null) }}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Scope Item
            </Button>
          )}
        </div>
      </div>

      {/* Top-level error banner. Renders any error set by the toolbar
          actions (Scope Statement, Lock/Unlock, Export, etc.) so they
          surface even when the Add/Edit form is closed. The form has its
          own inline error inside the card for create/update flows. */}
      {error && !showForm && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
          <p className="text-sm text-red-700 flex-1">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600 shrink-0"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Summary strip */}
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5 text-green-700">
          <CheckCircle2 className="w-4 h-4" /> {includedCount} included
        </span>
        <span className="flex items-center gap-1.5 text-red-600">
          <XCircle className="w-4 h-4" /> {excludedCount} excluded
        </span>
        <span className="text-eq-grey">({filtered.length} total items)</span>
        {commercialEnabled && (
          <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-eq-ice text-eq-deep border border-eq-ice/80 font-medium" title="Period locking, audit history, and the broader commercial-tier features are switched on for this tenant.">
            Commercial features ON
          </span>
        )}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div ref={formRef} className="scroll-mt-24">
          <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-eq-deep">{editing ? 'Edit Scope Item' : 'New Scope Item'}</h3>
              <button type="button" onClick={cancelForm} className="text-eq-grey hover:text-eq-ink"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Customer *</label>
                <select
                  name="customer_id"
                  required
                  defaultValue={editing?.customer_id ?? ''}
                  onChange={(e) => setFormCustomerId(e.target.value)}
                  className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
                >
                  <option value="">Select customer...</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Site (optional)</label>
                <select
                  name="site_id"
                  defaultValue={editing?.site_id ?? ''}
                  className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
                >
                  <option value="">All sites</option>
                  {filteredSites.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Financial Year *</label>
                <select
                  name="financial_year"
                  required
                  defaultValue={editing?.financial_year ?? (filterFY || currentCY())}
                  className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
                >
                  {fyOptions.map(fy => (
                    <option key={fy} value={fy}>{fyLabel(fy)}</option>
                  ))}
                </select>
              </div>
            </div>
            <FormInput label="Scope Item *" name="scope_item" required defaultValue={editing?.scope_item ?? ''} placeholder="e.g. Annual PM on all UPS systems" />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Included in Contract?</label>
                <select
                  name="is_included"
                  defaultValue={editing ? (editing.is_included ? 'true' : 'false') : 'true'}
                  className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
                >
                  <option value="true">Yes — Included</option>
                  <option value="false">No — Excluded / Out of Scope</option>
                </select>
              </div>
              <FormInput label="Notes" name="notes" defaultValue={editing?.notes ?? ''} placeholder="Budget notes, variation ref, etc." />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" loading={loading}>{editing ? 'Update' : 'Add Item'}</Button>
              <Button type="button" variant="secondary" size="sm" onClick={cancelForm}>Cancel</Button>
            </div>
          </form>
          </Card>
        </div>
      )}

      <ImportCSVModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        config={scopeImportConfig}
      />

      {/* Grouped list */}
      {grouped.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-1">No scope items found.</p>
          <p className="text-eq-grey text-xs">Use &quot;Add Scope Item&quot; to define what&apos;s in and out of your contracts.</p>
        </div>
      ) : (
        grouped.map(([customerName, customerItems]) => (
          <div key={customerName} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            <div className="px-4 py-3 bg-eq-ice/40 border-b border-gray-100">
              <h3 className="font-semibold text-eq-deep text-sm">{customerName}</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {customerItems.map((item) => {
                const status = (item.period_status ?? 'committed') as ContractScopePeriodStatus
                const theme = periodStatusTheme(status)
                const isLocked = status === 'locked'
                const isArchived = status === 'archived'
                // Mutating affordances (edit / delete) are blocked at the DB
                // by the lock-gate trigger when commercialEnabled is true.
                // Mirror that in the UI to avoid doomed clicks.
                const editDisabled = commercialEnabled && (isLocked || isArchived)
                return (
                  <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="mt-0.5 shrink-0">
                      {item.is_included ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-eq-ink text-sm">{item.scope_item}</span>
                        {item.sites && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-eq-grey">{item.sites.name}</span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-eq-ice text-eq-deep">{fyLabel(item.financial_year)}</span>
                        {/* period_status badge — always visible so legacy
                          data still surfaces "committed". Hidden only when
                          not commercial AND status is the default
                          'committed' (no extra noise on free tier). */}
                        {(commercialEnabled || status !== 'committed') && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${theme.classes}`}>
                            {theme.label}
                          </span>
                        )}
                      </div>
                      {item.notes && <p className="text-xs text-eq-grey mt-0.5">{item.notes}</p>}
                    </div>
                    {canWriteRole && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => startEdit(item)}
                          disabled={editDisabled}
                          className="p-1.5 text-eq-grey hover:text-eq-sky transition-colors disabled:opacity-30 disabled:hover:text-eq-grey disabled:cursor-not-allowed"
                          title={editDisabled ? 'Locked — unlock first to edit' : 'Edit'}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {/* Lock / unlock / archive controls — admin role +
                          tenant on commercial tier. Super_admin can flip
                          back from locked; admins can only forward-step
                          (draft → committed → locked / archived). */}
                        {isAdminRole && commercialEnabled && (
                          <>
                            {status === 'draft' && (
                              <button
                                onClick={() => handleSetStatus(item, 'committed')}
                                className="p-1.5 text-eq-grey hover:text-eq-deep transition-colors"
                                title="Mark Committed"
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {status === 'committed' && (
                              <button
                                onClick={() => handleSetStatus(item, 'locked')}
                                className="p-1.5 text-eq-grey hover:text-amber-600 transition-colors"
                                title="Lock for year-end close"
                              >
                                <Lock className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {status === 'locked' && (
                              <button
                                onClick={() => handleSetStatus(item, 'committed')}
                                className="p-1.5 text-eq-grey hover:text-eq-sky transition-colors"
                                title="Unlock (super_admin only)"
                              >
                                <Unlock className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!isArchived && status !== 'locked' && (
                              <button
                                onClick={() => handleSetStatus(item, 'archived')}
                                className="p-1.5 text-eq-grey hover:text-amber-600 transition-colors"
                                title="Archive"
                              >
                                <Archive className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        )}
                        {isAdminRole && !editDisabled && (
                          <button
                            onClick={() => handleDelete(item)}
                            className="p-1.5 text-eq-grey hover:text-red-500 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
