// Full-screen image viewer for the admin product editor. Opened from the
// large viewer in AdminProductEditModal — click-to-zoom (wheel or +/-
// buttons), prev/next through the flattened gallery, download, set-as-main,
// and delete (only offered when the current image actually has a
// product_assets row, i.e. `assetId` is set — Etsy model shots don't).
import React, { useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, Star, Trash2 } from 'lucide-react'
import { CHECKERBOARD_BG } from '../imagination/checkerboard'

export interface LightboxImage {
  url: string
  label: string
  assetId?: string
}

interface ImageLightboxProps {
  images: LightboxImage[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  mainImageUrl?: string | null
  onSetMain?: (image: LightboxImage) => void
  onDelete?: (image: LightboxImage) => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  images,
  index,
  onIndexChange,
  onClose,
  mainImageUrl,
  onSetMain,
  onDelete,
}) => {
  const [zoom, setZoom] = useState(1)
  const current = images[index]

  // Reset zoom whenever the viewed image changes.
  useEffect(() => { setZoom(1) }, [index])

  // Esc closes, arrow keys navigate — works regardless of what has focus.
  useEffect(() => {
    if (images.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft') {
        onIndexChange((index - 1 + images.length) % images.length)
      } else if (e.key === 'ArrowRight') {
        onIndexChange((index + 1) % images.length)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, images.length, onClose, onIndexChange])

  if (!current) return null

  const isMain = !!mainImageUrl && mainImageUrl === current.url

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => clampZoom(z - e.deltaY * 0.0015))
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-bg/95 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={current.label}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="absolute top-4 right-4 p-2 rounded-full bg-card/90 border border-white/10 text-text hover:bg-white/10 transition-colors"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onIndexChange((index - 1 + images.length) % images.length) }}
            className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 p-2 rounded-full bg-card/90 border border-white/10 text-text hover:bg-white/10 transition-colors"
            aria-label="Previous image"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onIndexChange((index + 1) % images.length) }}
            className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 p-2 rounded-full bg-card/90 border border-white/10 text-text hover:bg-white/10 transition-colors"
            aria-label="Next image"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      <div
        className={`relative max-w-[88vw] max-h-[64vh] w-full h-[64vh] rounded-2xl overflow-hidden border border-white/10 ${CHECKERBOARD_BG} flex items-center justify-center cursor-zoom-in`}
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
      >
        <img
          src={current.url}
          alt={current.label}
          className="max-w-full max-h-full object-contain select-none transition-transform duration-150 ease-out"
          style={{ transform: `scale(${zoom})` }}
          draggable={false}
        />
      </div>

      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 w-full max-w-3xl px-4 flex flex-wrap items-center justify-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs text-muted bg-card/90 border border-white/10 rounded-full px-3 py-1.5">
          {current.label} · {index + 1}/{images.length}
        </span>

        <div className="flex items-center gap-0.5 bg-card/90 border border-white/10 rounded-full px-1 py-1">
          <button
            type="button"
            onClick={() => setZoom(z => clampZoom(z - ZOOM_STEP))}
            disabled={zoom <= MIN_ZOOM}
            className="w-7 h-7 flex items-center justify-center rounded-full text-text hover:bg-white/10 disabled:opacity-30 transition-colors"
            aria-label="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-muted w-10 text-center select-none">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom(z => clampZoom(z + ZOOM_STEP))}
            disabled={zoom >= MAX_ZOOM}
            className="w-7 h-7 flex items-center justify-center rounded-full text-text hover:bg-white/10 disabled:opacity-30 transition-colors"
            aria-label="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        <a
          href={current.url}
          download
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-card/90 border border-white/10 text-text hover:bg-white/10 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </a>

        {isMain ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-primary/15 text-primary border border-primary/30">
            <Star className="w-3.5 h-3.5 fill-current" />
            Main image
          </span>
        ) : onSetMain && (
          <button
            type="button"
            onClick={() => onSetMain(current)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-accent text-black hover:opacity-90 transition-opacity"
          >
            <Star className="w-3.5 h-3.5" />
            Set as main
          </button>
        )}

        {onDelete && current.assetId && (
          <button
            type="button"
            onClick={() => onDelete(current)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

export default ImageLightbox
