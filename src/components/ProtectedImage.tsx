import React from 'react'

interface ProtectedImageProps {
  src: string
  alt: string
  className?: string
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void
  loading?: 'eager' | 'lazy'
  decoding?: 'sync' | 'async' | 'auto'
}

/**
 * ProtectedImage adds *friction* against casual saving — right-click is
 * blocked, drag is blocked, selection is disabled. It does NOT prevent a
 * determined user from grabbing the bytes via DevTools, the Network tab,
 * or `curl` against the public asset URL. Treat this as a polite "please
 * don't" sign, not access control. For real protection we'd need
 * server-side watermarking or signed-URL gating with short TTL.
 */
const ProtectedImage: React.FC<ProtectedImageProps> = ({
  src,
  alt,
  className = '',
  onError,
  loading = 'lazy',
  decoding = 'async'
}) => {
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    return false
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.preventDefault()
    return false
  }

  return (
    <div className="relative select-none">
      <img
        src={src}
        alt={alt}
        loading={loading}
        decoding={decoding}
        className={`${className} pointer-events-auto`}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onError={onError}
        draggable={false}
        style={{
          WebkitUserSelect: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      />
      {/* Transparent overlay to prevent direct image interaction */}
      <div
        className="absolute inset-0 z-10"
        onContextMenu={handleContextMenu}
        style={{
          background: 'transparent',
          cursor: 'default'
        }}
      />
    </div>
  )
}

export default ProtectedImage
