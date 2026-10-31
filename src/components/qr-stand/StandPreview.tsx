// Live picture of a QR counter stand's face (task deebfdca): the customer's own
// link as a real, scannable code, their words underneath and their logo in the
// middle as the one-colour silhouette that actually prints. Drawn in the
// stand's own millimetres from src/lib/qr-stand/face.ts, which mirrors
// tools/qr-stand/gen.py, so the layout here is the layout on the plate.
import { useMemo } from 'react'
import { PLATE, STAND_COLOURS, captionBox, faceLayout, logoBox, modulesPath } from '../../lib/qr-stand/face'

export interface StandPreviewProps {
  /** The link as it will be encoded (already normalised). */
  link: string
  caption: string
  /** The printing silhouette of the logo as a black-on-clear image, or null for a blank square. */
  logoSrc?: string | null
  className?: string
  /** Accessible description; defaults to what the stand says. */
  label?: string
}

let measureCtx: CanvasRenderingContext2D | null | undefined
/** The caption's width at a 1 mm font in the stand's typeface (Arial Bold, as gen.py). */
function captionWidthPerMm(text: string): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d')
    } catch {
      measureCtx = null
    }
  }
  if (measureCtx) {
    measureCtx.font = '700 100px Arial, "Liberation Sans", Helvetica, sans-serif'
    const w = measureCtx.measureText(text).width
    if (w > 0) return w / 100
  }
  return text.length * 0.6 // no canvas (tests): Arial Bold averages ~0.6 em a letter
}

export default function StandPreview({ link, caption, logoSrc, className, label }: StandPreviewProps) {
  const { layout } = useMemo(() => faceLayout(link), [link])
  const path = useMemo(() => (layout ? modulesPath(layout) : ''), [layout])
  const text = caption.trim()
  const { baseline, fontSize } = useMemo(() => captionBox(text ? captionWidthPerMm(text) : 0), [text])
  const box = layout ? logoBox(layout) : null
  const codeX = (PLATE.w - PLATE.qrSize) / 2

  return (
    <svg
      viewBox="-8 -6 118 136"
      role="img"
      aria-label={label ?? `Stand preview: a code for ${link || 'your link'}${text ? `, with "${text}" underneath` : ''}`}
      className={className}
    >
      <defs>
        <filter id="qr-stand-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2.2" stdDeviation="2.4" floodOpacity="0.16" />
        </filter>
      </defs>
      {/* The leg behind the plate, as it reads from slightly to the side. */}
      <polygon points={`${PLATE.w - 8},18 ${PLATE.w + 12},${PLATE.h + 1} ${PLATE.w - 4},${PLATE.h + 1}`} fill={STAND_COLOURS.leg} />
      <rect
        x={0}
        y={0}
        width={PLATE.w}
        height={PLATE.h}
        rx={PLATE.radius}
        fill={STAND_COLOURS.plate}
        stroke={STAND_COLOURS.edge}
        strokeWidth={0.4}
        filter="url(#qr-stand-shadow)"
      />
      {layout ? (
        <path d={path} fill={STAND_COLOURS.face} shapeRendering="crispEdges" />
      ) : (
        <g>
          <rect
            x={codeX}
            y={PLATE.qrTop}
            width={PLATE.qrSize}
            height={PLATE.qrSize}
            rx={2}
            fill="none"
            className="stroke-border"
            strokeWidth={0.8}
            strokeDasharray="3 2.4"
          />
          <text
            x={PLATE.w / 2}
            y={PLATE.qrTop + PLATE.qrSize / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={4.4}
            className="fill-muted font-body"
          >
            Your code appears here
          </text>
        </g>
      )}
      {layout && box && logoSrc && (
        <image href={logoSrc} x={box.x} y={box.y} width={box.size} height={box.size} preserveAspectRatio="xMidYMid meet" />
      )}
      {text && (
        <text
          x={PLATE.w / 2}
          y={baseline}
          textAnchor="middle"
          fontSize={fontSize}
          fontWeight={700}
          fontFamily='Arial, "Liberation Sans", Helvetica, sans-serif'
          fill={STAND_COLOURS.face}
        >
          {text}
        </text>
      )}
    </svg>
  )
}
