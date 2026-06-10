'use client'

import { ImportCSVModal } from '@/components/ui/ImportCSVModal'
import type { ImportCSVConfig } from '@/components/ui/ImportCSVModal'
import { importAssetsAction } from './actions'
import type { Site } from '@/lib/types'

interface ImportAssetsModalProps {
  open: boolean
  onClose: () => void
  sites: Pick<Site, 'id' | 'name'>[]
}

export function ImportAssetsModal({ open, onClose, sites }: ImportAssetsModalProps) {
  // Build site name→id lookup
  const siteLookup: Record<string, string> = {}
  for (const s of sites) siteLookup[s.name.toLowerCase()] = s.id

  const config: ImportCSVConfig<{
    name: string
    asset_type: string
    site_id: string
    manufacturer: string | null
    model: string | null
    serial_number: string | null
    maximo_id: string | null
    location: string | null
    install_date: string | null
  }> = {
    entityName: 'Assets',
    requiredColumns: ['name', 'asset_type', 'site'],
    optionalColumns: ['manufacturer', 'model', 'serial_number', 'maximo_id', 'location', 'install_date'],
    validate: (rows, columnMap) => {
      const errs: string[] = []
      if (columnMap['site']) {
        const siteNames = new Set(sites.map((s) => s.name.toLowerCase()))
        const unmapped = new Set<string>()
        for (const row of rows) {
          const siteName = row[columnMap['site']]?.toLowerCase()
          if (siteName && !siteNames.has(siteName)) unmapped.add(row[columnMap['site']])
        }
        if (unmapped.size > 0) {
          errs.push(`Unknown site names: ${[...unmapped].slice(0, 5).join(', ')}${unmapped.size > 5 ? ` (+${unmapped.size - 5} more)` : ''}`)
        }
      }
      return errs
    },
    mapRow: (row, columnMap) => {
      const name = row[columnMap['name']]?.trim()
      const asset_type = row[columnMap['asset_type']]?.trim()
      const site_id = siteLookup[row[columnMap['site']]?.toLowerCase()] ?? ''
      if (!name || !asset_type || !site_id) return null
      return {
        name,
        asset_type,
        site_id,
        manufacturer: row[columnMap['manufacturer']]?.trim() || null,
        model: row[columnMap['model']]?.trim() || null,
        serial_number: row[columnMap['serial_number']]?.trim() || null,
        maximo_id: row[columnMap['maximo_id']]?.trim() || null,
        location: row[columnMap['location']]?.trim() || null,
        install_date: row[columnMap['install_date']]?.trim() || null,
      }
    },
    importAction: importAssetsAction,
  }

  return <ImportCSVModal open={open} onClose={onClose} config={config} />
}
