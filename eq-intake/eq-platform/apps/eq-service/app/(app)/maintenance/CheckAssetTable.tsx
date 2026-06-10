'use client'

import { useMemo } from 'react'
import { AssetRow, type CheckAssetWithDetails } from './AssetRow'
import type { MaintenanceCheckItem, CheckStatus, CheckItemResult } from '@/lib/types'

export type SortKey = 'maximo_id' | 'name' | 'location' | 'work_order' | 'job_plan' | 'completed' | 'notes'
export type SortDir = 'asc' | 'desc'

interface CheckAssetTableProps {
  checkAssets: CheckAssetWithDetails[]
  items: MaintenanceCheckItem[]
  sortKey: SortKey
  sortDir: SortDir
  onToggleSort: (key: SortKey) => void
  expandedAssetId: string | null
  onExpandAsset: (id: string | null) => void
  canAct: boolean
  checkStatus: CheckStatus
  onForceComplete: (checkAssetId: string) => void
  onItemResult: (itemId: string, result: CheckItemResult | null) => void
  onItemNotes: (itemId: string, notes: string) => void
  onAssetNote: (checkAssetId: string, notes: string) => void
  onAssetWO: (checkAssetId: string, wo: string) => void
}

/** Sortable table of assets within a maintenance check. Rows expand to show tasks. */
export function CheckAssetTable({
  checkAssets,
  items,
  sortKey,
  sortDir,
  onToggleSort,
  expandedAssetId,
  onExpandAsset,
  canAct,
  checkStatus,
  onForceComplete,
  onItemResult,
  onItemNotes,
  onAssetNote,
  onAssetWO,
}: CheckAssetTableProps) {
  const sortedAssets = useMemo(() => {
    const arr = [...checkAssets]
    arr.sort((a, b) => {
      let aVal = ''
      let bVal = ''
      const aAsset = a.assets
      const bAsset = b.assets

      switch (sortKey) {
        case 'maximo_id':
          aVal = aAsset?.maximo_id ?? ''
          bVal = bAsset?.maximo_id ?? ''
          break
        case 'name':
          aVal = aAsset?.name ?? ''
          bVal = bAsset?.name ?? ''
          break
        case 'location':
          aVal = aAsset?.location ?? ''
          bVal = bAsset?.location ?? ''
          break
        case 'work_order':
          aVal = a.work_order_number ?? ''
          bVal = b.work_order_number ?? ''
          break
        case 'job_plan':
          aVal = (aAsset?.job_plans as { name: string } | null)?.name ?? ''
          bVal = (bAsset?.job_plans as { name: string } | null)?.name ?? ''
          break
        case 'completed': {
          const aDone = items.filter((i) => i.check_asset_id === a.id && i.result !== null).length
          const bDone = items.filter((i) => i.check_asset_id === b.id && i.result !== null).length
          return sortDir === 'asc' ? aDone - bDone : bDone - aDone
        }
        case 'notes':
          aVal = a.notes ?? ''
          bVal = b.notes ?? ''
          break
      }
      const cmp = aVal.localeCompare(bVal, undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [checkAssets, items, sortKey, sortDir])

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  if (checkAssets.length === 0) return null

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-bold text-eq-grey uppercase">
          Maintenance Check Assets ({checkAssets.length})
        </span>
        <span className="text-xs text-eq-grey">
          {checkAssets.filter((ca) => ca.status === 'completed').length}/{checkAssets.length} completed
        </span>
      </div>

      {/* Sortable header */}
      <div className="grid grid-cols-[80px_1fr_1fr_100px_100px_70px_80px] gap-1 px-3 py-2 bg-gray-50 border-b border-gray-200">
        {(
          [
            ['maximo_id', 'ID'],
            ['name', 'Name'],
            ['location', 'Location'],
            ['work_order', 'WO #'],
            ['job_plan', 'Maintenance Plan'],
            ['completed', 'Done'],
            ['notes', 'Notes'],
          ] as [SortKey, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => onToggleSort(key)}
            className="text-xs font-bold text-eq-grey uppercase text-left hover:text-eq-ink transition-colors truncate"
          >
            {label}
            {sortIndicator(key)}
          </button>
        ))}
      </div>

      {/* Asset rows */}
      <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
        {sortedAssets.map((ca) => (
          <AssetRow
            key={ca.id}
            ca={ca}
            items={items.filter((i) => i.check_asset_id === ca.id)}
            isExpanded={expandedAssetId === ca.id}
            onToggle={() => onExpandAsset(expandedAssetId === ca.id ? null : ca.id)}
            canAct={canAct}
            checkStatus={checkStatus}
            onForceComplete={() => onForceComplete(ca.id)}
            onItemResult={onItemResult}
            onItemNotes={onItemNotes}
            onAssetNote={(notes) => onAssetNote(ca.id, notes)}
            onAssetWO={(wo) => onAssetWO(ca.id, wo)}
          />
        ))}
      </div>
    </div>
  )
}
