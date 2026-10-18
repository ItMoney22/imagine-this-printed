// The logo as the stand prints it: one colour, raised in the same black as the
// code (task deebfdca: the logo is PRINTED IN, not a sticker).
//
// This is tools/qr-stand/gen.py logo_silhouette() in TypeScript, so the preview
// shows what will print rather than the customer's full-colour file:
//   - transparent pixels are background; a solid image's background is the
//     colour round its border (median);
//   - a pixel prints when its distance from that background clears Otsu's
//     threshold (never below 48 of 255);
//   - a light logo on a clear sheet would vanish against white, so it is read
//     against black instead.

export interface Silhouette {
  /** 1 where it prints, row-major, cropped to the logo's own edges. */
  mask: Uint8Array
  w: number
  h: number
}

export function otsu(values: ArrayLike<number>): number {
  const hist = new Array<number>(256).fill(0)
  for (let i = 0; i < values.length; i++) hist[Math.max(0, Math.min(255, Math.floor(values[i])))]++
  const total = values.length
  if (!total) return 128
  let sumAll = 0
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]
  let w0 = 0
  let sum0 = 0
  let bestT = 128
  let bestVar = -1
  for (let t = 0; t < 256; t++) {
    w0 += hist[t]
    if (!w0) continue
    const w1 = total - w0
    if (!w1) break
    sum0 += t * hist[t]
    const m0 = sum0 / w0
    const m1 = (sumAll - sum0) / w1
    const v = w0 * w1 * (m0 - m1) ** 2
    if (v > bestVar) {
      bestVar = v
      bestT = t
    }
  }
  return bestT
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** RGBA pixels in, the printing silhouette out; null when nothing would print. */
export function silhouette(rgba: Uint8ClampedArray, w: number, h: number): Silhouette | null {
  const px = w * h
  let minAlpha = 1
  for (let i = 0; i < px; i++) minAlpha = Math.min(minAlpha, rgba[i * 4 + 3] / 255)
  const hasAlpha = minAlpha < 0.9

  const maskOn = (backdrop: number): Uint8Array => {
    const rgb = new Float32Array(px * 3)
    for (let i = 0; i < px; i++) {
      const a = rgba[i * 4 + 3] / 255
      for (let ch = 0; ch < 3; ch++) rgb[i * 3 + ch] = rgba[i * 4 + ch] * a + backdrop * (1 - a)
    }
    let bg = [backdrop, backdrop, backdrop]
    if (!hasAlpha) {
      const edge: number[][] = [[], [], []]
      const take = (i: number) => {
        for (let ch = 0; ch < 3; ch++) edge[ch].push(rgb[i * 3 + ch])
      }
      for (let x = 0; x < w; x++) {
        take(x)
        take((h - 1) * w + x)
      }
      for (let y = 0; y < h; y++) {
        take(y * w)
        take(y * w + w - 1)
      }
      bg = edge.map(median)
    }
    const dist = new Float32Array(px)
    for (let i = 0; i < px; i++) {
      const dr = rgb[i * 3] - bg[0]
      const dg = rgb[i * 3 + 1] - bg[1]
      const db = rgb[i * 3 + 2] - bg[2]
      dist[i] = Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3)
    }
    const t = Math.max(48, otsu(dist))
    const m = new Uint8Array(px)
    for (let i = 0; i < px; i++) m[i] = dist[i] > t ? 1 : 0
    return m
  }

  let mask = maskOn(255)
  if (hasAlpha && share(mask) < 0.01) mask = maskOn(0)

  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1
  const out = new Uint8Array(cw * ch)
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out[y * cw + x] = mask[(y + y0) * w + x + x0]
  return { mask: out, w: cw, h: ch }
}

function share(mask: Uint8Array): number {
  let on = 0
  for (let i = 0; i < mask.length; i++) on += mask[i]
  return mask.length ? on / mask.length : 0
}

/** How much of its square the silhouette fills; gen.py refuses under 2%. */
export function squareShare(s: Silhouette): number {
  const side = Math.max(s.w, s.h)
  let on = 0
  for (let i = 0; i < s.mask.length; i++) on += s.mask[i]
  return side ? on / (side * side) : 0
}

export const TOO_FINE = 'That logo is too fine to print: use a bolder version of it.'
export const NOTHING_TO_PRINT = 'That logo has nothing to print: use one with a clear shape.'
