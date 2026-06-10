'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search as SearchIcon, Package, MapPin, Building2, Shield, CircuitBoard, Wrench } from 'lucide-react'

interface SearchResult {
  type: string
  id: string
  title: string
  subtitle: string
  href: string
}

const typeIcons: Record<string, typeof SearchIcon> = {
  Asset: Package,
  Site: MapPin,
  Customer: Building2,
  'ACB Test': Shield,
  'NSX Test': CircuitBoard,
  Instrument: Wrench,
}

const typeBadgeColours: Record<string, string> = {
  Asset: 'bg-blue-50 text-blue-700',
  Site: 'bg-green-50 text-green-700',
  Customer: 'bg-purple-50 text-purple-700',
  'ACB Test': 'bg-amber-50 text-amber-700',
  'NSX Test': 'bg-orange-50 text-orange-700',
  Instrument: 'bg-teal-50 text-teal-700',
}

interface SearchResultsProps {
  query: string
  results: SearchResult[]
}

export function SearchResults({ query, results }: SearchResultsProps) {
  const router = useRouter()
  const [input, setInput] = useState(query)

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (input.trim()) {
      router.push(`/search?q=${encodeURIComponent(input.trim())}`)
    }
  }

  function handlePromptClick(prompt: string) {
    router.push(`/search?q=${encodeURIComponent(prompt)}`)
  }

  return (
    <>
      <form onSubmit={handleSearch} className="flex items-center gap-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-eq-grey" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search sites, assets, customers, tests..."
            className="w-full h-12 pl-11 pr-4 border border-gray-200 rounded-lg text-sm text-eq-ink bg-white focus:outline-none focus:border-eq-deep focus:ring-2 focus:ring-eq-sky/20"
            autoFocus
          />
        </div>
        <button
          type="submit"
          className="h-12 px-6 rounded-lg bg-eq-sky text-white font-medium text-sm hover:bg-eq-deep transition-colors"
        >
          Search
        </button>
      </form>

      {!query && (
        <div className="mt-8 p-6 border border-gray-200 rounded-lg bg-gray-50">
          <p className="text-sm font-medium text-eq-ink mb-3">Try searching for:</p>
          <div className="flex flex-wrap gap-2">
            {['SY4', 'ACB', 'UPS', 'INSTR001'].map((prompt) => (
              <button
                key={prompt}
                onClick={() => handlePromptClick(prompt)}
                className="px-3 py-1.5 rounded-full bg-white border border-gray-200 text-sm text-eq-ink hover:border-eq-sky hover:bg-eq-ice/30 transition-colors font-medium"
              >
                {prompt}
              </button>
            ))}
          </div>
          <p className="text-xs text-eq-grey mt-3">Examples: site codes, test types, asset types, Maximo IDs</p>
        </div>
      )}

      {query && (
        <div>
          <p className="text-sm text-eq-grey mb-4">
            {results.length} result{results.length !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
          </p>
          {results.length === 0 ? (
            <div className="text-center py-12 border border-gray-200 rounded-lg bg-white">
              <p className="text-eq-grey text-sm">No results found. Try a different search term.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((r) => {
                const Icon = typeIcons[r.type] ?? SearchIcon
                const badgeCls = typeBadgeColours[r.type] ?? 'bg-gray-50 text-gray-700'
                return (
                  <a
                    key={`${r.type}-${r.id}`}
                    href={r.href}
                    className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg bg-white hover:border-eq-sky/40 hover:shadow-sm transition-all"
                  >
                    <Icon className="w-5 h-5 text-eq-grey flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-eq-ink truncate">{r.title}</p>
                      {r.subtitle && <p className="text-xs text-eq-grey mt-0.5 truncate">{r.subtitle}</p>}
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${badgeCls}`}>{r.type}</span>
                  </a>
                )
              })}
            </div>
          )}
        </div>
      )}
    </>
  )
}
