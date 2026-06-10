'use client'

import { useState } from 'react'
import { ImageLightbox } from './ImageLightbox'

interface ImageThumbnailProps {
  src: string
  alt?: string
  caption?: string | null
  size?: 'xs' | 'sm' | 'md'
}

const sizeClasses: Record<NonNullable<ImageThumbnailProps['size']>, string> = {
  xs: 'w-6 h-6',
  sm: 'w-10 h-10',
  md: 'w-16 h-16',
}

/**
 * Square thumbnail with click-to-lightbox. Stops click propagation so it
 * can be dropped inside clickable rows (e.g. the asset row in CheckDetail)
 * without toggling the row.
 */
export function ImageThumbnail({ src, alt = '', caption, size = 'sm' }: ImageThumbnailProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className={`${sizeClasses[size]} shrink-0 rounded border border-gray-200 overflow-hidden bg-gray-50 hover:border-eq-sky transition-colors`}
        title={caption ?? alt ?? 'View reference image'}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="w-full h-full object-cover" />
      </button>
      {open && (
        <ImageLightbox src={src} alt={alt} caption={caption} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
