/**
 * DTF halftone engine — TypeScript port of Watchtower's halftone_sidecar.py
 * (itself a faithful port of the mililili/halftone-converter HuggingFace Space,
 * the look David picked for high-end DTF prints).
 *
 * The screen becomes the ALPHA channel of the ORIGINAL-COLORED image: a rotated
 * sine-wave pattern thresholds the grayscale, bright areas become opaque dots,
 * dark areas become transparent. Result = the design's real colors broken into
 * a dot screen, transparent between the dots — the DTF look that "breathes"
 * (the print isn't a solid ink slab).
 *
 * The input design should be LIGHT on a DARK/black background (bright = dots,
 * dark = knocked out). cropBg trims the black border; invertDark is for
 * dark-shirt workflows. Deterministic, pure sharp + math — no Python, no API.
 */

import sharp from 'sharp'

export interface HalftoneOptions {
  /** 'halftone' = rotated dot/line screen (default); 'diffusion' = Floyd–Steinberg dither */
  method?: 'halftone' | 'diffusion'
  /** Screen frequency in LPI, 5–100 (default 35) */
  frequency?: number
  /** Screen angle in degrees, 0–90 (default 23.5) */
  angle?: number
  /** Dot shape (default 'round') */
  shape?: 'round' | 'line'
  /** Levels black point 0–255 (default 16) */
  blackPoint?: number
  /** Levels white point 1–255 (default 100) */
  whitePoint?: number
  /** Levels gamma 0.1–3.0 (default 1.0) */
  gamma?: number
  /** Auto-crop black background border (default true) */
  cropBg?: boolean
  /** Channel value below which a pixel counts as black border (default 25) */
  cropThreshold?: number
  /** Invert grayscale before screening — for dark-shirt workflows (default false) */
  invertDark?: boolean
  /** Max output dimension in px; only downscales (default 4500) */
  maxPx?: number
}

export interface HalftoneResult {
  buffer: Buffer
  width: number
  height: number
  metadata: {
    method: 'halftone' | 'diffusion'
    frequency: number
    angle: number
    shape: 'round' | 'line'
    blackPoint: number
    whitePoint: number
    gamma: number
    invertDark: boolean
  }
}

const SCREEN_DPI = 300

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Bounding box of pixels where any RGB channel exceeds threshold; null = no crop needed. */
function findNonBlackBBox(
  rgba: Buffer,
  width: number,
  height: number,
  threshold: number,
): sharp.Region | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let x = 0; x < width; x++) {
      const i = row + x * 4
      if (rgba[i] > threshold || rgba[i + 1] > threshold || rgba[i + 2] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null // image is entirely black — leave as-is
  if (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1) return null
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Floyd–Steinberg error-diffusion to a 0/255 mask (PIL convert("1", FLOYDSTEINBERG) equivalent). */
function floydSteinberg(gray: Uint8Array, width: number, height: number): Uint8Array {
  const buf = Float32Array.from(gray)
  const out = new Uint8Array(gray.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const old = buf[i]
      const next = old >= 128 ? 255 : 0
      out[i] = next
      const err = old - next
      if (x + 1 < width) buf[i + 1] += (err * 7) / 16
      if (y + 1 < height) {
        if (x > 0) buf[i + width - 1] += (err * 3) / 16
        buf[i + width] += (err * 5) / 16
        if (x + 1 < width) buf[i + width + 1] += (err * 1) / 16
      }
    }
  }
  return out
}

export async function applyHalftone(input: Buffer, opts: HalftoneOptions = {}): Promise<HalftoneResult> {
  const method = opts.method === 'diffusion' ? 'diffusion' : 'halftone'
  const frequency = clamp(Number(opts.frequency) || 35, 5, 100)
  const angleDeg = clamp(Number(opts.angle ?? 23.5), 0, 90)
  const shape = opts.shape === 'line' ? 'line' : 'round'
  const blackPoint = clamp(Math.floor(Number(opts.blackPoint ?? 16)), 0, 255)
  const whitePoint = clamp(Math.floor(Number(opts.whitePoint ?? 100)), 1, 255)
  const gamma = clamp(Number(opts.gamma) || 1.0, 0.1, 3.0)
  const cropBg = opts.cropBg !== false
  const cropThreshold = clamp(Math.floor(Number(opts.cropThreshold ?? 25)), 0, 255)
  const invertDark = opts.invertDark === true
  const maxPx = clamp(Math.floor(Number(opts.maxPx) || 4500), 256, 4500)

  // Optional black-border crop (needs a full raw pass to find the bbox).
  let pipeline = sharp(input).ensureAlpha()
  if (cropBg) {
    const { data: probe, info: probeInfo } = await sharp(input)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const bbox = findNonBlackBBox(probe, probeInfo.width, probeInfo.height, cropThreshold)
    if (bbox) pipeline = sharp(input).ensureAlpha().extract(bbox)
  }

  // Downscale-only resize (PIL thumbnail semantics: target maxPx × maxPx*1.2).
  const { data, info } = await pipeline
    .resize({
      width: maxPx,
      height: Math.floor(maxPx * 1.2),
      fit: 'inside',
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height } = info
  const n = width * height

  // Grayscale (ITU-R 601-2, PIL convert("L")) + Photoshop-style Levels (+ optional invert).
  const gray = new Uint8Array(n)
  const range = Math.max(whitePoint - blackPoint, 1)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const l = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
    let v: number
    if (l <= blackPoint) v = 0
    else if (l >= whitePoint) v = 255
    else {
      let norm = (l - blackPoint) / range
      if (gamma !== 1.0) norm = Math.pow(norm, 1.0 / gamma)
      v = Math.round(norm * 255)
    }
    gray[i] = invertDark ? 255 - v : v
  }

  // Build the alpha mask: rotated sine screen or error diffusion.
  let alpha: Uint8Array
  if (method === 'diffusion') {
    alpha = floydSteinberg(gray, width, height)
  } else {
    alpha = new Uint8Array(n)
    const pxPerCycle = SCREEN_DPI / frequency
    const rad = (angleDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const twoPi = 2 * Math.PI
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const xr = x * cos + y * sin
        let p: number
        if (shape === 'line') {
          p = 0.5 * (1 + Math.sin((twoPi * xr) / pxPerCycle))
        } else {
          const yr = -x * sin + y * cos
          p = 0.5 * (1 + Math.sin((twoPi * xr) / pxPerCycle) * Math.sin((twoPi * yr) / pxPerCycle))
        }
        const i = y * width + x
        alpha[i] = gray[i] > Math.floor(p * 255) ? 255 : 0
      }
    }
  }

  // The screen becomes the alpha channel of the original-colored image.
  for (let i = 0; i < n; i++) data[i * 4 + 3] = alpha[i]

  const buffer = await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .withMetadata({ density: SCREEN_DPI })
    .toBuffer()

  return {
    buffer,
    width,
    height,
    metadata: { method, frequency, angle: angleDeg, shape, blackPoint, whitePoint, gamma, invertDark },
  }
}
