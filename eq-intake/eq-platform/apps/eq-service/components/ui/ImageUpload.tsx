'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Upload, X } from 'lucide-react'

interface ImageUploadProps {
  label?: string
  accept?: string
  maxBytes?: number
  maxDimension?: number
  disabled?: boolean
  onUpload: (file: File) => Promise<{ success: boolean; error?: string }>
}

/**
 * Shared image picker with client-side resize. Produces a JPEG at
 * `maxDimension` on its longest side then hands the resulting File to
 * `onUpload`. Keeps reference images small enough to ship with the page
 * and saves storage + bandwidth for photo evidence later.
 *
 * Client-side resize is intentional — we do not want the server action
 * dealing with sharp or ImageMagick, and we do not trust the user to
 * upload pre-sized images.
 */
export function ImageUpload({
  label = 'Upload image',
  accept = 'image/jpeg,image/png,image/webp',
  maxBytes = 5 * 1024 * 1024,
  maxDimension = 1600,
  disabled = false,
  onUpload,
}: ImageUploadProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)

    if (file.size > maxBytes) {
      setError(`File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB limit.`)
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    setBusy(true)
    try {
      const resized = await resizeImage(file, maxDimension)
      const result = await onUpload(resized)
      if (!result.success) setError(result.error ?? 'Upload failed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-1">
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        disabled={disabled || busy}
        className="hidden"
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || busy}
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="w-3 h-3 mr-1" /> {busy ? 'Uploading…' : label}
      </Button>
      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <X className="w-3 h-3" /> {error}
        </p>
      )}
    </div>
  )
}

/**
 * Client-side resize via canvas. Preserves aspect ratio, outputs JPEG at 85%.
 * If the image is already within `maxDimension` the original File is returned
 * unchanged to avoid a pointless re-encode.
 */
async function resizeImage(file: File, maxDimension: number): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap
  const longest = Math.max(width, height)
  if (longest <= maxDimension) {
    bitmap.close()
    return file
  }

  const scale = maxDimension / longest
  const targetW = Math.round(width * scale)
  const targetH = Math.round(height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  )
  if (!blob) return file

  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], newName, { type: 'image/jpeg' })
}
