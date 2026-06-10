'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

interface ImageLightboxProps {
  src: string
  alt?: string
  caption?: string | null
  onClose: () => void
}

/**
 * Full-screen image viewer. Backdrop click + Escape key close it.
 * Rendered inline (not via portal) — SlidePanel uses the same pattern.
 */
export function ImageLightbox({ src, alt = '', caption, onClose }: ImageLightboxProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-eq-ink/80 p-6"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl max-h-[90vh] flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-2 -right-2 p-1.5 bg-white rounded-full shadow-md hover:bg-gray-50"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-eq-ink" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-w-full max-h-[80vh] object-contain rounded"
        />
        {caption && (
          <p className="text-sm text-white/90 text-center max-w-prose">{caption}</p>
        )}
      </div>
    </div>
  )
}
