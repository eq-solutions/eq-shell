'use client'

import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { FormInput } from '@/components/ui/FormInput'
import {
  wipeCustomerContractDataAction,
  previewCustomerContractDataWipeAction,
} from './danger-actions'
import { cascadeArchiveAction } from '@/app/(app)/admin/archive/actions'
import { useConfirm } from '@/components/ui/ConfirmDialog'

interface CustomerDangerZoneProps {
  customerId: string
  customerName: string
  isActive: boolean
}

type Counts = { scopes: number; calendar: number; gaps: number }

export function CustomerDangerZone({ customerId, customerName, isActive }: CustomerDangerZoneProps) {
  const [pending, startTransition] = useTransition()
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const confirm = useConfirm()

  // Wipe-contract-data state
  const currentYear = new Date().getFullYear().toString()
  const [year, setYear] = useState<string>(currentYear)
  const [preview, setPreview] = useState<Counts | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [showWipeModal, setShowWipeModal] = useState(false)

  // Archive confirm state — uses the brand ConfirmDialog (same surface as SiteForm).
  async function handleArchive() {
    if (!isActive) return
    const ok = await confirm({
      title: `Archive "${customerName}"?`,
      message:
        'Everything (sites + assets) moves to /admin/archive and auto-deletes after the grace period unless restored. Reversible.',
      confirmLabel: 'Archive customer',
    })
    if (!ok) return
    setBanner(null)
    const fd = new FormData()
    fd.set('entity_type', 'customer')
    fd.set('entity_id', customerId)
    startTransition(async () => {
      const res = await cascadeArchiveAction(fd)
      if (res && 'error' in res && res.error) {
        setBanner({ kind: 'err', msg: res.error })
        return
      }
      const counts = (res as { counts?: { customer: number; site: number; asset: number } }).counts
      if (counts) {
        setBanner({
          kind: 'ok',
          msg:
            `Archived ${counts.customer} customer, ${counts.site} site(s), ` +
            `${counts.asset} asset(s). Permanently delete from /admin/archive when ready.`,
        })
      } else {
        setBanner({ kind: 'ok', msg: 'Customer archived. Hard-delete from /admin/archive when ready.' })
      }
    })
  }

  function handleOpenWipeModal() {
    setBanner(null)
    setPreview(null)
    setConfirmName('')
    if (!/^\d{4}$/.test(year)) {
      setBanner({ kind: 'err', msg: 'Year must be 4 digits (e.g. 2026).' })
      return
    }
    const fd = new FormData()
    fd.set('customer_id', customerId)
    fd.set('financial_year', year)
    startTransition(async () => {
      const res = await previewCustomerContractDataWipeAction(fd)
      if (!res.ok) {
        setBanner({ kind: 'err', msg: res.error })
        return
      }
      setPreview(res.counts)
      setShowWipeModal(true)
    })
  }

  function handleConfirmWipe() {
    setBanner(null)
    const fd = new FormData()
    fd.set('customer_id', customerId)
    fd.set('financial_year', year)
    fd.set('confirm_name', confirmName)
    startTransition(async () => {
      const res = await wipeCustomerContractDataAction(fd)
      if (!res.ok) {
        setBanner({ kind: 'err', msg: res.error })
        return
      }
      setBanner({
        kind: 'ok',
        msg:
          `Wiped ${year} contract data: ${res.counts.scopes} scope rows, ` +
          `${res.counts.calendar} calendar rows, ${res.counts.gaps} coverage gaps.`,
      })
      setShowWipeModal(false)
      setConfirmName('')
      setPreview(null)
    })
  }

  function closeWipeModal() {
    if (pending) return
    setShowWipeModal(false)
    setConfirmName('')
    setPreview(null)
  }

  const totalToWipe = preview ? preview.scopes + preview.calendar + preview.gaps : 0
  const confirmMatch = confirmName.trim() === customerName.trim()

  return (
    <Card className="border-red-200">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-red-700">Danger Zone</h2>
        <span className="text-xs font-semibold text-red-600 uppercase tracking-wide">Admin only</span>
      </div>

      {banner && (
        <div className={
          'px-4 py-2 rounded-md border text-xs mb-4 ' +
          (banner.kind === 'ok'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800')
        }>
          {banner.msg}
        </div>
      )}

      {/* Wipe contract data */}
      <div className="border border-gray-200 rounded-md p-4 mb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-eq-ink">Wipe contract data for one year</p>
            <p className="text-xs text-eq-grey mt-1">
              Hard-deletes <span className="font-mono">contract_scopes</span>,{' '}
              <span className="font-mono">pm_calendar</span> and{' '}
              <span className="font-mono">scope_coverage_gaps</span> for this customer in the
              chosen year. Sites, assets, maintenance checks and the customer row stay.
              Use this before re-importing from the commercial sheet.
            </p>
          </div>
        </div>
        <div className="flex items-end gap-3 mt-3">
          <div className="w-32">
            <FormInput
              label="Year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2026"
              inputMode="numeric"
              maxLength={4}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={handleOpenWipeModal}
            className="!bg-red-600 hover:!bg-red-700 !text-white"
          >
            {pending && !showWipeModal ? 'Counting…' : 'Preview wipe…'}
          </Button>
        </div>
      </div>

      {/* Archive customer */}
      <div className="border border-gray-200 rounded-md p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-eq-ink">
              {isActive ? 'Archive customer (cascade)' : 'Customer is archived'}
            </p>
            <p className="text-xs text-eq-grey mt-1">
              {isActive ? (
                <>
                  Soft-deletes the customer and cascades to all sites and assets. Reversible
                  from{' '}
                  <a href="/admin/archive" className="text-eq-deep underline">
                    /admin/archive
                  </a>{' '}
                  inside the grace window. Permanently delete from there when ready
                  (typed-name confirm enforces no fat-finger).
                </>
              ) : (
                <>
                  This customer is already archived. Restore or hard-delete from{' '}
                  <a href="/admin/archive" className="text-eq-deep underline">
                    /admin/archive
                  </a>
                  .
                </>
              )}
            </p>
          </div>
          {isActive && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={pending}
              onClick={handleArchive}
            >
              Archive customer
            </Button>
          )}
        </div>
      </div>

      {/* Preview + typed-name confirm modal */}
      {showWipeModal && preview && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={closeWipeModal}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-eq-ink">Wipe {year} contract data?</h3>
            <p className="text-sm text-eq-grey mt-2">
              This will permanently delete the following for{' '}
              <span className="font-semibold text-eq-ink">&ldquo;{customerName}&rdquo;</span>:
            </p>
            <ul className="mt-3 space-y-1 text-sm text-eq-ink">
              <li>
                <span className="font-mono text-eq-deep">{preview.scopes}</span> contract scope row
                {preview.scopes === 1 ? '' : 's'}
              </li>
              <li>
                <span className="font-mono text-eq-deep">{preview.calendar}</span> calendar entr
                {preview.calendar === 1 ? 'y' : 'ies'}
              </li>
              <li>
                <span className="font-mono text-eq-deep">{preview.gaps}</span> coverage gap
                {preview.gaps === 1 ? '' : 's'}
              </li>
            </ul>
            {totalToWipe === 0 && (
              <p className="text-xs text-amber-700 mt-3 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Nothing to wipe in {year}. You can still confirm — it'll be a no-op.
              </p>
            )}
            <p className="text-sm text-eq-grey mt-4">
              Sites, assets, maintenance checks and the customer row are <em>not</em> affected.
              This cannot be undone.
            </p>
            <p className="text-xs text-eq-grey mt-3">
              Type <span className="font-mono font-semibold text-eq-ink">{customerName}</span> to
              confirm:
            </p>
            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoFocus
              className="w-full mt-2 h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
              placeholder="Type the name exactly"
            />
            <div className="flex items-center justify-end gap-2 mt-5">
              <Button variant="secondary" size="sm" onClick={closeWipeModal} disabled={pending}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmWipe}
                disabled={pending || !confirmMatch}
                className="!bg-red-600 hover:!bg-red-700 !text-white"
              >
                {pending ? 'Wiping…' : `Wipe ${year} data`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
