// Flare Lab — the GPT Image 2.5 Flare edit surface behind Imagination Station.
//
// David 2026-09-24: "learn all the capabilities that gpt image can do and build
// guides and steps in the imagination station".
//
// What the model can actually do (researched 2026-09-24, see TASK_NOTES.md):
//   - edit with up to 16 input images (image 1 is the one being edited)
//   - mask inpainting — transparent mask pixels mark the ONLY area that may change
//   (input_fidelity is NOT one of them: 2.5-flare rejects it with a 400,
//    verified live 2026-09-24. Holding the art is the prompt's job — KEEP/HOLD.)
//   - quality low|medium|high|xhigh|max
//   - n variations per call
//   - free-form WIDTHxHEIGHT (multiples of 16, 1:3..3:1, 655,360..8,294,400 px)
//   - transparent / opaque background
//
// Each TOOL below is one recipe over those knobs. The prompt schemas follow the
// published guidance for this model family: say what to KEEP first, describe
// ONE edit per call, quote exact text and spell it out.
//
// Everything here except runFlare() is pure, so the recipes, sizing, pricing and
// mask conversion are pinned by flare-studio.test.ts without a network.
import sharp from 'sharp'
import { editOpenAIImageMany } from './image-flow/providers/openai-image.js'
import type { LetteringVerdict } from './lettering-check.js'

export const FLARE_MODEL = 'gpt-image-2.5-flare'

export const FLARE_OPS = [
  'edit',
  'inpaint',
  'text',
  'blend',
  'variations',
  'transparent',
  'recolor',
  'cleanup',
  'restyle',
] as const
export type FlareOp = (typeof FLARE_OPS)[number]

export const FLARE_QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type FlareQuality = (typeof FLARE_QUALITIES)[number]

export type FlareSize = 'standard' | 'large'

export interface FlareRequest {
  op: FlareOp
  imageUrl: string
  prompt: string
  refUrls: string[]
  /** Painted mask (opaque = "change here"), any size — resized to the source. */
  maskDataUrl: string | null
  textFrom: string
  textTo: string
  colors: string[]
  quality: FlareQuality
  size: FlareSize
  variations: number
  /** Ask for a transparent background on ops that don't imply one. */
  transparent: boolean
}

/** Max references beside the source. The API takes 16 images; 6 keeps a call sane. */
export const MAX_REFS = 6
export const MAX_VARIATIONS = 4
const MAX_PROMPT = 2000
const HEX_RE = /^#[0-9a-fA-F]{6}$/

/** Ops whose whole point is the prompt — refused without one. */
const NEEDS_PROMPT: ReadonlySet<FlareOp> = new Set(['edit', 'inpaint', 'blend', 'restyle'])

function isImageRef(v: unknown): v is string {
  return typeof v === 'string' && (/^https:\/\//i.test(v) || /^data:image\//i.test(v) || /^http:\/\/localhost/i.test(v))
}

/** Parse an untrusted body into a request, or say exactly what is wrong with it. */
export function validateFlareRequest(raw: any): { ok: true; req: FlareRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Missing request body' }
  const op = raw.op as FlareOp
  if (!FLARE_OPS.includes(op)) return { ok: false, error: `Unknown tool "${raw.op}"` }
  if (!isImageRef(raw.imageUrl)) return { ok: false, error: 'imageUrl must be an https or data:image URL' }

  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, MAX_PROMPT) : ''
  if (NEEDS_PROMPT.has(op) && !prompt) return { ok: false, error: 'Describe the change you want' }

  const refUrls = Array.isArray(raw.refUrls) ? raw.refUrls.filter(isImageRef).slice(0, MAX_REFS) : []
  if (op === 'blend' && refUrls.length === 0) return { ok: false, error: 'Add at least one reference image' }

  const maskDataUrl =
    typeof raw.maskDataUrl === 'string' && /^data:image\/png;base64,/.test(raw.maskDataUrl) ? raw.maskDataUrl : null
  if (op === 'inpaint' && !maskDataUrl) return { ok: false, error: 'Paint the area you want changed first' }
  // OpenAI applies a mask to image 1 only; mixing it with references makes the
  // result depend on an undocumented interaction, so it is refused outright.
  if (maskDataUrl && refUrls.length > 0) return { ok: false, error: 'A mask cannot be combined with reference images' }

  const textFrom = typeof raw.textFrom === 'string' ? raw.textFrom.trim().slice(0, 80) : ''
  const textTo = typeof raw.textTo === 'string' ? raw.textTo.trim().slice(0, 80) : ''
  if (op === 'text' && !textTo && !textFrom) return { ok: false, error: 'Say which text to change and what it should read' }

  const colors = Array.isArray(raw.colors) ? raw.colors.filter((c: unknown) => typeof c === 'string' && HEX_RE.test(c)).slice(0, 8) : []
  if (op === 'recolor' && colors.length === 0) return { ok: false, error: 'Pick at least one colour' }

  const quality: FlareQuality = FLARE_QUALITIES.includes(raw.quality) ? raw.quality : 'high'
  const size: FlareSize = raw.size === 'large' ? 'large' : 'standard'
  const wanted = Number.isFinite(Number(raw.variations)) ? Math.floor(Number(raw.variations)) : op === 'variations' ? 3 : 1
  const variations = Math.max(1, Math.min(MAX_VARIATIONS, wanted))

  return {
    ok: true,
    req: {
      op,
      imageUrl: raw.imageUrl,
      prompt,
      refUrls,
      maskDataUrl,
      textFrom,
      textTo,
      colors,
      quality,
      size,
      variations,
      transparent: raw.transparent === true,
    },
  }
}

/** 'SMITH' -> 'S-M-I-T-H'; spaces are named so gaps survive. */
export function spellOut(value: string): string {
  return [...value].map((c) => (c === ' ' ? '(space)' : c)).join('-')
}

const HOLD_ART =
  'Keep everything else exactly as it is: the composition, framing, subject, linework, colours, texture, any text, and the background.'
const NO_EXTRA_TEXT = 'Add no new text, watermark or signature.'

/** The prompt each tool sends. Pure — the schemas are pinned by tests. */
export function buildFlarePrompt(req: FlareRequest): string {
  const extra = req.prompt ? req.prompt : ''
  switch (req.op) {
    case 'edit':
      return [
        'This is a finished print design. Make ONE change to it.',
        `CHANGE: ${extra}`,
        `KEEP: ${HOLD_ART}`,
        NO_EXTRA_TEXT,
      ].join('\n')

    case 'inpaint':
      return [
        'Only the masked region of this design may change.',
        `IN THE MASKED REGION: ${extra}`,
        'Blend it seamlessly into the surrounding artwork — match its style, line weight, lighting, texture and colour palette.',
        'Everything outside the mask stays exactly as it is.',
        NO_EXTRA_TEXT,
      ].join('\n')

    case 'text': {
      const lines = ['This is a finished print design that contains lettering.']
      if (req.textFrom && req.textTo) {
        lines.push(
          `Replace the text "${req.textFrom}" with "${req.textTo}" ` +
            `(${[...req.textTo].length} characters: ${spellOut(req.textTo)}).`
        )
      } else if (req.textTo) {
        lines.push(`Change the main lettering so it reads exactly "${req.textTo}" (${spellOut(req.textTo)}).`)
      } else {
        lines.push(`Remove the text "${req.textFrom}" completely and continue the artwork behind it, leaving no ghost.`)
      }
      lines.push(
        'Match the ORIGINAL lettering exactly: the same typeface character and weight, outline layers, shadow, arch or curve, colours, texture and distressing.',
        'If the new text is longer or shorter, re-space and scale it to sit in the same band. Never move or shrink the rest of the art to make room.',
        'Spell every character exactly as given, in order.'
      )
      if (extra) lines.push(`ALSO: ${extra}`)
      lines.push(`KEEP: ${HOLD_ART}`, NO_EXTRA_TEXT)
      return lines.join('\n')
    }

    case 'blend': {
      const refs = req.refUrls.length
      return [
        `Image 1 is the design being edited. Image${refs > 1 ? `s 2-${refs + 1} are` : ' 2 is'} reference material.`,
        `INSTRUCTION: ${extra}`,
        "Bring in ONLY what the instruction asks for from the references, redrawn in image 1's own style so it looks like it was always part of the design.",
        "KEEP image 1's composition, framing, subject, linework, colours, texture, text and background unless the instruction says otherwise.",
        NO_EXTRA_TEXT,
      ].join('\n')
    }

    case 'variations':
      return [
        'Create a fresh variation of this print design.',
        'Keep the same subject, the same colour palette, the same print style and the same overall layout, but vary the details, pose and rendering so it reads as a sibling design, not a copy.',
        extra ? `DIRECTION: ${extra}` : '',
        'Keep any text spelled exactly as it is.',
        NO_EXTRA_TEXT,
      ]
        .filter(Boolean)
        .join('\n')

    case 'transparent':
      return [
        'Reproduce this artwork exactly, isolated on a fully transparent background.',
        'Remove every background element: backdrops, scenery, floor shadows, frames, borders, and any painted grey-and-white checkerboard pattern (that is fake transparency — it must go).',
        'Keep all of the artwork, text and fine detail, with clean crisp edges suitable for DTF printing on a garment.',
        extra ? `ALSO: ${extra}` : '',
      ]
        .filter(Boolean)
        .join('\n')

    case 'recolor':
      return [
        `Recolour this design using ONLY this palette: ${req.colors.join(', ')}.`,
        'Every shape, line, texture and piece of text stays exactly where and how it is — only the colours change.',
        'Keep light/dark contrast readable so the design still prints clearly.',
        extra ? `NOTES: ${extra}` : '',
        NO_EXTRA_TEXT,
      ]
        .filter(Boolean)
        .join('\n')

    case 'cleanup':
      return [
        'Clean this artwork up for garment printing without redesigning it.',
        'Sharpen soft or blurry edges, remove JPEG artefacts, noise, stray specks and halos, and remove any painted checkerboard (fake transparency).',
        'Flat-colour areas become clean solid colour. Small text becomes crisp and legible, spelled exactly as it is now.',
        'Do NOT change the design, subject, composition, colours or wording.',
        extra ? `ALSO: ${extra}` : '',
      ]
        .filter(Boolean)
        .join('\n')

    case 'restyle':
      return [
        `Redraw this design in this style: ${extra}.`,
        'Keep the same subject, composition and layout. Keep any text spelled exactly as it is.',
        NO_EXTRA_TEXT,
      ].join('\n')
  }
}

/** Background to request: transparent for the ops that are ABOUT transparency, else the source's own. */
export function backgroundFor(req: FlareRequest, sourceHasAlpha: boolean): 'transparent' | 'opaque' | undefined {
  if (req.op === 'transparent') return 'transparent'
  if (req.transparent) return 'transparent'
  // A cut-out stays a cut-out. Otherwise omitted, so the edit endpoint keeps
  // the source's own background.
  return sourceHasAlpha ? 'transparent' : undefined
}

const SIZE_LONG_EDGE: Record<FlareSize, number> = { standard: 1536, large: 2560 }
const MIN_PIXELS = 655_360
const MAX_PIXELS = 8_294_400

/**
 * Output size for a source of w x h: the source's aspect (clamped to 1:3..3:1),
 * long edge 1536 or 2560, both sides multiples of 16, inside the pixel budget.
 */
export function flareSize(w: number, h: number, size: FlareSize): { w: number; h: number } {
  const ratio = Math.min(3, Math.max(1 / 3, w > 0 && h > 0 ? w / h : 1))
  // The SHORT side rounds UP: rounding it down could push a 3:1 source past
  // the API's 3:1 limit (1536 x 509 -> 1536 x 496 is 3.1:1, refused).
  const snap = (n: number) => Math.max(16, Math.ceil(n / 16) * 16)
  let long = SIZE_LONG_EDGE[size]
  for (;;) {
    const out = ratio >= 1 ? { w: long, h: snap(long / ratio) } : { w: snap(long * ratio), h: long }
    const px = out.w * out.h
    if (px > MAX_PIXELS) {
      long -= 16
      continue
    }
    if (px < MIN_PIXELS) {
      long += 16
      continue
    }
    return out
  }
}

/** ITC per image, by quality tier. Roughly tracks the output-token bill (xhigh/max draw more). */
export const FLARE_ITC: Record<FlareQuality, number> = { low: 10, medium: 20, high: 40, xhigh: 60, max: 90 }

/** Total ITC for a request: per-image tier price x variations, x1.5 for the large canvas. */
export function flareCost(req: Pick<FlareRequest, 'quality' | 'size' | 'variations'>): number {
  const per = FLARE_ITC[req.quality] * (req.size === 'large' ? 1.5 : 1)
  return Math.ceil(per * req.variations)
}

/**
 * The browser paints "change here" as OPAQUE strokes on a transparent canvas.
 * OpenAI reads the opposite: TRANSPARENT mask pixels are the editable area.
 * So: take the painted alpha, resize it to the source, invert it into the
 * mask's alpha channel. Returns a w x h RGBA PNG.
 */
export async function buildOpenAIMask(painted: Buffer, w: number, h: number): Promise<Buffer> {
  const alpha = await sharp(painted)
    .ensureAlpha()
    .extractChannel(3)
    .resize(w, h, { fit: 'fill' })
    .raw()
    .toBuffer()
  const rgba = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    // Any paint at all counts: a soft brush edge still means "may change".
    rgba[i * 4 + 3] = alpha[i] > 16 ? 0 : 255
  }
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

/** Share of the mask that is editable — used to refuse an empty mask before paying for a call. */
export async function maskCoverage(mask: Buffer): Promise<number> {
  const { data, info } = await sharp(mask).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true })
  let open = 0
  for (let i = 0; i < data.length; i++) if (data[i] === 0) open++
  return open / (info.width * info.height)
}

async function loadImage(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load the image (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
}

export interface FlareResult {
  images: Array<{ url: string; modelId: string; lettering?: LetteringVerdict | null }>
  prompt: string
  size: string
  background: 'transparent' | 'opaque' | 'source'
}

/** Run one Flare Lab tool end to end and store the outputs under users/<uid>/flare/. */
export async function runFlare(req: FlareRequest, userId: string): Promise<FlareResult> {
  const raw = await loadImage(req.imageUrl)
  // PNG, dimensions intact: the mask has to match the source exactly, and PNG
  // is the one format every model in the chain accepts for both.
  const source = await sharp(raw).rotate().png().toBuffer()
  const meta = await sharp(source).metadata()
  const w = meta.width ?? 1024
  const h = meta.height ?? 1024

  let hasAlpha = false
  if (meta.hasAlpha) {
    const { channels } = await sharp(source).stats()
    hasAlpha = (channels[channels.length - 1]?.min ?? 255) < 250
  }

  let mask: Buffer | undefined
  if (req.maskDataUrl) {
    mask = await buildOpenAIMask(dataUrlToBuffer(req.maskDataUrl), w, h)
    if ((await maskCoverage(mask)) < 0.002) throw new Error('The painted area is empty — paint over what you want changed')
  }

  const out = flareSize(w, h, req.size)
  const background = backgroundFor(req, hasAlpha)
  const prompt = buildFlarePrompt(req)

  const images = await editOpenAIImageMany({
    sourceUrl: req.imageUrl,
    sourceBuffer: source,
    refUrls: req.refUrls,
    prompt,
    userId,
    objectPath: `users/${userId}/flare/${req.op}-${Date.now()}.png`,
    size: `${out.w}x${out.h}`,
    quality: req.quality,
    background,
    mask,
    n: req.variations,
    model: FLARE_MODEL,
  })

  return {
    images: images.map((i) => ({ url: i.url, modelId: i.modelId })),
    prompt,
    size: `${out.w}x${out.h}`,
    background: background ?? 'source',
  }
}
