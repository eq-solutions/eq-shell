'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Button } from './Button'

interface PaginationProps {
  page: number
  totalPages: number
  /**
   * Optional total row count. When supplied, renders a "Showing X–Y of Z"
   * line and enables the per-page size selector.
   */
  total?: number
  /** Current per-page size. Required when `total` is supplied. */
  perPage?: number
  /** Available page-size options. Defaults to [25, 50, 100, 250]. */
  perPageOptions?: number[]
}

export function Pagination({
  page,
  totalPages,
  total,
  perPage,
  perPageOptions = [25, 50, 100, 250],
}: PaginationProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [jumpValue, setJumpValue] = useState(String(page))

  useEffect(() => { setJumpValue(String(page)) }, [page])

  if (totalPages <= 1 && !total) return null

  function updateParams(mutate: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    router.push(`${pathname}?${params.toString()}`)
  }

  function go(newPage: number) {
    const clamped = Math.min(Math.max(1, newPage), Math.max(1, totalPages))
    updateParams((p) => p.set('page', String(clamped)))
  }

  function changePerPage(newPerPage: number) {
    updateParams((p) => {
      p.set('per_page', String(newPerPage))
      p.set('page', '1')
    })
  }

  function handleJumpSubmit(e: React.FormEvent) {
    e.preventDefault()
    const n = parseInt(jumpValue, 10)
    if (!Number.isNaN(n)) go(n)
  }

  // Showing X–Y of Z
  const showingLine = total !== undefined && perPage !== undefined
    ? (() => {
        if (total === 0) return 'No results'
        const from = (page - 1) * perPage + 1
        const to = Math.min(page * perPage, total)
        return `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`
      })()
    : `Page ${page} of ${totalPages}`

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
      <p className="text-sm text-eq-grey">{showingLine}</p>

      <div className="flex flex-wrap items-center gap-2">
        {total !== undefined && perPage !== undefined && (
          <div className="flex items-center gap-1.5 mr-2">
            <label htmlFor="per-page" className="text-xs text-eq-grey">Per page</label>
            <select
              id="per-page"
              value={perPage}
              onChange={(e) => changePerPage(Number(e.target.value))}
              className="h-8 px-2 border border-gray-200 rounded text-xs text-eq-ink bg-white"
            >
              {perPageOptions.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}

        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => go(1)}>« First</Button>
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => go(page - 1)}>Previous</Button>

        <form onSubmit={handleJumpSubmit} className="flex items-center gap-1">
          <input
            type="number"
            min={1}
            max={totalPages}
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            onBlur={handleJumpSubmit}
            className="w-14 h-8 px-2 border border-gray-200 rounded text-xs text-center text-eq-ink bg-white"
            aria-label="Jump to page"
          />
          <span className="text-xs text-eq-grey">/ {totalPages}</span>
        </form>

        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => go(page + 1)}>Next</Button>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => go(totalPages)}>Last »</Button>
      </div>
    </div>
  )
}
