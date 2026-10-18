// The stand's face, laid out the way tools/qr-stand/gen.py prints it, for the
// live preview on the order page and the admin editor (task deebfdca).
//
// Same plate, same code size and position, same blank centre square, same
// caption box. The module PATTERN can differ from the print (each encoder picks
// its own mask), which is fine: the print file is scan-checked on its own.
// Millimetres, y down from the plate's top edge.
import QRCode from 'qrcode'
import { QR_TOO_LONG, QR_LINK_MAX_BYTES } from '../../../backend/shared/qr-stand'

export const PLATE = {
  w: 90,
  h: 120,
  radius: 3,
  qrSize: 75,
  qrTop: 7.5,
  /** Caption centre, from the plate's bottom edge, and its cap height. */
  textFromBottom: 16,
  textCap: 8.5,
  /** A long caption shrinks to this width (gen.py: PW - 14). */
  textMaxW: 76,
  blankFrac: 0.34,
} as const

/** The plastic, for drawing it: white PLA plate, black PLA face (gen.py FACE_COLOUR). */
export const STAND_COLOURS = { plate: '#FFFFFF', face: '#161616', edge: '#E7E5E4', leg: '#ECEAE7' } as const

export interface FaceLayout {
  version: number
  /** Modules per side. */
  n: number
  /** Module edge, mm. */
  cell: number
  /** Top-left of the code on the plate, mm. */
  x0: number
  y0: number
  /** dark[r][c], with the centre square already cleared. */
  dark: boolean[][]
  /** The cleared square: top-left and edge, mm; `lo`/`k` in modules. */
  blank: { x: number; y: number; size: number; lo: number; k: number }
}

/** The face for a link, or the reason there isn't one. */
export function faceLayout(link: string): { layout: FaceLayout | null; problem: string | null } {
  if (!link) return { layout: null, problem: null }
  const bytes = new TextEncoder().encode(link)
  if (bytes.length > QR_LINK_MAX_BYTES) return { layout: null, problem: QR_TOO_LONG }
  let qr: QRCode.QRCode
  try {
    // Byte mode at level H, as gen.py does, so both land on the same version.
    qr = QRCode.create([{ data: bytes, mode: 'byte' }], { errorCorrectionLevel: 'H' })
  } catch {
    return { layout: null, problem: QR_TOO_LONG }
  }
  if (qr.version > 6) return { layout: null, problem: QR_TOO_LONG }
  const n = qr.modules.size
  const dark: boolean[][] = []
  for (let r = 0; r < n; r++) {
    const row: boolean[] = []
    for (let c = 0; c < n; c++) row.push(!!qr.modules.get(r, c))
    dark.push(row)
  }
  // gen.py qr_geometry(): k = max(5, round(n * 0.34)), made the same parity as n
  // so the square sits dead centre.
  let k = Math.max(5, Math.round(n * PLATE.blankFrac))
  if ((n - k) % 2) k += 1
  const lo = (n - k) / 2
  for (let r = lo; r < lo + k; r++) for (let c = lo; c < lo + k; c++) dark[r][c] = false
  const cell = PLATE.qrSize / n
  const x0 = (PLATE.w - PLATE.qrSize) / 2
  const y0 = PLATE.qrTop
  return {
    layout: { version: qr.version, n, cell, x0, y0, dark, blank: { x: x0 + lo * cell, y: y0 + lo * cell, size: k * cell, lo, k } },
    problem: null,
  }
}

/** One SVG path for every dark module, a run per row so a v6 code is ~200 segments, not 1,000. */
export function modulesPath(layout: FaceLayout): string {
  const { n, cell, x0, y0, dark } = layout
  const parts: string[] = []
  const f = (v: number) => Number(v.toFixed(3))
  for (let r = 0; r < n; r++) {
    let c = 0
    while (c < n) {
      if (!dark[r][c]) {
        c++
        continue
      }
      const start = c
      while (c < n && dark[r][c]) c++
      parts.push(`M${f(x0 + start * cell)} ${f(y0 + r * cell)}h${f((c - start) * cell)}v${f(cell)}h${f(-(c - start) * cell)}z`)
    }
  }
  return parts.join('')
}

/** Where the logo goes: the blank square less one module of quiet space (gen.py logo_geometry). */
export function logoBox(layout: FaceLayout): { x: number; y: number; size: number } {
  const { blank, cell } = layout
  return { x: blank.x + cell, y: blank.y + cell, size: blank.size - 2 * cell }
}

/** The caption's baseline and font size in mm. `widthPerFontMm` is the caption's
 *  rendered width at a 1 mm font; Arial Bold's capitals are 0.716 em tall. */
export function captionBox(widthPerFontMm: number): { baseline: number; fontSize: number } {
  let fontSize = PLATE.textCap / 0.716
  let cap = PLATE.textCap
  if (widthPerFontMm * fontSize > PLATE.textMaxW) {
    const f = PLATE.textMaxW / (widthPerFontMm * fontSize)
    fontSize *= f
    cap *= f
  }
  const centre = PLATE.h - PLATE.textFromBottom
  return { baseline: centre + cap / 2, fontSize }
}
