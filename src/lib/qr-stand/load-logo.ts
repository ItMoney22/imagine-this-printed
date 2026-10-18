// Turn a logo (a file just picked, or a stored image) into the black-on-clear
// picture of what will print, for the stand preview. Browser only.
import { silhouette, squareShare, TOO_FINE, NOTHING_TO_PRINT } from './logo-silhouette'

/** gen.py thumbnails to 600 px before tracing; the preview does the same. */
const MAX_SIDE = 600
/** gen.py refuses a silhouette under 2% of its square. */
const MIN_SHARE = 0.02

export interface LogoPrint {
  /** PNG data URL: black where it prints, clear elsewhere. */
  dataUrl: string | null
  problem: string | null
}

function loadImage(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('could not load the logo'))
    img.src = src
  })
}

export async function logoPrintFrom(source: Blob | string): Promise<LogoPrint> {
  const isBlob = typeof source !== 'string'
  const url = isBlob ? URL.createObjectURL(source) : source
  try {
    const img = await loadImage(url, !isBlob)
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return { dataUrl: null, problem: null }
    ctx.drawImage(img, 0, 0, w, h)
    const sil = silhouette(ctx.getImageData(0, 0, w, h).data, w, h)
    if (!sil) return { dataUrl: null, problem: NOTHING_TO_PRINT }
    if (squareShare(sil) < MIN_SHARE) return { dataUrl: null, problem: TOO_FINE }
    const out = document.createElement('canvas')
    out.width = sil.w
    out.height = sil.h
    const octx = out.getContext('2d')!
    const data = octx.createImageData(sil.w, sil.h)
    for (let i = 0; i < sil.mask.length; i++) {
      if (!sil.mask[i]) continue
      data.data[i * 4 + 0] = 0x16
      data.data[i * 4 + 1] = 0x16
      data.data[i * 4 + 2] = 0x16
      data.data[i * 4 + 3] = 255
    }
    octx.putImageData(data, 0, 0)
    return { dataUrl: out.toDataURL('image/png'), problem: null }
  } finally {
    if (isBlob) URL.revokeObjectURL(url)
  }
}
