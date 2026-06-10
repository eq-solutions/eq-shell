'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import type { Site } from '@/lib/types'

interface ReportFiltersProps {
  sites: (Pick<Site, 'id' | 'name'> & { customer_id?: string | null })[]
  customers: { id: string; name: string }[]
}

export function ReportFilters({ sites, customers }: ReportFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const customerId = searchParams.get('customer_id') ?? ''
  const siteId = searchParams.get('site_id') ?? ''
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''

  const updateParam = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    // If changing customer, clear site selection
    if (key === 'customer_id') {
      params.delete('site_id')
    }
    router.push(`/reports?${params.toString()}`)
  }, [router, searchParams])

  // Filter sites by selected customer
  const filteredSites = useMemo(() => {
    if (!customerId) return sites
    return sites.filter((s) => s.customer_id === customerId)
  }, [sites, customerId])

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={customerId}
        onChange={(e) => updateParam('customer_id', e.target.value)}
        className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
      >
        <option value="">All Customers</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <select
        value={siteId}
        onChange={(e) => updateParam('site_id', e.target.value)}
        className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
      >
        <option value="">All Sites</option>
        {filteredSites.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <div className="flex items-center gap-2 text-xs text-eq-grey">
        <span>From</span>
        <input
          type="date"
          value={from}
          onChange={(e) => updateParam('from', e.target.value)}
          className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
        />
        <span>To</span>
        <input
          type="date"
          value={to}
          onChange={(e) => updateParam('to', e.target.value)}
          className="h-9 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep"
        />
      </div>
      {(customerId || siteId || from || to) && (
        <button
          onClick={() => router.push('/reports')}
          className="text-xs text-eq-sky hover:text-eq-deep transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
