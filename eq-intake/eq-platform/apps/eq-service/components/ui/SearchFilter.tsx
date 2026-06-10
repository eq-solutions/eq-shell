'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { Search } from 'lucide-react'

interface DropdownFilter {
  key: string
  label: string
  options: { value: string; label: string }[]
}

interface SearchFilterProps {
  placeholder?: string
  filters?: DropdownFilter[]
}

export function SearchFilter({ placeholder = 'Search...', filters = [] }: SearchFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const update = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    params.delete('page') // reset to page 1 on filter change
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }, [router, pathname, searchParams, startTransition])

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-eq-grey" />
        <input
          type="text"
          placeholder={placeholder}
          defaultValue={searchParams.get('search') ?? ''}
          onChange={(e) => update('search', e.target.value)}
          className="w-full h-10 pl-9 pr-4 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
        />
      </div>
      {filters.map((filter) => (
        <select
          key={filter.key}
          value={searchParams.get(filter.key) ?? ''}
          onChange={(e) => update(filter.key, e.target.value)}
          className="h-10 px-3 border border-gray-200 rounded-md text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
        >
          <option value="">{filter.label}</option>
          {filter.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ))}
    </div>
  )
}
