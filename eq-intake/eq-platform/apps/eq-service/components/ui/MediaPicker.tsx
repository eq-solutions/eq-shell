'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Image as ImageIcon, ChevronDown } from 'lucide-react'
import type { MediaCategory } from '@/lib/types'

export type MediaSurface = 'light' | 'dark' | 'any'

interface MediaPickerProps {
  /** Currently selected media URL (controls the preview) */
  value: string | null
  /** Callback when user picks an image — receives the file_url */
  onChange: (url: string | null) => void
  /** Filter by category */
  category?: MediaCategory
  /** Filter by entity type + id */
  entityType?: 'customer' | 'site'
  entityId?: string
  /**
   * Filter by surface. Picks rows tagged for this surface plus 'any'.
   * Omit to show all surfaces.
   * 'light' → picks 'light' + 'any' (renders on light bg)
   * 'dark'  → picks 'dark'  + 'any' (renders on dark bg)
   * 'any'   → no surface filter applied
   */
  surface?: MediaSurface
  /**
   * Render mode for the preview thumbnail — controls background so transparent
   * logos are visible. 'dark' = slate bg behind preview for dark-surface variants.
   */
  previewBackground?: 'light' | 'dark'
  /** Placeholder text */
  placeholder?: string
  /** Disable the picker */
  disabled?: boolean
  /** Label for the field */
  label?: string
}

interface MediaOption {
  id: string
  name: string
  file_url: string
  /** Legacy single-valued — mirrored from categories[0]. */
  category: string
  /** Multi-category tags — migration 0056. May be null on very old rows. */
  categories: string[] | null
  content_type: string | null
  surface: MediaSurface
}

/**
 * Reusable dropdown picker that references images from the centralized media library.
 * Use on customer forms, site forms, report settings, etc. — single source of truth.
 */
export function MediaPicker({
  value,
  onChange,
  category,
  entityType,
  entityId,
  surface,
  previewBackground = 'light',
  placeholder = 'Select an image…',
  disabled = false,
  label,
}: MediaPickerProps) {
  const [options, setOptions] = useState<MediaOption[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  // Fetch media options on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const supabase = createClient()
      let query = supabase
        .from('media_library')
        .select('id, name, file_url, category, categories, content_type, surface')
        .eq('is_active', true)
        .order('name')

      // Multi-category match: an item shows up whenever one of its tagged
      // categories matches the requested one. `contains` maps to Postgres `@>`
      // — true when categories array contains the single requested value.
      if (category) query = query.contains('categories', [category])
      if (entityType) query = query.eq('entity_type', entityType)
      if (entityId) query = query.eq('entity_id', entityId)
      // Surface filter — 'any' rows always render on both light + dark pickers.
      if (surface === 'light') query = query.in('surface', ['light', 'any'])
      else if (surface === 'dark') query = query.in('surface', ['dark', 'any'])

      const { data } = await query
      if (!cancelled) {
        setOptions((data ?? []) as MediaOption[])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [category, entityType, entityId, surface])

  // Background class for preview thumbnails — transparent dark logos need
  // a slate backdrop to be visible.
  const previewBgClass = previewBackground === 'dark'
    ? 'bg-eq-ink'
    : 'bg-white'

  const selected = options.find(o => o.file_url === value)

  return (
    <div className="space-y-1">
      {label && <label className="block text-xs font-medium text-eq-grey">{label}</label>}

      <div className="relative">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-white text-left focus:outline-none focus:ring-2 focus:ring-eq-sky disabled:opacity-50"
        >
          {selected ? (
            <>
              <span className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${previewBgClass}`}>
                <img
                  src={selected.file_url}
                  alt={selected.name}
                  className="w-6 h-6 rounded object-contain"
                />
              </span>
              <span className="truncate flex-1 text-eq-ink">{selected.name}</span>
            </>
          ) : (
            <>
              <ImageIcon className="w-4 h-4 text-eq-grey flex-shrink-0" />
              <span className="truncate flex-1 text-eq-grey">{loading ? 'Loading…' : placeholder}</span>
            </>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-eq-grey flex-shrink-0" />
        </button>

        {/* Dropdown */}
        {open && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
            {/* Clear option */}
            <button
              type="button"
              className="w-full px-3 py-2 text-xs text-eq-grey hover:bg-gray-50 text-left border-b border-gray-100"
              onClick={() => { onChange(null); setOpen(false) }}
            >
              Clear selection
            </button>

            {options.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-eq-grey">
                No images available. Upload via Admin → Media Library.
              </div>
            ) : (
              options.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-eq-ice text-left ${
                    opt.file_url === value ? 'bg-eq-ice' : ''
                  }`}
                  onClick={() => { onChange(opt.file_url); setOpen(false) }}
                >
                  <span className={`w-8 h-8 rounded flex items-center justify-center flex-shrink-0 border border-gray-100 ${previewBgClass}`}>
                    <img
                      src={opt.file_url}
                      alt={opt.name}
                      className="w-8 h-8 rounded object-contain"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-eq-ink truncate">{opt.name}</p>
                    <p className="text-[10px] text-eq-grey">
                      {((opt.categories && opt.categories.length > 0) ? opt.categories : [opt.category])
                        .map((c) => c.replace('_', ' '))
                        .join(' · ')}
                      {opt.surface && opt.surface !== 'any' && (
                        <span className="ml-1 px-1 py-px rounded bg-gray-100 text-eq-grey">
                          {opt.surface}
                        </span>
                      )}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Preview */}
      {value && selected && (
        <div className="mt-1">
          <span className={`inline-flex w-16 h-16 rounded-md items-center justify-center border border-gray-200 ${previewBgClass}`}>
            <img
              src={value}
              alt={selected.name}
              className="w-16 h-16 rounded-md object-contain p-1"
            />
          </span>
        </div>
      )}
    </div>
  )
}
