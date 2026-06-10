'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import { Card } from '@/components/ui/Card'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import {
  createVariationAction,
  updateVariationAction,
  setVariationStatusAction,
  deleteVariationAction,
} from './actions'
import type {
  ContractVariation,
  ContractVariationStatus,
  Customer,
  Site,
} from '@/lib/types'
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  DollarSign,
  Slash,
  AlertTriangle,
} from 'lucide-react'

interface VariationsListProps {
  items: (ContractVariation & {
    customers: { name: string } | null
    sites: { name: string } | null
  })[]
  customers: Pick<Customer, 'id' | 'name'>[]
  sites: Pick<Site, 'id' | 'name' | 'customer_id'>[]
  canWrite: boolean
  isAdmin: boolean
  /**
   * Tenant-level commercial-features flag. Variations is a commercial-tier
   * feature; when false we render an opt-in banner instead of the table.
   */
  commercialEnabled: boolean
}

function statusTheme(status: ContractVariationStatus) {
  switch (status) {
    case 'draft':
      return { label: 'Draft', classes: 'bg-amber-50 text-amber-700 border-amber-200', Icon: Clock }
    case 'quoted':
      return { label: 'Quoted', classes: 'bg-eq-ice text-eq-deep border-eq-ice', Icon: Send }
    case 'approved':
      return { label: 'Approved', classes: 'bg-green-50 text-green-700 border-green-200', Icon: CheckCircle2 }
    case 'rejected':
      return { label: 'Rejected', classes: 'bg-red-50 text-red-700 border-red-200', Icon: XCircle }
    case 'billed':
      return { label: 'Billed', classes: 'bg-eq-deep/10 text-eq-deep border-eq-deep/20', Icon: DollarSign }
    case 'cancelled':
      return { label: 'Cancelled', classes: 'bg-gray-100 text-gray-600 border-gray-200', Icon: Slash }
  }
}

function formatMoney(n: number | null | undefined) {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n)
}

export function VariationsList({
  items,
  customers,
  sites,
  canWrite: canWriteRole,
  isAdmin: isAdminRole,
  commercialEnabled,
}: VariationsListProps) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ContractVariation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const confirm = useConfirm()

  // Form state for dynamic site list keyed off the selected customer.
  const [formCustomerId, setFormCustomerId] = useState('')

  // Filters
  const [filterCustomer, setFilterCustomer] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | ContractVariationStatus>('all')
  const [filterFY, setFilterFY] = useState('')

  const filteredSitesForForm = useMemo(() => {
    if (!formCustomerId) return sites
    return sites.filter(s => s.customer_id === formCustomerId)
  }, [sites, formCustomerId])

  // FY filter options from the data itself, mirroring contract-scope.
  const fyOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const v of items) if (v.financial_year) seen.add(v.financial_year)
    return Array.from(seen).sort((a, b) => b.localeCompare(a))
  }, [items])

  const filtered = useMemo(() => {
    let result = items
    if (filterCustomer) result = result.filter(i => i.customer_id === filterCustomer)
    if (filterStatus !== 'all') result = result.filter(i => i.status === filterStatus)
    if (filterFY) result = result.filter(i => i.financial_year === filterFY)
    return result
  }, [items, filterCustomer, filterStatus, filterFY])

  // Totals strip — the value the register adds is "show me how much
  // out-of-scope work is in flight". Sum value_estimate (or value_approved
  // when set) by status bucket.
  const totals = useMemo(() => {
    const bucketSum = (statuses: ContractVariationStatus[]) =>
      filtered
        .filter(v => statuses.includes(v.status))
        .reduce((s, v) => s + (v.value_approved ?? v.value_estimate ?? 0), 0)
    return {
      pipeline: bucketSum(['draft', 'quoted']),
      approved: bucketSum(['approved']),
      billed: bucketSum(['billed']),
      count: filtered.length,
    }
  }, [filtered])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const formData = new FormData(e.currentTarget)
    const result = editing
      ? await updateVariationAction(editing.id, formData)
      : await createVariationAction(formData)
    setLoading(false)
    if (result.success) {
      setShowForm(false)
      setEditing(null)
      setFormCustomerId('')
    } else {
      setError(result.error ?? 'Something went wrong.')
    }
  }

  async function handleSetStatus(item: ContractVariation, target: ContractVariationStatus) {
    if (item.status === target) return
    const reason = window.prompt(`Move variation ${item.variation_number} to "${target}". Optional reason for the audit log:`)
    if (reason === null) return
    setLoading(true)
    const result = await setVariationStatusAction(item.id, target, reason.trim() || null)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Could not change status.')
  }

  async function handleDelete(item: ContractVariation) {
    const ok = await confirm({
      title: `Delete variation ${item.variation_number}?`,
      message: 'This will remove the variation from the register. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    setLoading(true)
    const result = await deleteVariationAction(item.id)
    setLoading(false)
    if (!result.success) setError(result.error ?? 'Something went wrong.')
  }

  function startEdit(item: ContractVariation) {
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

  // Commercial-tier gate. Free-tier tenants land on the page (so the route
  // exists) but see an opt-in card instead of the table.
  if (!commercialEnabled) {
    return (
      <Card>
        <div className="flex items-start gap-3 p-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="font-semibold text-eq-ink text-sm">Commercial features off</h3>
            <p className="text-sm text-eq-grey mt-1">
              The variations register is part of the commercial-tier feature
              set (alongside contract-scope locking, audit history, service-credit
              risk and renewal packs). Switch it on per tenant from{' '}
              <Link href="/admin/settings" className="text-eq-sky hover:underline">
                Admin → Settings
              </Link>
              .
            </p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Totals strip — gives commercial managers an at-a-glance read on
          how much out-of-scope work is sitting unbilled. */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <div className="px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-eq-grey font-bold">Pipeline (draft + quoted)</p>
            <p className="text-xl font-bold text-eq-deep mt-0.5">{formatMoney(totals.pipeline)}</p>
          </div>
        </Card>
        <Card>
          <div className="px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-eq-grey font-bold">Approved (unbilled)</p>
            <p className="text-xl font-bold text-green-700 mt-0.5">{formatMoney(totals.approved)}</p>
          </div>
        </Card>
        <Card>
          <div className="px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-eq-grey font-bold">Billed</p>
            <p className="text-xl font-bold text-eq-deep mt-0.5">{formatMoney(totals.billed)}</p>
          </div>
        </Card>
        <Card>
          <div className="px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-eq-grey font-bold">Total Variations</p>
            <p className="text-xl font-bold text-eq-ink mt-0.5">{totals.count}</p>
          </div>
        </Card>
      </div>

      {/* Filters + Add */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-eq-grey" />
          <select
            value={filterCustomer}
            onChange={(e) => setFilterCustomer(e.target.value)}
            className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
          >
            <option value="">All Customers</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as 'all' | ContractVariationStatus)}
            className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="quoted">Quoted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="billed">Billed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={filterFY}
            onChange={(e) => setFilterFY(e.target.value)}
            className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
          >
            <option value="">All Years</option>
            {fyOptions.map(fy => <option key={fy} value={fy}>{fy}</option>)}
          </select>
        </div>
        <div className="ml-auto">
          {canWriteRole && !showForm && (
            <Button size="sm" onClick={() => { setShowForm(true); setEditing(null); setError(null) }}>
              <Plus className="w-3.5 h-3.5 mr-1" /> New Variation
            </Button>
          )}
        </div>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-eq-deep">{editing ? `Edit ${editing.variation_number}` : 'New Variation'}</h3>
              <button type="button" onClick={cancelForm} className="text-eq-grey hover:text-eq-ink"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                  {filteredSitesForForm.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <FormInput
                label="Financial Year"
                name="financial_year"
                defaultValue={editing?.financial_year ?? String(new Date().getFullYear())}
                placeholder="e.g. 2026 or 2025-2026"
              />
            </div>
            <FormInput
              label="Title *"
              name="title"
              required
              defaultValue={editing?.title ?? ''}
              placeholder="e.g. Emergency switchboard repair after Stage 3 fault"
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Description</label>
              <textarea
                name="description"
                defaultValue={editing?.description ?? ''}
                rows={3}
                className="px-3 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
                placeholder="Scope of work + reason it's out of contract scope"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <FormInput
                label="Variation #"
                name="variation_number"
                defaultValue={editing?.variation_number ?? ''}
                placeholder="auto-generate (CV-YYYY-NNNN)"
              />
              <FormInput
                label="Customer Ref"
                name="customer_ref"
                defaultValue={editing?.customer_ref ?? ''}
                placeholder="their PO #"
              />
              <FormInput
                label="Estimate (AUD)"
                name="value_estimate"
                type="number"
                defaultValue={editing?.value_estimate?.toString() ?? ''}
              />
              <FormInput
                label="Approved (AUD)"
                name="value_approved"
                type="number"
                defaultValue={editing?.value_approved?.toString() ?? ''}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-eq-grey uppercase tracking-wide">Notes</label>
              <textarea
                name="notes"
                defaultValue={editing?.notes ?? ''}
                rows={2}
                className="px-3 py-2 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-sky"
                placeholder="Internal notes, approver reference, etc."
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" loading={loading}>{editing ? 'Update' : 'Create'}</Button>
              <Button type="button" variant="secondary" size="sm" onClick={cancelForm}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Register table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm mb-1">No variations match the current filters.</p>
          {canWriteRole && (
            <p className="text-eq-grey text-xs">Use &quot;New Variation&quot; to log out-of-scope work.</p>
          )}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-eq-ice/30 border-b border-gray-100">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-bold text-eq-grey uppercase tracking-wide">#</th>
                <th className="text-left px-3 py-2 text-xs font-bold text-eq-grey uppercase tracking-wide">Customer</th>
                <th className="text-left px-3 py-2 text-xs font-bold text-eq-grey uppercase tracking-wide">Title</th>
                <th className="text-left px-3 py-2 text-xs font-bold text-eq-grey uppercase tracking-wide">FY</th>
                <th className="text-right px-3 py-2 text-xs font-bold text-eq-grey uppercase tracking-wide">Value</th>
                <th className="text-left px-3 py-2 text-xs font-bold text-eq-grey uppercase tracking-wide">Status</th>
                <th className="text-right px-3 py-2 text-xs font-bold text-eq-grey uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(item => {
                const theme = statusTheme(item.status)
                const Icon = theme.Icon
                return (
                  <tr key={item.id} className="hover:bg-eq-ice/10">
                    <td className="px-3 py-2 font-mono text-xs text-eq-deep">{item.variation_number}</td>
                    <td className="px-3 py-2">
                      <span className="text-eq-ink">{item.customers?.name ?? '—'}</span>
                      {item.sites && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-eq-grey">{item.sites.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-eq-ink max-w-[24rem]">
                      <p className="truncate" title={item.title}>{item.title}</p>
                      {item.customer_ref && (
                        <p className="text-[10px] text-eq-grey">PO {item.customer_ref}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-eq-grey text-xs">{item.financial_year ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="text-eq-ink">{formatMoney(item.value_approved ?? item.value_estimate)}</span>
                      {item.value_approved !== null && item.value_approved !== undefined && item.value_estimate !== null && item.value_estimate !== item.value_approved && (
                        <p className="text-[10px] text-eq-grey">est {formatMoney(item.value_estimate)}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium ${theme.classes}`}>
                        <Icon className="w-3 h-3" />
                        {theme.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {canWriteRole && (
                          <>
                            {item.status === 'draft' && (
                              <button onClick={() => handleSetStatus(item, 'quoted')} className="p-1.5 text-eq-grey hover:text-eq-sky" title="Mark Quoted">
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {item.status === 'quoted' && (
                              <>
                                <button onClick={() => handleSetStatus(item, 'approved')} className="p-1.5 text-eq-grey hover:text-green-600" title="Mark Approved">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => handleSetStatus(item, 'rejected')} className="p-1.5 text-eq-grey hover:text-red-500" title="Mark Rejected">
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            {item.status === 'approved' && (
                              <button onClick={() => handleSetStatus(item, 'billed')} className="p-1.5 text-eq-grey hover:text-eq-deep" title="Mark Billed">
                                <DollarSign className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button onClick={() => startEdit(item)} className="p-1.5 text-eq-grey hover:text-eq-sky" title="Edit">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {isAdminRole && (
                          <button onClick={() => handleDelete(item)} className="p-1.5 text-eq-grey hover:text-red-500" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
