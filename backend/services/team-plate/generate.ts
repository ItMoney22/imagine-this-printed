// Team plate — the per-order lettering pipeline.
//
//   tagged back art ──gpt-image-2.5-flare edit──▶ BASE (~1152x1536, the preview)
//                                                   │
//                                  recraft-crisp-upscale (print-resolution.ts)
//                                                   ▼
//                                     PRESS (template canvas, 3600x4800 @300 DPI)
//
// Replaces the opentype.js vector engine (legacy-vector/), per David
// 2026-09-22: flare "redo the design keeping things intact and just redoin the
// name and number. it will cost more but will come out the cleanest".
//
// THE PREVIEW IS THE PRESS FILE, SMALLER. The customer approves the BASE, and
// the press file is that same image upscaled — never a second generation. A
// second flare call would draw a different "22" than the one they approved.
//
// Pure of storage: every side effect comes in through `deps`, so the whole
// chain is testable against real pixels without OpenAI, Replicate or GCS.
// plate-store.ts supplies the real ones and owns the caching.
import sharp from 'sharp'
import type { TeamTemplate } from '../../shared/team-template.js'
import { buildLetteringPrompt, type LetteringMode } from './lettering-prompt.js'

/** Pinned first; the provider's chain (gpt-image-2 -> 1) remains the fallback. */
export const LETTERING_MODEL = 'gpt-image-2.5-flare'

/** Long edge asked of the model. 1536 is the largest every model in the chain honours. */
const BASE_LONG_EDGE = 1536

export interface AssetRef {
  /** Fetchable (signed) URL — what the edit endpoint and upscaler read. */
  url: string
  buffer: Buffer
}

export interface GenerateDeps {
  /** Resolve a product_assets id to its bytes and a fetchable URL. */
  loadAsset(assetId: string): Promise<AssetRef>
  /** The flare edit. Must store its output at `objectPath` and return where it went. */
  edit(opts: {
    sourceUrl: string
    prompt: string
    size: string
    background: 'transparent' | 'opaque'
    objectPath: string
    model: string
  }): Promise<{ url: string; path: string; modelId: string }>
  fetchBuffer(url: string): Promise<Buffer>
  /** recraft-crisp-upscale with the source's alpha restored (print-resolution.ts). */
  upscale(url: string, sourceBuf: Buffer): Promise<{ buffer: Buffer; width: number; height: number }>
}

export interface GeneratedBase {
  url: string
  path: string
  buffer: Buffer
  modelId: string
  mode: LetteringMode
  width: number
  height: number
}

/**
 * The size to ask the model for: the template canvas's aspect, long edge 1536,
 * both sides multiples of 16 (GPT Image 2.5's rule), aspect held inside 1:3..3:1.
 * Matching the canvas aspect is what lets the press step resize with no crop
 * and no stretch worth the name.
 */
export function baseSizeFor(canvas: { w: number; h: number }): { w: number; h: number } {
  const ratio = Math.min(3, Math.max(1 / 3, canvas.w / canvas.h))
  const snap = (n: number) => Math.max(16, Math.round(n / 16) * 16)
  return ratio >= 1
    ? { w: BASE_LONG_EDGE, h: snap(BASE_LONG_EDGE / ratio) }
    : { w: snap(BASE_LONG_EDGE * ratio), h: BASE_LONG_EDGE }
}

/** True when the image has an alpha channel that is actually used somewhere. */
async function usesTransparency(buffer: Buffer): Promise<boolean> {
  const meta = await sharp(buffer).metadata()
  if (!meta.hasAlpha) return false
  // stats() reads the INPUT, ignoring any extractChannel in the chain — so the
  // alpha is the last channel of the full set, not channels[0] (which is red).
  const { channels } = await sharp(buffer).stats()
  return (channels[channels.length - 1]?.min ?? 255) < 250
}

/**
 * Step 1 — the flare edit. Returns the BASE: the customer's preview, and the
 * only image the press file is ever made from.
 */
export async function generateBase(
  template: TeamTemplate,
  values: Record<string, string>,
  deps: GenerateDeps,
  objectPath: string
): Promise<GeneratedBase> {
  // The original art (sample lettering and all) when the template recorded it;
  // otherwise the erased plate, with the style described instead of shown.
  const mode: LetteringMode = template.sourceAssetId ? 'replace' : 'add'
  const source = await deps.loadAsset(template.sourceAssetId ?? template.plateAssetId)

  const size = baseSizeFor(template.canvas)
  const background = (await usesTransparency(source.buffer)) ? 'transparent' : 'opaque'

  const out = await deps.edit({
    sourceUrl: source.url,
    prompt: buildLetteringPrompt(template, values, mode),
    size: `${size.w}x${size.h}`,
    background,
    objectPath,
    model: LETTERING_MODEL,
  })

  const buffer = await deps.fetchBuffer(out.url)
  const meta = await sharp(buffer).metadata()
  if (!meta.width || !meta.height) throw new Error('the lettering edit returned an unreadable image')

  return {
    url: out.url,
    path: out.path,
    buffer,
    modelId: out.modelId,
    mode,
    width: meta.width,
    height: meta.height,
  }
}

export interface PressFile {
  buffer: Buffer
  width: number
  height: number
  /** What the upscaler actually returned, before the final fit to canvas. */
  upscaled: { width: number; height: number }
}

/**
 * Step 2 — base -> 300 DPI press file.
 *
 * recraft-crisp-upscale does the real work (roughly 2.7-2.9x, measured
 * 1122x1402 -> 3278x4096), and restores the base's alpha. The last hop to the
 * exact canvas is a small lanczos resize (about 1.17x for 1152x1536 -> 3600x4800),
 * which is well inside what flat print art takes without softening.
 *
 * An upscale failure THROWS. There is no "resize the base instead" fallback:
 * that is precisely the blurry shirt the upscaler exists to prevent, and a
 * press file that is quietly soft is worse than one that is visibly missing.
 */
export async function upscaleToPress(
  template: TeamTemplate,
  base: { url: string; buffer: Buffer },
  deps: GenerateDeps
): Promise<PressFile> {
  const up = await deps.upscale(base.url, base.buffer)
  const { w, h } = template.canvas
  const buffer = await sharp(up.buffer)
    .resize(Math.round(w), Math.round(h), { fit: 'fill', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer()
  return { buffer, width: Math.round(w), height: Math.round(h), upscaled: { width: up.width, height: up.height } }
}
