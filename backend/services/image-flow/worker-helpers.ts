// Helpers for the ai-jobs-worker — wraps the image-flow providers and returns just
// a generated image URL. The worker handles its own GCS upload + DB writes.

import { runReplicate } from './providers/replicate.js'
import { runFal } from './providers/fal.js'
import { buildInput } from './input-builder.js'
import { MODELS, getModel, DEFAULT_GENERATE_MODEL, DEFAULT_MOCKUP_MODEL, ADMIN_MULTI_MODEL_IDS } from './models.js'
import { enhancePrompt } from './prompt-enhancer.js'
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
  /** The model-specific rewrite of the user's prompt that actually ran. */
  tailoredPrompt?: string
}

/**
 * Pick the best 4 models for this brief. Strengths are matched against intent
 * signals in the prompt (text-in-image, cartoon/stylized, photoreal), with a
 * cost and latency bias so cheaper, faster models win ties — e.g. a generic
 * brief drops the $0.08/30s model in favor of Grok at $0.02/4s.
 */
// Imagen 4 ULTRA stays out of the design fan-out — its safety filter
// false-positives hardest on benign design prompts (E005 "flagged as
// sensitive" / "NSFW content detected"), and a deterministic pick killed half
// of every batch. Imagen 4 FAST is kept in the rotation with the loosest
// safety_filter_level (set in input-builder); as just one of a larger
// randomized pool, a rare block only costs a single slot.
const FANOUT_EXCLUDE = new Set(['google/imagen-4-ultra'])

export function pickFanOutModels(prompt: string, imageStyle?: string): string[] {
  const p = prompt.toLowerCase()
  const wantsText = /"[^"]+"|\b(says?|text|typography|lettering|font|quote|slogan|wording)\b/.test(p)
  const wantsCartoon = imageStyle === 'cartoon' || /\b(cartoon|anime|chibi|illustrat\w*|comic|kawaii|mascot|sticker)\b/.test(p)
  const wantsPhotoreal = imageStyle === 'realistic' || /\b(photo\w*|realistic|photoreal\w*|portrait|cinematic)\b/.test(p)

  const candidates = MODELS.filter((m) => ['workhorse', 'hero', 'text-in-image'].includes(m.tier) && !FANOUT_EXCLUDE.has(m.id))
  const scored = candidates.map((m) => {
    let score = m.tier === 'hero' ? 2 : 1
    if (wantsText && m.strengths.includes('text-in-image')) score += 3
    if (wantsCartoon && (m.strengths.includes('stylized') || m.strengths.includes('concept-art'))) score += 3
    if (wantsPhotoreal && (m.strengths.includes('photoreal-product') || m.strengths.includes('photoreal-people'))) score += 3
    if (!wantsText && m.tier === 'text-in-image') score -= 2 // typography specialists waste a slot otherwise
    score -= m.costPerImageUsd * 10
    score -= m.approxSeconds / 30
    return { id: m.id, score }
  })
  scored.sort((a, b) => b.score - a.score)

  // ROTATE: keep the relevance ranking to form a strong top pool, then SHUFFLE
  // it so repeat generations vary which engines run (so a 4-image batch isn't
  // always the same four). Pool = top 8 by score; the caller slices to count.
  const poolSize = Math.min(scored.length, 8)
  const pool = scored.slice(0, poolSize).map((s) => s.id)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, 4)
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
  /** Art style from the wizard — feeds intent-based model selection. */
  imageStyle?: string
  /** Skip the per-model LLM prompt rewrite (use the raw prompt everywhere). */
  skipEnhance?: boolean
  /**
   * Hard background instruction appended to EACH model's prompt AFTER the
   * per-model rewrite — so the rule (e.g. "solid black background, no
   * transparency") always survives verbatim, exactly like the DTF garment
   * wrapping. Non-garment design path only.
   */
  backgroundClause?: string
}): Promise<MultiGenerateResult[]> {
  // Dynamic roster: match the 4 models to what the brief is asking for,
  // unless the caller pins an explicit list.
  const ids = opts.modelIds ?? pickFanOutModels(opts.prompt, opts.imageStyle)
  console.log('[image-flow] 🎯 Fan-out roster:', ids.join(', '))

  const isGarment =
    opts.category && /shirt|hoodie|tank|tee/i.test(opts.category)

  // Per-model prompt tailoring — each model gets the brief rewritten in its
  // own dialect (the registry's promptCraft playbook). Rewrites run in
  // parallel and fall back to the raw prompt per-model on any failure, so the
  // enhancer can never block generation. DTF wrapping is applied AFTER the
  // rewrite so the print-safety rules always survive verbatim.
  const tailored = await Promise.all(
    ids.map(async (id) => {
      const model = getModel(id)
      if (!model || opts.skipEnhance) return opts.prompt
      try {
        const r = await enhancePrompt({ prompt: opts.prompt, purpose: 'product', model })
        return r.enhanced?.trim() || opts.prompt
      } catch (e: any) {
        console.warn('[image-flow] ⚠️ prompt enhance failed for', id, '—', e.message)
        return opts.prompt
      }
    })
  )

  const finalPrompts = tailored.map((t) =>
    isGarment
      ? buildDTFPrompt(
          t,
          (opts.shirtColor === 'gray' ? 'grey' : opts.shirtColor) ?? 'black',
          opts.printStyle ?? 'clean'
        )
      : opts.backgroundClause
        ? `${t}\n\n${opts.backgroundClause}`
        : t
  )

  if (isGarment) {
    console.log('[image-flow] 🎨 Wrapping prompt with DTF rules for category:', opts.category)
  }

  const results = await Promise.allSettled(
    ids.map(async (id, i) => {
      const model = getModel(id)
      if (!model) throw new Error(`unknown image-flow model: ${id}`)
      const input = buildInput(model, { prompt: finalPrompts[i], extra: opts.extra })
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
      return { modelId: r.value.id, modelLabel: r.value.label, status: 'succeeded', url: r.value.url, tailoredPrompt: tailored[i] }
    }
    const err = r.reason instanceof Error ? r.reason.message : String(r.reason)
    return { modelId: id, modelLabel: label, status: 'failed', error: err, tailoredPrompt: tailored[i] }
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

/**
 * Empty-garment-scene prompt pair (positive + negative).
 * Used only for flat_lay and ghost_mannequin in the 2-step pipeline.
 *
 * Why split into two strings: Imagen 4 on Replicate honors a dedicated
 * `negative_prompt` parameter far more strictly than negations embedded in the
 * positive prompt. The previous "STRICTLY FORBIDDEN: …" block lived in the
 * positive string, which is exactly where Imagen down-weights distant tokens —
 * so the recurring "all three mockups come back as Mr. Imagine" hallucination
 * survived. Splitting the negation out and passing it via the proper
 * `negative_prompt` field is what finally locks the empty-garment scene.
 *
 * Why text-only at all: when the design image is sent as the sole input to an
 * edit model with "treat as decal, generate new scene" instructions, the model
 * keeps preserving the input's background/composition as the scene and
 * frequently hallucinates a wearer that looks like the Mr. Imagine mascot.
 * With no input image at all, there is nothing to preserve, so the model
 * produces a clean empty-garment photo from text alone.
 *
 * Template-aware negatives: ghost_mannequin INTENTIONALLY shows an
 * invisible-mannequin form (3D garment shape, hollow collar), so the negative
 * must NOT forbid "mannequin shape" / "body" / "torso taper" — that
 * contradicts the positive ("shoulders filled, chest rounded") and pushes the
 * model to hallucinate a real wearer (the recurring Mr. Imagine bug on the
 * ghost slot). flat_lay has no garment form at all, so we can forbid mannequin
 * shapes outright.
 */
function buildEmptyGarmentPromptPair(opts: RunMockupOpts): { prompt: string; negativePrompt: string } {
  const productName = PRODUCT_NAMES[opts.productType] ?? 't-shirt'
  const fabricColor = COLOR_DESC[opts.shirtColor] ?? 'black'

  // Negative variants name the specific failure mode (a purple furry character
  // / "Mr. Imagine") because Imagen treats explicit named exclusions much more
  // strictly than abstract ones when they're in the negative_prompt field.
  // (In the positive prompt the same names act as priming, which is why we
  // moved them out.)
  const noWearerNeg = `real human, person, face, head, hands, arms, legs, skin, model, wearer, mascot, character, cartoon character, animal, furry creature, purple character, Mr. Imagine, logos, text, graphics, print on fabric`

  const noWearerOrFormNeg = `human, body, head, face, hands, arms, legs, skin, model, wearer, mannequin shape, mascot, character, cartoon character, animal, furry creature, purple character, Mr. Imagine, logos, text, graphics, print on fabric, multiple garments`

  if (opts.template === 'ghost_mannequin') {
    return {
      prompt: `Professional ghost-mannequin / invisible-mannequin product photograph of a single plain ${fabricColor} ${productName} on a pure white (#FFFFFF) seamless background. The garment holds its 3D shape — shoulders filled, chest rounded, natural torso taper, slight sleeve volume, hollow collar showing the inside fabric — as if a person had been completely removed from the photo. Standard Amazon / Shopify listing photography. Soft grounding shadow, clean even studio e-commerce lighting. Just the empty hollow garment, centered, e-commerce catalog quality.`,
      negativePrompt: noWearerNeg,
    }
  }
  // flat_lay
  return {
    prompt: `Professional flat-lay catalog photograph of a single plain ${fabricColor} ${productName}, laid flat by itself on a clean white surface. Camera shoots straight down — top-down overhead view. Fabric lies flat with slight natural texture and minor wrinkles, soft even studio lighting, subtle grounding shadow. Clean minimal white background. E-commerce / Amazon listing quality. Just the empty garment laid flat, nothing else in the frame.`,
    negativePrompt: noWearerOrFormNeg,
  }
}

/**
 * Prompt for compositing a design (decal) onto an already-generated empty
 * garment scene. Input 1 = empty garment photo (preserve scene). Input 2 =
 * design graphic (apply as decal). This is the gpt-image-2 sweet spot:
 * multi-image compositing with clearly-roled inputs.
 */
function buildCompositePrompt(opts: RunMockupOpts): string {
  const productName = PRODUCT_NAMES[opts.productType] ?? 't-shirt'
  const placement = PLACEMENT_DESC[opts.printPlacement ?? 'front-center'] ?? PLACEMENT_DESC['front-center']
  // Anti-drift block names the specific failure mode (the Mr. Imagine purple
  // furry mascot) instead of a generic "no character". Nano Banana treats
  // explicit named exclusions much more strictly than abstract ones.
  //
  // Template-aware exclusions: for ghost_mannequin, INPUT 1 already contains
  // the invisible-mannequin garment form by design, so we MUST NOT tell the
  // model to remove "mannequin" or "body shape" — that contradicts INPUT 1
  // and pushes the model to hallucinate a real wearer (the recurring Mr.
  // Imagine bug). For flat_lay there is no garment form at all, so we can
  // forbid mannequins outright.
  const forbiddenList = opts.template === 'ghost_mannequin'
    ? `do NOT add a real human wearer, model, mascot, character, cartoon character, animal, furry creature, purple character, or "Mr. Imagine" into the scene. Do NOT add any face, head, hands, arms, or skin. Keep the invisible-mannequin garment form from INPUT 1 exactly as-is — empty and unworn.`
    : `do NOT add a wearer, model, mannequin, mascot, character, cartoon character, animal, furry creature, purple character, or "Mr. Imagine" into the scene. Do NOT add any body, head, face, hands, arms, or skin. Keep the flat-lay garment from INPUT 1 exactly as-is.`
  return `INPUT 1 is a product photograph of an empty plain ${productName}. INPUT 2 is a flat 2D graphic design (a decal / DTF print artwork). Task: print the graphic from INPUT 2 onto the ${productName} in INPUT 1, ${placement}. Preserve INPUT 1 exactly — same scene, same camera angle, same lighting, same background, same garment shape, same fabric color, no wearer added. Preserve INPUT 2's colors, shapes, and proportions exactly. Make the print look like a realistic DTF transfer on cotton — sized correctly, conforming to the fabric's curvature and folds. STRICTLY FORBIDDEN: ${forbiddenList} The garment stays empty exactly as in INPUT 1 — the only change is that the graphic from INPUT 2 now appears printed on the fabric. Output a single composited photograph: the unchanged empty-garment scene from INPUT 1, with the graphic from INPUT 2 printed on the garment, nothing else added.`
}

function buildMrImaginePrompt(opts: RunMockupOpts): string {
  const productName = PRODUCT_NAMES[opts.productType] ?? 't-shirt'
  const fabricColor = COLOR_DESC[opts.shirtColor] ?? 'black'
  const placement = PLACEMENT_DESC[opts.printPlacement ?? 'front-center'] ?? PLACEMENT_DESC['front-center']
  return `Create a lifestyle mockup featuring Mr. Imagine. The FIRST input image shows Mr. Imagine (a friendly purple furry character) wearing a ${fabricColor} ${productName}. The SECOND input image is a graphic design — apply it ${placement} on the ${productName}. Keep Mr. Imagine exactly as in the first image (character, pose, fabric color). Make the print look like a real DTF graphic on cotton. Professional lifestyle photography with natural lighting. Result: Mr. Imagine proudly modeling the custom ${productName}.`
}

/**
 * Generate a mockup.
 *
 *  - mr_imagine: single call to nano-banana (Gemini 2.5 Flash Image) with
 *    [character, design]. Nano-banana excels at character + design compositing.
 *
 *  - flat_lay / ghost_mannequin: 2-step pipeline to defeat Money's recurring
 *    "all three mockups come back as Mr. Imagine" bug.
 *      Step A: text-only generation of the EMPTY garment scene via
 *              google/imagen-4-fast — a photoreal-product specialist with no
 *              prior contact with the Mr. Imagine character. Nothing to
 *              preserve, nothing to drift toward.
 *      Step B: multi-image composite [empty_garment, design] via
 *              google/nano-banana — the dedicated mockup model that already
 *              powers the mr_imagine slot reliably; it handles clearly-roled
 *              inputs (scene to preserve + decal to apply) without falling
 *              back to a "person wearing clothing" prior.
 *
 *  Why these models: previous attempts used openai/gpt-image-2 for both
 *  steps. That model has been the consistent failure point — even with no
 *  input image, it kept producing Mr. Imagine-like wearers in the
 *  empty-garment slot. Swapping both steps to Google models (Imagen + Nano
 *  Banana) eliminates the OpenAI-side drift. Cost drops from ~$0.08 to
 *  ~$0.059 per non-character mockup; latency stays in the same ballpark.
 *
 *  Earlier attempts (in git history): three prompt iterations on single-call
 *  gpt-image-2 edit, then a 2-step pipeline still using gpt-image-2 for
 *  both halves. All failed because the bias lived in the model, not the
 *  prompt.
 *
 *  Callers can pass opts.modelId to force a single-call path with the legacy
 *  behavior (backwards-compatible escape hatch for admin overrides).
 */
export async function runImageFlowMockup(opts: RunMockupOpts): Promise<{ url: string; modelId: string }> {
  if (opts.template === 'mr_imagine') {
    const modelId = opts.modelId ?? DEFAULT_MOCKUP_MODEL
    const model = getModel(modelId)
    if (!model) throw new Error(`unknown image-flow model: ${modelId}`)
    const inputImages = opts.characterImageUrl
      ? [opts.characterImageUrl, opts.designImageUrl]
      : [opts.designImageUrl]
    const input = buildInput(model, { prompt: buildMrImaginePrompt(opts), inputImages })
    const r = model.provider === 'replicate'
      ? await runReplicate({ modelId: model.id, input })
      : await runFal({ modelId: model.id, input })
    return { url: r.imageUrls[0], modelId: model.id }
  }

  // Legacy single-call path if caller explicitly forces a model (admin override).
  if (opts.modelId) {
    const model = getModel(opts.modelId)
    if (!model) throw new Error(`unknown image-flow model: ${opts.modelId}`)
    const input = buildInput(model, {
      prompt: buildCompositePrompt(opts),
      inputImages: [opts.designImageUrl],
    })
    const r = model.provider === 'replicate'
      ? await runReplicate({ modelId: model.id, input })
      : await runFal({ modelId: model.id, input })
    return { url: r.imageUrls[0], modelId: model.id }
  }

  // 2-step pipeline for flat_lay / ghost_mannequin.
  // Step A: empty-garment scene from text only via Imagen 4 Fast.
  // Imagen is a photoreal-product specialist with no contact with the Mr.
  // Imagine brand, so it cannot drift toward the mascot — provided we use the
  // dedicated `negative_prompt` parameter instead of cramming negations into
  // the positive prompt (where Imagen down-weights them).
  const sceneModelId = 'google/imagen-4-fast'
  const sceneModel = getModel(sceneModelId)
  if (!sceneModel) throw new Error(`unknown image-flow model: ${sceneModelId}`)
  const { prompt: scenePrompt, negativePrompt: sceneNeg } = buildEmptyGarmentPromptPair(opts)
  const sceneInput = buildInput(sceneModel, {
    prompt: scenePrompt,
    extra: { negative_prompt: sceneNeg },
  })
  const sceneRes = sceneModel.provider === 'replicate'
    ? await runReplicate({ modelId: sceneModel.id, input: sceneInput })
    : await runFal({ modelId: sceneModel.id, input: sceneInput })
  const emptyGarmentUrl = sceneRes.imageUrls[0]

  // Step B: composite the design onto the empty garment via Nano Banana.
  // Same model that already drives the mr_imagine slot reliably.
  const compositeModelId = 'google/nano-banana'
  const compositeModel = getModel(compositeModelId)
  if (!compositeModel) throw new Error(`unknown image-flow model: ${compositeModelId}`)
  const compositeInput = buildInput(compositeModel, {
    prompt: buildCompositePrompt(opts),
    inputImages: [emptyGarmentUrl, opts.designImageUrl],
  })
  const compositeRes = compositeModel.provider === 'replicate'
    ? await runReplicate({ modelId: compositeModel.id, input: compositeInput })
    : await runFal({ modelId: compositeModel.id, input: compositeInput })
  return { url: compositeRes.imageUrls[0], modelId: compositeModel.id }
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
