// Paint & Replace — brush the area Flare may change.
//
// The strokes are painted OPAQUE on a transparent canvas at the image's aspect;
// only their alpha matters. The backend (flare-studio.ts buildOpenAIMask)
// resizes that alpha to the source and inverts it into OpenAI's convention,
// where TRANSPARENT mask pixels are the editable ones.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Brush, Eraser, RotateCcw } from 'lucide-react'

interface MaskPainterProps {
  imageUrl: string
  /** Latest painted mask as a PNG data URL, or null when nothing is painted. */
  onChange: (maskDataUrl: string | null) => void
  checkerboard?: boolean
}

/** Internal canvas resolution (long edge). The server rescales to the source anyway. */
const MASK_LONG_EDGE = 1024

const MaskPainter: React.FC<MaskPainterProps> = ({ imageUrl, onChange, checkerboard }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [brush, setBrush] = useState(48)
  const [erasing, setErasing] = useState(false)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const painted = useRef(false)

  useEffect(() => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const ratio = img.naturalWidth / img.naturalHeight || 1
      setDims(ratio >= 1 ? { w: MASK_LONG_EDGE, h: Math.round(MASK_LONG_EDGE / ratio) } : { w: Math.round(MASK_LONG_EDGE * ratio), h: MASK_LONG_EDGE })
    }
    img.src = imageUrl
    painted.current = false
    onChange(null)
    // onChange is a setter from the parent; re-running on its identity would wipe the mask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl])

  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
    ctx.strokeStyle = 'rgba(236, 72, 153, 1)'
    ctx.lineWidth = brush
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }

  const emit = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    // Anything painted at all? (a fully erased canvas counts as empty)
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    let any = false
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] > 16) {
        any = true
        break
      }
    }
    painted.current = any
    onChange(any ? c.toDataURL('image/png') : null)
  }, [onChange])

  const clear = () => {
    const c = canvasRef.current
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    painted.current = false
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <div
        className="relative w-full rounded-xl overflow-hidden border border-text/10"
        style={
          checkerboard
            ? { backgroundImage: 'repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%)', backgroundSize: '20px 20px' }
            : undefined
        }
      >
        <img src={imageUrl} alt="Design to edit" className="w-full h-auto block select-none pointer-events-none" draggable={false} />
        {dims && (
          <canvas
            ref={canvasRef}
            width={dims.w}
            height={dims.h}
            className="absolute inset-0 w-full h-full opacity-50 touch-none"
            style={{ cursor: 'crosshair' }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = true
              const p = toCanvas(e)
              last.current = p
              stroke(p, p)
            }}
            onPointerMove={(e) => {
              if (!drawing.current || !last.current) return
              const p = toCanvas(e)
              stroke(last.current, p)
              last.current = p
            }}
            onPointerUp={() => {
              drawing.current = false
              last.current = null
              emit()
            }}
            onPointerLeave={() => {
              if (drawing.current) emit()
              drawing.current = false
              last.current = null
            }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setErasing(false)}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border ${!erasing ? 'border-primary bg-primary/10 text-primary' : 'border-text/10 text-muted'}`}
        >
          <Brush className="w-3.5 h-3.5" /> Paint
        </button>
        <button
          type="button"
          onClick={() => setErasing(true)}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border ${erasing ? 'border-primary bg-primary/10 text-primary' : 'border-text/10 text-muted'}`}
        >
          <Eraser className="w-3.5 h-3.5" /> Erase
        </button>
        <label className="flex items-center gap-2 text-muted">
          Brush
          <input type="range" min={8} max={160} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
        </label>
        <button type="button" onClick={clear} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-text/10 text-muted hover:text-text">
          <RotateCcw className="w-3.5 h-3.5" /> Clear
        </button>
      </div>
    </div>
  )
}

export default MaskPainter
