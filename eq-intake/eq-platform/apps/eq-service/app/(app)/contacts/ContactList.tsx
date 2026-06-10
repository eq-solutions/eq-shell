'use client'

import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useTransition } from 'react'
import { DataTable } from '@/components/ui/DataTable'
import type { DataTableColumn } from '@/components/ui/DataTable'
import { SearchFilter } from '@/components/ui/SearchFilter'
import { ExportButton } from '@/components/ui/ExportButton'
import { Button } from '@/components/ui/Button'
import { exportToCsv } from '@/lib/utils/csv-export'
import { Mail, Phone, Star, Building2, MapPin, Upload } from 'lucide-react'
import { ImportCSVModal } from '@/components/ui/ImportCSVModal'
import type { ImportCSVConfig } from '@/components/ui/ImportCSVModal'
import { importContactsAction, type ContactImportRow } from './actions'

/**
 * CSV import config for contacts. Required: customer + name. Optional: site,
 * email, phone, role. Site is the disambiguator between a customer-level
 * contact and a site-level one — leave site blank for customer contacts.
 */
const contactImportConfig: ImportCSVConfig<ContactImportRow> = {
  entityName: 'Contacts',
  requiredColumns: ['customer', 'name'],
  optionalColumns: ['site', 'email', 'phone', 'role'],
  mapRow: (row, columnMap) => {
    const customer = row[columnMap['customer']]?.trim()
    const name = row[columnMap['name']]?.trim()
    if (!customer || !name) return null
    return {
      customer,
      site: row[columnMap['site']]?.trim() || null,
      name,
      email: row[columnMap['email']]?.trim() || null,
      phone: row[columnMap['phone']]?.trim() || null,
      role: row[columnMap['role']]?.trim() || null,
    }
  },
  importAction: importContactsAction,
}

export interface MasterContact {
  id: string
  kind: 'customer' | 'site'
  name: string
  role: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
  parentName: string
  parentHref: string
  createdAt: string
}

interface ContactListProps {
  contacts: MasterContact[]
  kind: 'all' | 'customer' | 'site'
  primaryOnly: boolean
  isAdmin: boolean
}

export function ContactList({ contacts, kind, primaryOnly, isAdmin }: ContactListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()
  const [importOpen, setImportOpen] = useState(false)

  function togglePrimaryOnly() {
    const params = new URLSearchParams(searchParams.toString())
    if (primaryOnly) {
      params.delete('primary_only')
    } else {
      params.set('primary_only', '1')
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  const columns: DataTableColumn<MasterContact & Record<string, unknown>>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-eq-sky">{row.name}</span>
          {row.isPrimary && (
            <span title="Primary contact" className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
              <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
              Primary
            </span>
          )}
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (row) => row.role ?? <span className="text-eq-grey">—</span> },
    {
      key: 'email',
      header: 'Email',
      render: (row) => row.email
        ? <a href={`mailto:${row.email}`} className="text-eq-deep hover:underline inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}><Mail className="w-3 h-3" />{row.email}</a>
        : <span className="text-eq-grey">—</span>,
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (row) => row.phone
        ? <a href={`tel:${row.phone}`} className="text-eq-deep hover:underline inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}><Phone className="w-3 h-3" />{row.phone}</a>
        : <span className="text-eq-grey">—</span>,
    },
    {
      key: 'parentName',
      header: 'Linked To',
      render: (row) => (
        <Link
          href={row.parentHref}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 text-eq-deep hover:underline"
        >
          {row.kind === 'customer'
            ? <Building2 className="w-3.5 h-3.5" />
            : <MapPin className="w-3.5 h-3.5" />}
          <span>{row.parentName}</span>
        </Link>
      ),
    },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <SearchFilter
            placeholder="Search name, role, email, phone..."
            filters={[
              {
                key: 'kind',
                label: 'All types',
                options: [
                  { value: 'customer', label: 'Customer contacts' },
                  { value: 'site', label: 'Site contacts' },
                ],
              },
            ]}
          />
          <label className="inline-flex items-center gap-2 text-sm text-eq-ink cursor-pointer select-none">
            <input
              type="checkbox"
              checked={primaryOnly}
              onChange={togglePrimaryOnly}
              className="rounded border-gray-300 text-eq-sky focus:ring-eq-sky"
            />
            Primary only
          </label>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
          )}
          <ExportButton onClick={() => exportToCsv(
            contacts,
            [
              { key: 'kind', header: 'Type' },
              { key: 'name', header: 'Name' },
              { key: 'role', header: 'Role' },
              { key: 'email', header: 'Email' },
              { key: 'phone', header: 'Phone' },
              { key: 'parentName', header: 'Linked To' },
              { key: 'isPrimary', header: 'Primary', format: (r) => r.isPrimary ? 'Yes' : 'No' },
            ],
            `contacts-export-${new Date().toISOString().slice(0, 10)}`
          )} />
        </div>
      </div>

      <ImportCSVModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        config={contactImportConfig}
      />

      {contacts.length === 0 ? (
        <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
          <p className="text-eq-grey text-sm">
            {kind === 'site'
              ? 'No site contacts match your filters.'
              : kind === 'customer'
                ? 'No customer contacts match your filters.'
                : 'No contacts yet. Add contacts from each customer or site page.'}
          </p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={contacts as unknown as Array<MasterContact & Record<string, unknown>>}
          emptyMessage="No contacts match your search."
          onRowClick={(row) => router.push(row.parentHref)}
        />
      )}
    </>
  )
}
