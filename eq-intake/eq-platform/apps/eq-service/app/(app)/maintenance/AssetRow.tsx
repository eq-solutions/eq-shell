'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCheck } from 'lucide-react'
import { TaskRow } from './TaskRow'
import type { MaintenanceCheckItem, CheckAsset, CheckStatus, CheckItemResult } from '@/lib/types'

export interface CheckAssetWithDetails extends CheckAsset {
  assets?: {
    name: string
    maximo_id: string | null
    location: string | null
    job_plans?: { name: string } | null
  } | null
}

interface AssetRowProps {
  ca: CheckAssetWithDetails
  items: MaintenanceCheckItem[]
  isExpanded: boolean
  onToggle: () => void
  canAct: boolean
  checkStatus: CheckStatus
  onForceComplete: () => void
  onItemResult: (itemId: string, result: CheckItemResult | null) => void
  onItemNotes: (itemId: string, notes: string) => void
  onAssetNote: (notes: string) => void
  onAssetWO: (wo: string) => void
}

/** Single asset row in the check detail table. Click to expand its task list. */
export function AssetRow({
  ca,
  items,
  isExpanded,
  onToggle,
  canAct,
  checkStatus,
  onForceComplete,
  onItemResult,
  onItemNotes,
  onAssetNote,
  onAssetWO,
}: AssetRowProps) {
  const [editingWO, setEditingWO] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)

  const asset = ca.assets
  const doneCount = items.filter((i) => i.result !== null).length
  const total = items.length
  const allDone = doneCount === total && total > 0
  const jpName = (asset?.job_plans as { name: string } | null)?.name ?? '—'

  return (
    <div>
      {/* Main row */}
      <div
        className={`grid grid-cols-[80px_1fr_1fr_100px_100px_70px_80px] gap-1 px-3 py-2 text-xs items-center cursor-pointer transition-colors ${
          isExpanded ? 'bg-eq-ice/40' : 'hover:bg-gray-50'
        } ${allDone ? 'opacity-60' : ''}`}
        onClick={onToggle}
      >
        <span className="font-mono text-eq-ink flex items-center gap-1">
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-eq-grey" />
          ) : (
            <ChevronRight className="w-3 h-3 text-eq-grey" />
          )}
          {asset?.maximo_id ?? '—'}
        </span>
        <span className="text-eq-ink truncate">{asset?.name ?? '—'}</span>
        <span className="text-eq-grey truncate">{asset?.location ?? '—'}</span>

        {/* WO # — editable */}
        <span onClick={(e) => e.stopPropagation()}>
          {editingWO ? (
            <input
              defaultValue={ca.work_order_number ?? ''}
              onBlur={(e) => {
                onAssetWO(e.target.value)
                setEditingWO(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onAssetWO((e.target as HTMLInputElement).value)
                  setEditingWO(false)
                }
              }}
              className="w-full h-6 px-1 border border-eq-sky rounded text-xs font-mono bg-white focus:outline-none"
              autoFocus
            />
          ) : (
            <span
              className={`cursor-text ${ca.work_order_number ? 'text-eq-ink font-mono' : 'text-gray-300'}`}
              onClick={() => canAct && setEditingWO(true)}
            >
              {ca.work_order_number || '---'}
            </span>
          )}
        </span>

        <span className="text-eq-grey">{jpName}</span>

        {/* Completed indicator */}
        <span className={allDone ? 'text-green-600 font-medium' : 'text-eq-grey'}>
          {allDone ? 'Yes' : `${doneCount}/${total}`}
        </span>

        {/* Notes — editable */}
        <span onClick={(e) => e.stopPropagation()}>
          {editingNotes ? (
            <input
              defaultValue={ca.notes ?? ''}
              onBlur={(e) => {
                onAssetNote(e.target.value)
                setEditingNotes(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onAssetNote((e.target as HTMLInputElement).value)
                  setEditingNotes(false)
                }
              }}
              className="w-full h-6 px-1 border border-eq-sky rounded text-xs bg-white focus:outline-none"
              autoFocus
            />
          ) : (
            <span
              className={`cursor-text truncate ${ca.notes ? 'text-eq-ink' : 'text-gray-300'}`}
              onClick={() => canAct && setEditingNotes(true)}
            >
              {ca.notes || '---'}
            </span>
          )}
        </span>
      </div>

      {/* Expanded: maintenance plan items table */}
      {isExpanded && (
        <div className="bg-white border-t border-gray-100 px-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-eq-grey uppercase">
              Maintenance Plan Items — {jpName} ({items.length} tasks)
            </h4>
            {canAct && !allDone && (
              <button
                onClick={onForceComplete}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-50 rounded hover:bg-green-100 transition-colors"
              >
                <CheckCheck className="w-3 h-3" /> Force Complete All
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="text-xs text-eq-grey">No tasks for this asset.</p>
          ) : (
            <div className="border border-gray-200 rounded overflow-hidden">
              {/* Task table header */}
              <div className="grid grid-cols-[1fr_80px_1fr] gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-200 text-xs font-bold text-eq-grey uppercase">
                <span>Task</span>
                <span>Result</span>
                <span>Comments</span>
              </div>
              <div className="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">
                {items.map((item) => (
                  <TaskRow
                    key={item.id}
                    item={item}
                    checkStatus={checkStatus}
                    canAct={canAct}
                    onResult={onItemResult}
                    onNotes={onItemNotes}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
