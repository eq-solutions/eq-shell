'use client'

import { cn } from '@/lib/utils/cn'
import { ReactNode, useState, useMemo } from 'react'

export interface DataTableColumn<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  className?: string
  /** Enable a filter input under this column header. 'text' shows a text input, 'select' shows a dropdown of unique values. */
  filterable?: 'text' | 'select'
  /** For select filters: provide explicit options instead of auto-detecting from row data */
  filterOptions?: { value: string; label: string }[]
  /** Disable sorting on this column. Sorting is enabled by default for all columns. */
  sortable?: false
  /** Optional sort accessor — override which value to sort by (e.g. for computed/derived columns) */
  sortAccessor?: (row: T) => string | number | null | undefined
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  emptyMessage?: string
  className?: string
  /** Enable row selection checkboxes */
  selectable?: boolean
  /** Currently selected row IDs (controlled) */
  selectedIds?: Set<string>
  /** Callback when selection changes */
  onSelectionChange?: (ids: Set<string>) => void
  /** Function to extract a unique ID from each row. Defaults to row.id */
  getRowId?: (row: T) => string
  /** Callback when a row is clicked */
  onRowClick?: (row: T) => void
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  emptyMessage = 'No data to display.',
  className,
  selectable = false,
  selectedIds,
  onSelectionChange,
  getRowId = (row) => row.id as string,
  onRowClick,
}: DataTableProps<T>) {
  const hasFilters = columns.some(col => col.filterable)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)

  function toggleSort(key: string) {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  function setFilter(key: string, value: string) {
    setFilters(prev => {
      const next = { ...prev }
      if (value === '') {
        delete next[key]
      } else {
        next[key] = value
      }
      return next
    })
  }

  // Auto-detect select options from row data
  const selectOptions = useMemo(() => {
    const opts: Record<string, { value: string; label: string }[]> = {}
    for (const col of columns) {
      if (col.filterable === 'select' && !col.filterOptions) {
        const uniqueVals = new Set<string>()
        for (const row of rows) {
          const val = String(row[col.key] ?? '').trim()
          if (val) uniqueVals.add(val)
        }
        opts[col.key] = Array.from(uniqueVals).sort().map(v => ({ value: v, label: v }))
      }
    }
    return opts
  }, [columns, rows])

  // Apply filters
  const filteredRows = useMemo(() => {
    if (Object.keys(filters).length === 0) return rows
    return rows.filter(row => {
      for (const [key, filterVal] of Object.entries(filters)) {
        const col = columns.find(c => c.key === key)
        if (!col) continue
        const cellVal = String(row[key] ?? '').toLowerCase()
        if (col.filterable === 'select') {
          if (cellVal !== filterVal.toLowerCase()) return false
        } else {
          if (!cellVal.includes(filterVal.toLowerCase())) return false
        }
      }
      return true
    })
  }, [rows, filters, columns])

  // Apply sorting
  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows
    const col = columns.find(c => c.key === sort.key)
    if (!col) return filteredRows
    const accessor = col.sortAccessor ?? ((row: T) => row[sort.key] as string | number | null | undefined)
    const dir = sort.dir === 'asc' ? 1 : -1
    const copy = [...filteredRows]
    copy.sort((a, b) => {
      const av = accessor(a)
      const bv = accessor(b)
      // null/undefined sort last
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      const as = String(av).toLowerCase()
      const bs = String(bv).toLowerCase()
      if (as < bs) return -1 * dir
      if (as > bs) return 1 * dir
      return 0
    })
    return copy
  }, [filteredRows, sort, columns])

  const allIds = sortedRows.map(getRowId)
  const allSelected = sortedRows.length > 0 && selectedIds ? allIds.every((id) => selectedIds.has(id)) : false
  const someSelected = selectedIds ? allIds.some((id) => selectedIds.has(id)) : false

  function toggleAll() {
    if (!onSelectionChange) return
    if (allSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(allIds))
    }
  }

  function toggleRow(id: string) {
    if (!onSelectionChange || !selectedIds) return
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectionChange(next)
  }

  const activeFilterCount = Object.keys(filters).length

  return (
    <div className={cn('w-full overflow-x-auto border border-gray-200 rounded-lg', className)}>
      <table className="w-full text-sm">
        <thead className="bg-eq-ice">
          <tr>
            {selectable && (
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded border-gray-300 text-eq-sky focus:ring-eq-sky cursor-pointer"
                />
              </th>
            )}
            {columns.map((col) => {
              const canSort = col.sortable !== false
              const isSorted = sort?.key === col.key
              return (
                <th
                  key={col.key}
                  className={cn(
                    'text-left px-4 py-2 text-xs font-bold text-eq-deep uppercase tracking-wide',
                    canSort && 'cursor-pointer select-none hover:bg-eq-ice/70',
                    col.className
                  )}
                  onClick={canSort ? () => toggleSort(col.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {canSort && (
                      <span className="text-[10px] text-eq-grey/60 leading-none">
                        {isSorted ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    )}
                  </span>
                </th>
              )
            })}
          </tr>
          {/* Filter row */}
          {hasFilters && (
            <tr className="bg-white border-t border-gray-100">
              {selectable && <th className="w-10 px-3 py-1" />}
              {columns.map((col) => (
                <th key={`filter-${col.key}`} className="px-4 py-1.5">
                  {col.filterable === 'text' && (
                    <input
                      type="text"
                      value={filters[col.key] ?? ''}
                      onChange={e => setFilter(col.key, e.target.value)}
                      placeholder={`Filter...`}
                      className="w-full px-2 py-1 text-xs font-normal text-eq-ink bg-gray-50 border border-gray-200 rounded focus:outline-none focus:border-eq-sky"
                    />
                  )}
                  {col.filterable === 'select' && (
                    <select
                      value={filters[col.key] ?? ''}
                      onChange={e => setFilter(col.key, e.target.value)}
                      className="w-full px-2 py-1 text-xs font-normal text-eq-ink bg-gray-50 border border-gray-200 rounded focus:outline-none focus:border-eq-sky"
                    >
                      <option value="">All</option>
                      {(col.filterOptions ?? selectOptions[col.key] ?? []).map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                className="px-4 py-6 text-center text-eq-grey text-sm"
              >
                {activeFilterCount > 0 ? `No results match your filters.` : emptyMessage}
              </td>
            </tr>
          ) : (
            sortedRows.map((row, i) => {
              const rowId = getRowId(row)
              const isSelected = selectable && selectedIds?.has(rowId)
              return (
                <tr
                  key={rowId || i}
                  className={cn(
                    'border-t border-gray-100 hover:bg-gray-50',
                    isSelected && 'bg-eq-ice/40',
                    onRowClick && 'cursor-pointer'
                  )}
                  onClick={() => onRowClick?.(row)}
                >
                  {selectable && (
                    <td className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={!!isSelected}
                        onChange={() => toggleRow(rowId)}
                        className="w-4 h-4 rounded border-gray-300 text-eq-sky focus:ring-eq-sky cursor-pointer"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn('px-4 py-3 text-eq-ink', col.className)}
                    >
                      {col.render ? col.render(row) : String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
