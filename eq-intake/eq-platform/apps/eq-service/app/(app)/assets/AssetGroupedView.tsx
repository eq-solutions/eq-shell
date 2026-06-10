'use client'

import { useState, useMemo, useTransition } from 'react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { cn } from '@/lib/utils/cn'
import { ChevronDown, ChevronRight, MapPin, Layers, FileText, Archive } from 'lucide-react'
import type { Asset, JobPlan } from '@/lib/types'
import { toggleAssetActiveAction } from './actions'
import { useConfirm } from '@/components/ui/ConfirmDialog'

interface AssetWithSite extends Asset {
  sites: { name: string } | null
  job_plans: { name: string; code: string | null } | null
}

interface AssetGroupedViewProps {
  assets: AssetWithSite[]
  onAssetClick: (asset: AssetWithSite) => void
  canWrite?: boolean
}

interface GroupNode {
  label: string
  count: number
  children?: GroupNode[]
  assets?: AssetWithSite[]
}

export function AssetGroupedView({ assets, onAssetClick, canWrite = false }: AssetGroupedViewProps) {
  const tree = useMemo(() => {
    // Group: Site > Location > Maintenance Plan
    const siteMap = new Map<string, AssetWithSite[]>()
    for (const asset of assets) {
      const siteName = asset.sites?.name ?? 'Unassigned'
      if (!siteMap.has(siteName)) siteMap.set(siteName, [])
      siteMap.get(siteName)!.push(asset)
    }

    const siteNodes: GroupNode[] = []
    for (const [siteName, siteAssets] of Array.from(siteMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      // Group by location
      const locMap = new Map<string, AssetWithSite[]>()
      for (const asset of siteAssets) {
        const loc = asset.location?.trim() || 'No Location'
        if (!locMap.has(loc)) locMap.set(loc, [])
        locMap.get(loc)!.push(asset)
      }

      const locNodes: GroupNode[] = []
      for (const [locName, locAssets] of Array.from(locMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        // Group by maintenance plan
        const jpMap = new Map<string, AssetWithSite[]>()
        for (const asset of locAssets) {
          const jp = asset.job_plans?.name ?? 'No Maintenance Plan'
          if (!jpMap.has(jp)) jpMap.set(jp, [])
          jpMap.get(jp)!.push(asset)
        }

        const jpNodes: GroupNode[] = []
        for (const [jpName, jpAssets] of Array.from(jpMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
          jpNodes.push({ label: jpName, count: jpAssets.length, assets: jpAssets })
        }

        locNodes.push({ label: locName, count: locAssets.length, children: jpNodes })
      }

      siteNodes.push({ label: siteName, count: siteAssets.length, children: locNodes })
    }

    return siteNodes
  }, [assets])

  if (assets.length === 0) return null

  return (
    <div className="space-y-2">
      {tree.map((site) => (
        <SiteGroup key={site.label} node={site} onAssetClick={onAssetClick} canWrite={canWrite} />
      ))}
    </div>
  )
}

function SiteGroup({ node, onAssetClick, canWrite }: { node: GroupNode; onAssetClick: (a: AssetWithSite) => void; canWrite: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-eq-ice hover:bg-eq-ice/80 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-4 h-4 text-eq-deep" /> : <ChevronRight className="w-4 h-4 text-eq-deep" />}
        <MapPin className="w-4 h-4 text-eq-sky" />
        <span className="font-semibold text-eq-deep">{node.label}</span>
        <span className="text-xs text-eq-grey ml-auto">{node.count} asset{node.count !== 1 ? 's' : ''}</span>
      </button>
      {open && node.children && (
        <div className="pl-4">
          {node.children.map((loc) => (
            <LocationGroup key={loc.label} node={loc} onAssetClick={onAssetClick} canWrite={canWrite} />
          ))}
        </div>
      )}
    </div>
  )
}

function LocationGroup({ node, onAssetClick, canWrite }: { node: GroupNode; onAssetClick: (a: AssetWithSite) => void; canWrite: boolean }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="border-t border-gray-100">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-eq-grey" /> : <ChevronRight className="w-3.5 h-3.5 text-eq-grey" />}
        <Layers className="w-3.5 h-3.5 text-eq-grey" />
        <span className="font-medium text-eq-ink text-sm">{node.label}</span>
        <span className="text-xs text-eq-grey ml-auto">{node.count}</span>
      </button>
      {open && node.children && (
        <div className="pl-4">
          {node.children.map((jp) => (
            <JobPlanGroup key={jp.label} node={jp} onAssetClick={onAssetClick} canWrite={canWrite} />
          ))}
        </div>
      )}
    </div>
  )
}

function JobPlanGroup({ node, onAssetClick, canWrite }: { node: GroupNode; onAssetClick: (a: AssetWithSite) => void; canWrite: boolean }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [errorId, setErrorId] = useState<string | null>(null)
  const confirm = useConfirm()

  async function handleArchive(e: React.MouseEvent, asset: AssetWithSite) {
    e.stopPropagation()
    const ok = await confirm({
      title: `Archive asset "${asset.name}"?`,
      message: 'It will move to /admin/archive and auto-delete after the grace period unless restored.',
      confirmLabel: 'Archive',
    })
    if (!ok) return
    setErrorId(null)
    startTransition(async () => {
      const res = await toggleAssetActiveAction(asset.id, false)
      if (!res.success) setErrorId(asset.id)
    })
  }

  return (
    <div className="border-t border-gray-50">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-gray-50 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-3 h-3 text-eq-grey" /> : <ChevronRight className="w-3 h-3 text-eq-grey" />}
        <FileText className="w-3 h-3 text-eq-grey" />
        <span className="text-sm text-eq-ink">{node.label}</span>
        <span className="text-xs text-eq-grey ml-auto">{node.count}</span>
      </button>
      {open && node.assets && (
        <div className="px-4 pb-2">
          <div className="grid gap-1.5">
            {node.assets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-start gap-3 px-3 py-2 rounded bg-gray-50 hover:bg-eq-ice/50 transition-colors text-sm"
              >
                <button
                  onClick={() => onAssetClick(asset)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="font-medium text-eq-ink truncate">{asset.name} — {asset.asset_type || ''}</p>
                  <p className="font-mono text-xs text-eq-grey mt-0.5">{asset.maximo_id ?? '—'}</p>
                  {errorId === asset.id && (
                    <p className="text-xs text-red-500 mt-1">Failed to archive.</p>
                  )}
                </button>
                <StatusBadge status={asset.is_active ? 'active' : 'inactive'} />
                {canWrite && asset.is_active && (
                  <button
                    type="button"
                    onClick={(e) => handleArchive(e, asset)}
                    disabled={pending}
                    title="Archive asset"
                    className="p-1 text-eq-grey hover:text-red-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
