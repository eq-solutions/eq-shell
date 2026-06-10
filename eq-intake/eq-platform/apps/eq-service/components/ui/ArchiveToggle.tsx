'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Archive } from 'lucide-react'

export function ArchiveToggle() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const showArchived = searchParams.get('show_archived') === '1'

  function toggle() {
    const params = new URLSearchParams(searchParams.toString())
    if (showArchived) {
      params.delete('show_archived')
    } else {
      params.set('show_archived', '1')
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <button
      onClick={toggle}
      className={`flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md border transition-colors ${
        showArchived
          ? 'bg-amber-50 border-amber-300 text-amber-700'
          : 'bg-white border-gray-200 text-eq-grey hover:text-eq-ink hover:border-gray-300'
      }`}
    >
      <Archive className="w-3.5 h-3.5" />
      {showArchived ? 'Showing archived' : 'Show archived'}
    </button>
  )
}
