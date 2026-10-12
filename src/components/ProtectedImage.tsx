import React, { useEffect, useRef, useState } from 'react'

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
const PRELOAD_MARGIN = '1200px 0px'

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
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.preventDefault()
  }

  // Render the bare <img> (no wrapper div) so the caller's className —
  // including absolute/inset-0 fill layouts like ProductCard's — applies
  // directly to the image. A wrapping <div className="relative"> previously
  // became the positioning context for absolutely-positioned images, collapsing
  // them to 0×0 (blank product cards). Right-click/drag are still blocked on the
  // image itself; per this component's contract that's "polite friction" only.
  // Preload just before scroll-in: the src is attached once the tile is within
  // PRELOAD_MARGIN of the viewport, so a fast phone scroll never lands on an
  // empty tile waiting for native lazy-load to start. No IntersectionObserver
  // (old browser, jsdom) -> attach at once. Eager callers skip the observer.
  const ref = useRef<HTMLImageElement>(null)
  const [near, setNear] = useState(loading === 'eager' || typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near || !ref.current) return
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((en) => en.isIntersecting)) { setNear(true); io.disconnect() } },
      { rootMargin: PRELOAD_MARGIN }
    )
    io.observe(ref.current)
    return () => io.disconnect()
  }, [near])

  return (
    <img
      ref={ref}
      src={near ? src : undefined}
      alt={alt}
      loading={near ? 'eager' : loading}
      decoding={decoding}
      className={className}
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
  )
}

export default ProtectedImage
