import React from 'react'

interface ProtectedImageProps {
  src: string
  alt: string
  className?: string
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void
}

/**
 * ProtectedImage component prevents easy image downloading via:
 * - Disabling right-click context menu
 * - Preventing drag and drop
 * - Adding CSS to prevent selection
 * - Optional watermark overlay
 */
const ProtectedImage: React.FC<ProtectedImageProps> = ({
  src,
  alt,
  className = '',
  onError
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
