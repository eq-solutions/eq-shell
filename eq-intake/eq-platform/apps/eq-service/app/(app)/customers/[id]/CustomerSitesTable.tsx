'use client'

import { DataTable } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { Site } from '@/lib/types'

interface CustomerSitesTableProps {
  sites: Site[]
}

export function CustomerSitesTable({ sites }: CustomerSitesTableProps) {
  return (
    <DataTable<Site & Record<string, unknown>>
      columns={[
        {
          key: 'name',
          header: 'Site Name',
          render: (row) => (
            <a href={`/sites/${row.id}`} className="text-eq-sky hover:text-eq-deep font-medium">
              {row.name}
            </a>
          ),
        },
        {
          key: 'code',
          header: 'Code',
          render: (row) => row.code || '-',
        },
        {
          key: 'address',
          header: 'Address',
          render: (row) => {
            const addressParts = [
              row.address,
              row.city,
              row.state,
              row.postcode,
            ].filter(Boolean)
            return addressParts.length > 0 ? addressParts.join(', ') : '-'
          },
        },
        {
          key: 'is_active',
          header: 'Status',
          render: (row) => <StatusBadge status={row.is_active ? 'active' : 'inactive'} />,
        },
      ]}
      rows={sites as (Site & Record<string, unknown>)[]}
      emptyMessage="No sites found for this customer."
    />
  )
}
