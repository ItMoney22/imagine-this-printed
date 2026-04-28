// Helpers for the ai-jobs-worker — wraps the image-flow providers and returns just
// a generated image URL. The worker handles its own GCS upload + DB writes.

import { runReplicate } from './providers/replicate.js'
import { runFal } from './providers/fal.js'
import { buildInput } from './input-builder.js'
import { getModel, DEFAULT_GENERATE_MODEL, DEFAULT_MOCKUP_MODEL, ADMIN_MULTI_MODEL_IDS } from './models.js'
import { buildDTFPrompt } from '../dtf-optimizer.js'

export interface RunGenerateOpts {
  prompt: string
  modelId?: string
  extra?: Record<string, unknown>
}

/** Generate a source design from a text prompt. Returns a (possibly temporary) URL. */
export async function runImageFlowGenerate(opts: RunGenerateOpts): Promise<{ url: string; modelId: string }> {
  const modelId = opts.modelId ?? DEFAULT_GENERATE_MODEL
  const model = getModel(modelId)
  if (!model) throw new Error(`unknown image-flow model: ${modelId}`)

  const input = buildInput(model, { prompt: opts.prompt, extra: opts.extra })
  const r = model.provider === 'replicate'
    ? await runReplicate({ modelId: model.id, input })
    : await runFal({ modelId: model.id, input })
  return { url: r.imageUrls[0], modelId: model.id }
}

export interface MultiGenerateResult {
  modelId: string
  modelLabel: string
  status: 'succeeded' | 'failed'
  url?: string
  error?: string
}

/**
 * Fan out a single prompt to multiple models in parallel.
 * Used by the admin product builder so the user can pick the best variant.
 * Defaults to the ADMIN_MULTI_MODEL_IDS roster (flux-2-max + grok-imagine + imagen-4-ultra).
 *
 * For garment categories (shirts/hoodies/tanks), the prompt is wrapped with
 * DTF-specific instructions: transparent background, no clothing in the design,
 * isolated artwork only.
 */
export async function runImageFlowMultiGenerate(opts: {
  prompt: string
  modelIds?: string[]
  extra?: Record<string, unknown>
  /** Garment category — when set, applies DTF prompt wrapping. */
  category?: string
  shirtColor?: 'black' | 'white' | 'grey' | 'gray' | 'color'
  printStyle?: 'clean' | 'halftone' | 'grunge'
}): Promise<MultiGenerateResult[]> {
  const ids = opts.modelIds ?? ADMIN_MULTI_MODEL_IDS

  // Wrap with DTF-aware prompt for garment categories.
  const isGarment =
    opts.category && /shirt|hoodie|tank|tee/i.test(opts.category)
  const finalPrompt = isGarment
    ? buildDTFPrompt(
        opts.prompt,
        (opts.shirtColor === 'gray' ? 'grey' : opts.shirtColor) ?? 'black',
        opts.printStyle ?? 'clean'
      )
    : opts.prompt

  if (isGarment) {
    console.log('[image-flow] 🎨 Wrapping prompt with DTF rules for category:', opts.category)
  }

  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const model = getModel(id)
      if (!model) throw new Error(`unknown image-flow model: ${id}`)
      const input = buildInput(model, { prompt: finalPrompt, extra: opts.extra })
      const r = model.provider === 'replicate'
        ? await runReplicate({ modelId: model.id, input, timeoutMs: 150_000 })
        : await runFal({ modelId: model.id, input, timeoutMs: 150_000 })
      return { id: model.id, label: model.label, url: r.imageUrls[0] }
    })
  )

  return results.map((r, i): MultiGenerateResult => {
    const id = ids[i]
    const label = getModel(id)?.label ?? id
    if (r.status === 'fulfilled') {
      return { modelId: r.value.id, modelLabel: r.value.label, status: 'succeeded', url: r.value.url }
    }
    const err = r.reason instanceof Error ? r.reason.message : String(r.reason)
    return { modelId: id, modelLabel: label, status: 'failed', error: err }
  })
}

export type MockupTemplate = 'flat_lay' | 'ghost_mannequin' | 'mr_imagine'

export interface RunMockupOpts {
  template: MockupTemplate
  designImageUrl: string
  productType: 'tshirt' | 'hoodie' | 'tank'
  shirtColor: 'black' | 'white' | 'gray' | 'grey'
  /** For mr_imagine — URL of the Mr. Imagine character base. */
  characterImageUrl?: string
  printPlacement?: 'front-center' | 'left-pocket' | 'back-only' | 'pocket-front-back-full'
  modelId?: string
}

const PRODUCT_NAMES: Record<string, string> = {
  tshirt: 't-shirt',
  hoodie: 'hoodie',
  tank: 'tank top',
}
const COLOR_DESC: Record<string, string> = {
  black: 'black',
  white: 'white',
  gray: 'heather gray',
  grey: 'heather grey',
}
const PLACEMENT_DESC: Record<string, string> = {
  'front-center': 'centered on the chest area',
  'left-pocket': 'small, positioned on the left chest pocket area',
  'back-only': 'large, centered on the back of the shirt',
  'pocket-front-back-full': 'small on the front-left pocket and large on the back',
}

function buildMockupPrompt(opts: RunMockupOpts): string {
  const productName = PRODUCT_NAMES[opts.productType] ?? 't-shirt'
  const fabricColor = COLOR_DESC[opts.shirtColor] ?? 'black'
  const placement = PLACEMENT_DESC[opts.printPlacement ?? 'front-center'] ?? PLACEMENT_DESC['front-center']

  if (opts.template === 'ghost_mannequin') {
    return `Create a professional ghost-mannequin product photo of a ${fabricColor} ${productName} on pure white (#FFFFFF) background. The first input image is the design — apply it ${placement}. The garment must look 3D and volumetric (shoulders filled, chest rounded, natural torso taper) as if worn by an invisible person. Show the inside of the collar (hollow neck effect). Sleeves slightly volumed. Soft grounding shadow. Studio e-commerce lighting, clean Amazon/retailer-grade product photo. Preserve the design exactly as shown.`
  }
  if (opts.template === 'flat_lay') {
    return `Create a professional flat-lay product photograph of a ${fabricColor} ${productName} laid flat on a clean white surface, shot from directly above. The first input image is the design — apply it ${placement} on the garment. Make the print look like a real DTF transfer on cotton. Slight natural fabric texture, soft even studio lighting, subtle grounding shadow. No mannequin, no model, no person — just the garment laid flat. Preserve the design exactly as shown.`
  }
  // mr_imagine: 2-image composite
  return `Create a lifestyle mockup featuring Mr. Imagine. The FIRST input image shows Mr. Imagine (a friendly purple furry character) wearing a ${fabricColor} ${productName}. The SECOND input image is a graphic design — apply it ${placement} on the ${productName}. Keep Mr. Imagine exactly as in the first image (character, pose, fabric color). Make the print look like a real DTF graphic on cotton. Professional lifestyle photography with natural lighting. Result: Mr. Imagine proudly modeling the custom ${productName}.`
}

/** Generate a mockup. Uses gpt-image-2 by default (multi-image input for mr_imagine). */
export async function runImageFlowMockup(opts: RunMockupOpts): Promise<{ url: string; modelId: string }> {
  const modelId = opts.modelId ?? DEFAULT_MOCKUP_MODEL
  const model = getModel(modelId)
  if (!model) throw new Error(`unknown image-flow model: ${modelId}`)

  const inputImages: string[] =
    opts.template === 'mr_imagine' && opts.characterImageUrl
      ? [opts.characterImageUrl, opts.designImageUrl]
      : [opts.designImageUrl]

  const prompt = buildMockupPrompt(opts)

  const input = buildInput(model, { prompt, inputImages })
  const r = model.provider === 'replicate'
    ? await runReplicate({ modelId: model.id, input })
    : await runFal({ modelId: model.id, input })
  return { url: r.imageUrls[0], modelId: model.id }
}

export interface RunEditOpts {
  sourceImageUrl: string
  prompt: string
  refImageUrls?: string[]
  modelId?: string
  extra?: Record<string, unknown>
}

/** Edit an existing image with a prompt (+ optional refs). Returns a (possibly temporary) URL. */
export async function runImageFlowEdit(opts: RunEditOpts): Promise<{ url: string; modelId: string }> {
  const modelId = opts.modelId ?? DEFAULT_MOCKUP_MODEL // gpt-image-2
  const model = getModel(modelId)
  if (!model) throw new Error(`unknown image-flow model: ${modelId}`)

  const inputImages = [opts.sourceImageUrl, ...(opts.refImageUrls ?? [])]
  const input = buildInput(model, { prompt: opts.prompt, inputImages, extra: opts.extra })
  const r = model.provider === 'replicate'
    ? await runReplicate({ modelId: model.id, input })
    : await runFal({ modelId: model.id, input })
  return { url: r.imageUrls[0], modelId: model.id }
}
