'use client'

import { useState, useRef } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Upload, Trash2, Image as ImageIcon, Search, X } from 'lucide-react'
import { uploadMediaAction, deleteMediaAction, updateMediaAction } from './actions'
import { events as analyticsEvents } from '@/lib/analytics'
import type { MediaCategory } from '@/lib/types'
import { useConfirm } from '@/components/ui/ConfirmDialog'

type MediaSurface = 'light' | 'dark' | 'any'

interface MediaItem {
  id: string
  name: string
  /** Legacy single-valued — still present on rows; mirrored from categories[0]. */
  category: string
  /** Multi-category tags (migration 0056). Preferred for display + filtering. */
  categories?: string[] | null
  entity_type: string | null
  entity_id: string | null
  surface?: MediaSurface | null
  file_url: string
  file_name: string
  content_type: string | null
  file_size: number | null
  created_at: string
}

interface Props {
  media: MediaItem[]
  customers: { id: string; name: string }[]
  sites: { id: string; name: string }[]
}

const CATEGORIES: { value: MediaCategory; label: string; hint: string }[] = [
  { value: 'customer_logo', label: 'Customer Logo', hint: 'Shown against customer records' },
  { value: 'site_photo', label: 'Site Photo', hint: 'Used on site cards + report covers' },
  { value: 'report_image', label: 'Report Image', hint: 'Appears in report logo slots' },
  { value: 'general', label: 'General', hint: 'App banner, email headers, misc.' },
]

/** Normalise: prefer categories[] when populated, fall back to single category. */
function cats(item: Pick<MediaItem, 'category' | 'categories'>): string[] {
  if (item.categories && item.categories.length > 0) return item.categories
  return item.category ? [item.category] : []
}

export function MediaLibraryClient({ media: initialMedia, customers, sites }: Props) {
  const confirm = useConfirm()
  const [media, setMedia] = useState(initialMedia)
  const [showUpload, setShowUpload] = useState(false)
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [filterEntity, setFilterEntity] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')

  // Upload form state — categories is now a Set for multi-select.
  const [uploadName, setUploadName] = useState('')
  const [uploadCategories, setUploadCategories] = useState<Set<MediaCategory>>(new Set(['general']))
  const [uploadEntityType, setUploadEntityType] = useState<string>('')
  const [uploadEntityId, setUploadEntityId] = useState<string>('')
  const [uploadSurface, setUploadSurface] = useState<MediaSurface>('any')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Edit modal state
  const [editing, setEditing] = useState<MediaItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editCategories, setEditCategories] = useState<Set<MediaCategory>>(new Set())
  const [editEntityType, setEditEntityType] = useState<string>('')
  const [editEntityId, setEditEntityId] = useState<string>('')
  const [editSurface, setEditSurface] = useState<MediaSurface>('any')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  }

  function openEdit(item: MediaItem) {
    setEditing(item)
    setEditName(item.name)
    setEditCategories(new Set(cats(item) as MediaCategory[]))
    setEditEntityType(item.entity_type ?? '')
    setEditEntityId(item.entity_id ?? '')
    setEditSurface((item.surface ?? 'any') as MediaSurface)
    setEditError(null)
  }

  function closeEdit() {
    setEditing(null)
    setEditError(null)
  }

  async function handleSaveEdit() {
    if (!editing) return
    const trimmed = editName.trim()
    if (!trimmed) {
      setEditError('Name is required.')
      return
    }
    if (editCategories.size === 0) {
      setEditError('Select at least one category.')
      return
    }
    setSavingEdit(true)
    setEditError(null)
    const categoriesArr = Array.from(editCategories) as MediaCategory[]

    // Race the server action against a 20s timeout so the button never
    // gets stuck on "Saving…" forever — happens when the network blips
    // mid-action or a stale-bundle deploy causes the action ID lookup
    // to silently mismatch (the client awaits a Promise that never
    // resolves because the matching server function is gone).
    const TIMEOUT_MS = 20_000
    let timedOut = false
    const timeoutPromise = new Promise<{ success: false; error: string }>((resolve) => {
      setTimeout(() => {
        timedOut = true
        resolve({
          success: false,
          error: 'Server didn\'t respond within 20 seconds. Try a hard refresh (Ctrl+Shift+R) and try again.',
        })
      }, TIMEOUT_MS)
    })

    let result: Awaited<ReturnType<typeof updateMediaAction>>
    try {
      result = await Promise.race([
        updateMediaAction(editing.id, {
          name: trimmed,
          categories: categoriesArr,
          entity_type: editEntityType || null,
          entity_id: editEntityId || null,
          surface: editSurface,
        }),
        timeoutPromise,
      ])
    } catch (err) {
      // Server action threw an unhandled error (e.g. UnrecognizedActionError
      // from a stale bundle). Surface it instead of swallowing.
      result = {
        success: false,
        error: err instanceof Error ? err.message : 'Save failed: unknown client-side error.',
      }
    }
    setSavingEdit(false)
    if (timedOut) {
      setEditError(result.error ?? 'Save timed out.')
      return
    }
    if (!result.success) {
      setEditError(result.error ?? 'Update failed.')
      return
    }
    setMedia((prev) =>
      prev.map((m) =>
        m.id === editing.id
          ? {
              ...m,
              name: trimmed,
              category: categoriesArr[0],
              categories: categoriesArr,
              entity_type: editEntityType || null,
              entity_id: editEntityId || null,
              surface: editSurface,
            }
          : m,
      ),
    )
    closeEdit()
  }

  // Filtered media — category filter now matches if ANY of the item's categories equal the filter.
  const filtered = media.filter((item) => {
    if (filterCategory && !cats(item).includes(filterCategory)) return false
    if (filterEntity) {
      if (filterEntity.startsWith('customer:')) {
        if (item.entity_type !== 'customer' || item.entity_id !== filterEntity.replace('customer:', '')) return false
      } else if (filterEntity.startsWith('site:')) {
        if (item.entity_type !== 'site' || item.entity_id !== filterEntity.replace('site:', '')) return false
      }
    }
    if (
      searchTerm &&
      !item.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !item.file_name.toLowerCase().includes(searchTerm.toLowerCase())
    )
      return false
    return true
  })

  async function handleUpload() {
    if (!uploadFile || !uploadName.trim()) return
    if (uploadCategories.size === 0) {
      setUploadError('Select at least one category.')
      return
    }
    setUploading(true)
    setUploadError(null)

    const formData = new FormData()
    formData.append('file', uploadFile)
    formData.append('name', uploadName.trim())
    for (const c of uploadCategories) formData.append('categories', c)
    formData.append('surface', uploadSurface)
    if (uploadEntityType) formData.append('entity_type', uploadEntityType)
    if (uploadEntityId) formData.append('entity_id', uploadEntityId)

    const result = await uploadMediaAction(formData)
    setUploading(false)

    if (!result.success) {
      setUploadError(result.error ?? 'Upload failed.')
      return
    }

    analyticsEvents.mediaUploaded({
      media_type: uploadFile.type || 'unknown',
      file_size_mb: Number((uploadFile.size / (1024 * 1024)).toFixed(3)),
    })

    setUploadName('')
    setUploadCategories(new Set(['general']))
    setUploadEntityType('')
    setUploadEntityId('')
    setUploadSurface('any')
    setUploadFile(null)
    if (fileRef.current) fileRef.current.value = ''
    setShowUpload(false)

    window.location.reload()
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Remove from media library?',
      message: 'The image will be deleted from the library. References in past records keep working.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    setDeletingId(id)
    const result = await deleteMediaAction(id)
    setDeletingId(null)
    if (result.success) {
      setMedia((prev) => prev.filter((m) => m.id !== id))
    }
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const entityOptions = [
    ...customers.map((c) => ({ value: `customer:${c.id}`, label: `Customer: ${c.name}`, type: 'customer', id: c.id })),
    ...sites.map((s) => ({ value: `site:${s.id}`, label: `Site: ${s.name}`, type: 'site', id: s.id })),
  ]

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-eq-grey" />
            <input
              type="text"
              placeholder="Search images…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-eq-sky"
            title="Filter by category — matches items tagged with this category"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            value={filterEntity}
            onChange={(e) => setFilterEntity(e.target.value)}
            className="text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-eq-sky"
          >
            <option value="">All Entities</option>
            {entityOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" onClick={() => setShowUpload(!showUpload)}>
          <Upload className="w-3 h-3 mr-1" /> Upload
        </Button>
      </div>

      {/* Upload form */}
      {showUpload && (
        <Card className="border-eq-sky">
          <h3 className="text-sm font-bold text-eq-ink mb-3">Upload New Image</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-eq-grey mb-1">Name *</label>
              <input
                type="text"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="e.g. Equinix Logo, SY1 Front Entrance"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-eq-grey mb-1">Surface</label>
              <select
                value={uploadSurface}
                onChange={(e) => setUploadSurface(e.target.value as MediaSurface)}
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
              >
                <option value="any">Any surface (works on light + dark)</option>
                <option value="light">Light only (dark mark on white)</option>
                <option value="dark">Dark only (light/white mark for dark bg)</option>
              </select>
              <p className="text-xs text-eq-grey mt-0.5">Tag so the picker shows the right variant for each slot.</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-eq-grey mb-1">Categories *</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CATEGORIES.map((c) => {
                  const checked = uploadCategories.has(c.value)
                  return (
                    <label
                      key={c.value}
                      className={`flex items-start gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                        checked ? 'border-eq-sky bg-eq-ice/40' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = toggleInSet(uploadCategories, c.value)
                          setUploadCategories(next)
                          // Auto-pin entity type if a specifically-scoped category is ticked.
                          if (c.value === 'customer_logo' && next.has('customer_logo')) {
                            setUploadEntityType('customer')
                          } else if (c.value === 'site_photo' && next.has('site_photo')) {
                            setUploadEntityType('site')
                          }
                        }}
                        className="mt-0.5 accent-eq-sky"
                      />
                      <span>
                        <span className="block text-xs font-medium text-eq-ink">{c.label}</span>
                        <span className="block text-[10px] text-eq-grey">{c.hint}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
              <p className="text-[10px] text-eq-grey mt-1">
                Tip: tag one image with several categories to reuse it across slots (e.g. SKS White logo tagged with
                both General and Report Image so it can sit in the app banner and the dark-background report logo
                slot).
              </p>
            </div>
            {(uploadCategories.has('customer_logo') || uploadEntityType === 'customer') && (
              <div>
                <label className="block text-xs font-medium text-eq-grey mb-1">Customer</label>
                <select
                  value={uploadEntityId}
                  onChange={(e) => {
                    setUploadEntityType('customer')
                    setUploadEntityId(e.target.value)
                  }}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
                >
                  <option value="">Select customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(uploadCategories.has('site_photo') || uploadEntityType === 'site') && (
              <div>
                <label className="block text-xs font-medium text-eq-grey mb-1">Site</label>
                <select
                  value={uploadEntityId}
                  onChange={(e) => {
                    setUploadEntityType('site')
                    setUploadEntityId(e.target.value)
                  }}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
                >
                  <option value="">Select site…</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-eq-grey mb-1">Image File *</label>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm file:mr-2 file:py-1 file:px-3 file:rounded-md file:border file:border-gray-200 file:text-xs file:font-medium file:bg-white file:text-eq-deep hover:file:bg-eq-ice"
              />
              <p className="text-xs text-eq-grey mt-0.5">PNG, JPG, SVG, WebP. Max 2 MB.</p>
            </div>
          </div>
          {uploadError && (
            <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
              <X className="w-3 h-3" /> {uploadError}
            </p>
          )}
          <div className="flex items-center gap-2 mt-3">
            <Button
              size="sm"
              disabled={uploading || !uploadFile || !uploadName.trim() || uploadCategories.size === 0}
              onClick={handleUpload}
            >
              {uploading ? 'Uploading…' : 'Upload Image'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowUpload(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Media grid */}
      {filtered.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <ImageIcon className="w-10 h-10 text-eq-grey mx-auto mb-2 opacity-40" />
            <p className="text-sm text-eq-grey">
              {media.length === 0 ? 'No images uploaded yet. Click Upload to get started.' : 'No images match your filters.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((item) => {
            const itemCats = cats(item)
            return (
              <Card key={item.id} className="p-0 overflow-hidden group relative">
                <button
                  type="button"
                  onClick={() => openEdit(item)}
                  className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-eq-sky rounded-lg"
                  title="Click to edit properties"
                >
                  <div
                    className={`aspect-square flex items-center justify-center overflow-hidden ${
                      item.surface === 'dark' ? 'bg-eq-ink' : 'bg-gray-50'
                    }`}
                  >
                    {item.content_type?.startsWith('image/svg') ? (
                      <img src={item.file_url} alt={item.name} className="max-w-full max-h-full object-contain p-2" />
                    ) : (
                      <img src={item.file_url} alt={item.name} className="w-full h-full object-cover" />
                    )}
                  </div>

                  <div className="p-2">
                    <p className="text-xs font-medium text-eq-ink truncate" title={item.name}>
                      {item.name}
                    </p>
                    <div className="flex items-center flex-wrap gap-1 mt-1">
                      {itemCats.map((c) => (
                        <span
                          key={c}
                          className="text-[10px] px-1.5 py-0.5 rounded-full bg-eq-ice text-eq-deep font-medium truncate"
                        >
                          {CATEGORIES.find((cc) => cc.value === c)?.label ?? c}
                        </span>
                      ))}
                      {item.surface && item.surface !== 'any' && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            item.surface === 'dark' ? 'bg-eq-ink text-white' : 'bg-gray-100 text-eq-grey'
                          }`}
                        >
                          {item.surface}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-eq-grey mt-1">{formatSize(item.file_size)}</p>
                    {item.entity_type && item.entity_id && (
                      <p className="text-[10px] text-eq-grey mt-0.5 truncate">
                        {item.entity_type === 'customer'
                          ? customers.find((c) => c.id === item.entity_id)?.name ?? 'Unknown'
                          : sites.find((s) => s.id === item.entity_id)?.name ?? 'Unknown'}
                      </p>
                    )}
                  </div>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(item.id)
                  }}
                  disabled={deletingId === item.id}
                  className="absolute top-1.5 right-1.5 p-1 rounded-md bg-white/80 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                  title="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </Card>
            )
          })}
        </div>
      )}

      <p className="text-xs text-eq-grey text-right">
        {filtered.length} of {media.length} image{media.length !== 1 ? 's' : ''}
      </p>

      {/* Edit Media Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={closeEdit}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-eq-ink">Edit Media Properties</h3>
              <button onClick={closeEdit} className="p-1 rounded-md hover:bg-gray-100 text-eq-grey" title="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-4 mb-4">
              <div className="w-28 h-28 bg-gray-50 border border-gray-200 rounded-md flex items-center justify-center overflow-hidden shrink-0">
                <img src={editing.file_url} alt={editing.name} className="max-w-full max-h-full object-contain" />
              </div>
              <div className="text-xs text-eq-grey flex-1 space-y-0.5">
                <p className="truncate">
                  <span className="font-medium text-eq-ink">File:</span> {editing.file_name}
                </p>
                <p>
                  <span className="font-medium text-eq-ink">Size:</span> {formatSize(editing.file_size)}
                </p>
                <p>
                  <span className="font-medium text-eq-ink">Type:</span> {editing.content_type ?? '—'}
                </p>
                <a
                  href={editing.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-eq-sky hover:underline block mt-1"
                >
                  Open original ↗
                </a>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-eq-grey mb-1">Name *</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-eq-grey mb-1">Categories *</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {CATEGORIES.map((c) => {
                    const checked = editCategories.has(c.value)
                    return (
                      <label
                        key={c.value}
                        className={`flex items-start gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                          checked ? 'border-eq-sky bg-eq-ice/40' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = toggleInSet(editCategories, c.value)
                            setEditCategories(next)
                            if (c.value === 'customer_logo' && next.has('customer_logo')) {
                              setEditEntityType('customer')
                            } else if (c.value === 'site_photo' && next.has('site_photo')) {
                              setEditEntityType('site')
                            }
                          }}
                          className="mt-0.5 accent-eq-sky"
                        />
                        <span>
                          <span className="block text-xs font-medium text-eq-ink">{c.label}</span>
                          <span className="block text-[10px] text-eq-grey">{c.hint}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-eq-grey mb-1">Surface</label>
                <select
                  value={editSurface}
                  onChange={(e) => setEditSurface(e.target.value as MediaSurface)}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
                >
                  <option value="any">Any surface</option>
                  <option value="light">Light only</option>
                  <option value="dark">Dark only</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-eq-grey mb-1">Linked To</label>
                <div className="flex gap-2">
                  <select
                    value={editEntityType}
                    onChange={(e) => {
                      setEditEntityType(e.target.value)
                      setEditEntityId('')
                    }}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
                  >
                    <option value="">None</option>
                    <option value="customer">Customer</option>
                    <option value="site">Site</option>
                  </select>
                  {editEntityType === 'customer' && (
                    <select
                      value={editEntityId}
                      onChange={(e) => setEditEntityId(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
                    >
                      <option value="">Select customer…</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {editEntityType === 'site' && (
                    <select
                      value={editEntityId}
                      onChange={(e) => setEditEntityId(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-eq-sky"
                    >
                      <option value="">Select site…</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>

            {editError && (
              <p className="text-xs text-red-500 mt-3 flex items-center gap-1">
                <X className="w-3 h-3" /> {editError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 mt-5">
              <Button size="sm" variant="secondary" onClick={closeEdit} disabled={savingEdit}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit || !editName.trim() || editCategories.size === 0}>
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
