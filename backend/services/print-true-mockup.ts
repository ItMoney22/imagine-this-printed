// Print-true garment mockups: generate the garment EMPTY, then composite the
// real print file onto it. Nothing regenerates the artwork, so the print on the
// mockup is the print that ships.
//
// Why this exists (David 2026-09-09, "we are getting really bad mockups"):
// asking an image model to draw the design onto a garment re-illustrates it.
// Measured on product 5a846616, whose design reads "TIDINGS of TREE TRIMMING /
// Make It a WILDERNESS HOLIDAY":
//
//   nano-banana, family cast   -> "FURRY FINNANCE / WILDERNESS SEASON"
//   gpt-image-2.5-flare, family-> "FARM FRESH CHRISTMAS TREES / WILDERNESS HAPPY"
//   nano-banana, solo cast     -> "TRADITIONS of TREE TRIMMING / WONDERFUL HOLIDAY"
//   gpt-image-2.5-flare, solo  -> "FRESH CUT CHRISTMAS TREES / WILDERNESS HAPPY"
//
// Five renders, two engines, both cast sizes, every one wrong - and the prompt
// already demanded letter-exact reproduction. This is not a prompt problem and
// not an engine problem; generative models re-draw rather than copy.
//
// What made this newly possible is GPT Image 2.5 honouring
// `background: 'transparent'` and returning real alpha (verified live
// 2026-09-09). mockup-composite.ts derives the garment box from that alpha, so
// for the first time the garment can be GENERATED (keeping the ghost-mannequin
// or hanger look the storefront already uses) and still take a composited,
// pixel-exact print. Proven end to end: 30s for the blank, 0.31s to composite,
// and the transcription gate reads every word back correctly.
import sharp from 'sharp'
import { runOpenAIImage } from './image-flow/providers/openai-image.js'
import { compositeMockup, placementFor } from './mockup-composite.js'

/** Templates that are a plain garment we can generate empty and then print. */
const PRINT_TRUE_TEMPLATES = new Set(['ghost_mannequin', 'flat_lay', 'hanger'])

/**
 * Metal art is a full-bleed panel, and the Mr. Imagine character templates put
 * a character in the frame — neither is "a garment with a print box on the
 * chest", so neither goes down this path.
 */
export function supportsPrintTrue(template: string | undefined): boolean {
  return !!template && PRINT_TRUE_TEMPLATES.has(template)
}

/** How each template should be staged, as the empty garment. */
const STAGING: Record<string, string> = {
  ghost_mannequin:
    'photographed as an invisible-mannequin (ghost mannequin) product shot: filled three-dimensional torso ' +
    'volume, rounded shoulders, a hollow open collar, front view',
  flat_lay:
    'laid perfectly flat and neatly styled, photographed straight down from above, front view, sleeves relaxed',
  hanger:
    'on a plain wooden hanger, hanging straight, front view, with the natural drape of the fabric',
}

/**
 * The brief for the EMPTY garment.
 *
 * Every clause about "no print" is load-bearing: this garment is about to be
 * printed by the compositor, and any graphic the model invents here would sit
 * UNDER the real one and show around its edges.
 */
export function buildBlankGarmentPrompt(
  garmentNoun: string,
  colorLabel: string,
  template: string
): string {
  const staging = STAGING[template] || STAGING.ghost_mannequin
  return (
    `A plain ${colorLabel} ${garmentNoun} ${staging}, with natural cotton texture, soft realistic fabric ` +
    `folds and even studio lighting.\n` +
    `The garment is completely BLANK: no print, no graphic, no artwork, no logo, no text, no label and no ` +
    `pattern anywhere on it. Nothing but the garment itself, on a fully transparent background — no floor, ` +
    `no wall, no backdrop, no shadow cast onto a surface.`
  )
}

export interface PrintTrueOpts {
  /** The print file — the transparent artwork that will actually be printed. */
  design: Buffer
  garmentNoun: string
  /** Human colour label for the prompt, e.g. "black". */
  colorLabel: string
  /** Fabric hex, so the composite tints the blank to the real garment colour. */
  colorHex?: string
  template: string
  /** Garment id for the print placement table (tee vs hoodie sit differently). */
  garment?: string
  size?: number
}

/**
 * Render one print-true mockup, or null if anything goes wrong.
 *
 * Null rather than throw, deliberately: the caller falls back to the existing
 * generative render, so the worst case of this path is exactly today's
 * behaviour rather than a failed mockup.
 */
export async function renderPrintTrueMockup(opts: PrintTrueOpts): Promise<{ buffer: Buffer; modelId: string } | null> {
  if (!supportsPrintTrue(opts.template)) return null
  try {
    const { url, modelId } = await runOpenAIImage({
      prompt: buildBlankGarmentPrompt(opts.garmentNoun, opts.colorLabel, opts.template),
      quality: 'high',
      size: '1024x1024',
      background: 'transparent',
      moderation: 'low',
    })
    const res = await fetch(url)
    if (!res.ok) throw new Error(`blank garment fetch ${res.status}`)
    const blank = Buffer.from(await res.arrayBuffer())

    // No alpha means no garment silhouette, so the compositor cannot place the
    // print — that is a fall-back, not a guess.
    const meta = await sharp(blank).metadata()
    if (!meta.hasAlpha) throw new Error('blank garment came back opaque')

    const composed = await compositeMockup({
      base: blank,
      design: opts.design,
      colorHex: opts.colorHex,
      size: opts.size ?? 1024,
      ...placementFor(opts.garment),
    })
    return { buffer: composed.buffer, modelId: `print-true/${modelId}+composite` }
  } catch (err: any) {
    console.warn(`[print-true] ${opts.template} fell back to the generative render (${err?.message || err})`)
    return null
  }
}
