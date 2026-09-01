// Helpers for the ai-jobs-worker — wraps the image-flow providers and returns just
// a generated image URL. The worker handles its own GCS upload + DB writes.

import { runReplicate } from './providers/replicate.js'
import { runOpenAIImage, editOpenAIImage } from './providers/openai-image.js'
import { buildInput } from './input-builder.js'
import { MODELS, getModel, DEFAULT_GENERATE_MODEL, DEFAULT_EDIT_MODEL, DEFAULT_MOCKUP_MODEL, ADMIN_MULTI_MODEL_IDS, type ImageModel } from './models.js'
import { enhancePrompt } from './prompt-enhancer.js'
import { buildDTFPrompt } from '../dtf-optimizer.js'
import { metalScaleAnchor, type MetalArtSizeKey } from '../../shared/metal-art.js'
import { getGarment } from '../../shared/catalog-capability.js'

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

  const r = await runRegisteredModel(model, { prompt: opts.prompt, extra: opts.extra })
  return { url: r.url, modelId: model.id }
}

// --- Provider dispatch -------------------------------------------------------
// House quality/size for OpenAI-direct generation (David 2026-08-20: pay for
// quality on the stuff we sell). Replicate-routed models ignore these.
const OPENAI_QUALITIES = ['low', 'medium', 'high', 'auto'] as const
const OPENAI_SIZES = ['1024x1024', '1536x1024', '1024x1536', 'auto'] as const
type OpenAIQuality = (typeof OPENAI_QUALITIES)[number]
type OpenAISize = (typeof OPENAI_SIZES)[number]

function houseOpenAIQuality(extra?: Record<string, unknown>): OpenAIQuality {
  const q = String(extra?.quality ?? process.env.HOUSE_GPT_IMAGE_QUALITY ?? 'high').toLowerCase()
  return (OPENAI_QUALITIES as readonly string[]).includes(q) ? (q as OpenAIQuality) : 'high'
}

function houseOpenAISize(extra?: Record<string, unknown>): OpenAISize {
  // The registry's aspect_ratio nativeParam maps onto the model's real sizes.
  const ar = String(extra?.aspect_ratio ?? '')
  if (ar === '3:2') return '1536x1024'
  if (ar === '2:3') return '1024x1536'
  const size = String(process.env.HOUSE_GPT_IMAGE_SIZE || '1024x1024')
  return (OPENAI_SIZES as readonly string[]).includes(size) ? (size as OpenAISize) : '1024x1024'
}

/**
 * Run a registry model through its provider. provider:'openai' goes straight
 * to the OpenAI Images API (no Replicate markup/queue — David 2026-08-20);
 * everything else keeps the Replicate path. Same {url} shape either way, and
 * both are "possibly temporary" to callers, who re-upload to their canonical
 * GCS location (the OpenAI provider persists to a staging GCS path already).
 */
async function runRegisteredModel(
  model: ImageModel,
  req: { prompt: string; inputImages?: string[]; extra?: Record<string, unknown>; timeoutMs?: number }
): Promise<{ url: string }> {
  if (model.provider === 'openai') {
    const quality = houseOpenAIQuality(req.extra)
    const size = houseOpenAISize(req.extra)
    if (req.inputImages?.length) {
      const [sourceUrl, ...refUrls] = req.inputImages
      const r = await editOpenAIImage({ sourceUrl, refUrls, prompt: req.prompt, quality, size, moderation: 'low' })
      return { url: r.url }
    }
    const r = await runOpenAIImage({ prompt: req.prompt, quality, size, moderation: 'low' })
    return { url: r.url }
  }
  const input = buildInput(model, { prompt: req.prompt, inputImages: req.inputImages, extra: req.extra })
  const r = await runReplicate({ modelId: model.id, input, timeoutMs: req.timeoutMs })
  return { url: r.imageUrls[0] }
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
      const r = await runRegisteredModel(model, { prompt: finalPrompts[i], extra: opts.extra, timeoutMs: 150_000 })
      return { id: model.id, label: model.label, url: r.url }
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

export type MockupTemplate = 'flat_lay' | 'ghost_mannequin' | 'hanger' | 'mr_imagine' | 'metal_shelf' | 'metal_wall'

export interface RunMockupOpts {
  template: MockupTemplate
  designImageUrl: string
  productType: 'tshirt' | 'hoodie' | 'tank' | 'polo'
  shirtColor: 'black' | 'white' | 'gray' | 'grey'
  /** For mr_imagine — URL of the Mr. Imagine character base. */
  characterImageUrl?: string
  printPlacement?: 'front-center' | 'left-pocket' | 'back-only' | 'front-back' | 'pocket-front-back-full'
  /**
   * Physical print width in inches (garments). Drives the explicit scale
   * language in the composite prompts — without it the only size instruction
   * is "sized correctly", which is how 11-inch front prints kept rendering as
   * all-over coverage. Defaults to 11 (standard adult front print).
   */
  printSizeInches?: number
  /** For metal_shelf / metal_wall — physical panel size; drives the scale anchors. */
  metalSize?: MetalArtSizeKey
  modelId?: string
  /**
   * What QA rejected about the previous attempt (services/mockup-qa.ts). Fed
   * back into the composite prompt so a retry is a corrective re-render rather
   * than a blind re-roll of the same prompt that just failed.
   */
  retryNote?: string
  /**
   * PROTOTYPE (flat_lay / ghost_mannequin): optional blank-garment photo used
   * as a second reference image alongside the design in the single-call
   * flux-2-pro path. When supplied the garment becomes image 1 and the design
   * image 2, which locks fabric colour and drape to a real product photo
   * instead of leaving them to the model. Omit and the design is the only
   * reference — the garment is then described in prose.
   */
  garmentRefImageUrl?: string
  /**
   * PROTOTYPE: force the single-call flux-2-pro path for flat_lay /
   * ghost_mannequin instead of the 2-step Imagen 4 Fast → Nano Banana chain.
   * Defaults to the MOCKUP_FLUX2_SINGLE_CALL env flag (off).
   */
  singleCallFlux2?: boolean
}

/**
 * Defaulted ON 2026-08-16 (Watchtower task 6456344b) after grading a real
 * 40-job batch (20 flat_lay + 20 ghost_mannequin, real production designs,
 * all 3 garment colors) with the flag forced true: 0/40 wearer/Mr. Imagine
 * hallucinations, 0/40 E005-sensitive refusals (the earlier n=13 prototype
 * bench saw 1 E005; combined ~1.9%, and the fallback below means a refusal
 * only costs latency, never a failed job). See
 * docs/FLUX2_SINGLE_CALL_GRADING_REPORT.md for the full data and rubric.
 *
 * Kill switch preserved: MOCKUP_FLUX2_SINGLE_CALL=false (or 0/no/off) forces
 * the 2-step chain with no code change or redeploy needed.
 */
function flux2SingleCallEnabled(): boolean {
  const raw = process.env.MOCKUP_FLUX2_SINGLE_CALL
  if (raw === undefined || raw === '') return true
  return !/^(0|false|no|off)$/i.test(raw)
}

const SINGLE_CALL_FLUX2_MODEL = 'black-forest-labs/flux-2-pro'

const PRODUCT_NAMES: Record<string, string> = {
  tshirt: 't-shirt',
  hoodie: 'hoodie',
  tank: 'tank top',
  polo: 'polo shirt',
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
  // A single render can only show one side, so the two-sided product's own
  // placement reads front-biased. The back view is produced by a SEPARATE
  // mockup job whose input.printPlacement is overridden to 'back-only' at
  // fan-out (routes/admin/ai-products.ts), so this string is only reached if
  // a front-back job was queued without the per-side override.
  'front-back': 'centered on the chest area (this product is also printed on the back, but this photo shows the front)',
  'pocket-front-back-full': 'small on the front-left pocket and large on the back',
}

/**
 * Explicit physical-scale language for the print. The composite prompts used
 * to say only "sized correctly", and image models resolved that ambiguity by
 * blowing the graphic up until it covered the whole garment (David 2026-08-09:
 * "some of them cover the shirts when we do 11 inch"). Anchoring the size to
 * inches AND a fraction of the garment's width gives the model two redundant
 * constraints it actually respects.
 */
export function buildSizeClause(opts: RunMockupOpts): string {
  const placement = opts.printPlacement ?? 'front-center'
  if (placement === 'left-pocket') {
    return ' The graphic is a small pocket-scale print about 4 inches (10 cm) wide — roughly a fifth of the garment\'s width — sitting on the left chest, with the rest of the garment completely blank.'
  }
  const inches = Math.min(16, Math.max(3, Math.round(opts.printSizeInches || 11)))
  const cm = Math.round(inches * 2.54)
  // Adult garment chest width ≈ 21in; the fraction is prose, not a number,
  // because models follow "about half the width" better than "52%".
  const ratio = inches / 21
  const fraction = ratio <= 0.28 ? 'about a quarter' : ratio <= 0.45 ? 'about a third' : ratio <= 0.58 ? 'about half' : 'about two-thirds'
  if (placement === 'pocket-front-back-full') {
    return ` The front pocket graphic is about 4 inches wide; the back graphic is about ${inches} inches (${cm} cm) wide — ${fraction} of the garment's width.`
  }
  const where = placement === 'back-only'
    ? 'centered high on the back, top edge a few inches below the collar'
    : 'centered on the chest, top edge a couple of inches below the collar'
  return ` The printed graphic is scaled true to a real ${inches}-inch-wide (${cm} cm) DTF transfer on an adult garment — ${fraction} of the garment's width, ${where}, with clear blank fabric visible above, below, and on both sides of the print. NEVER enlarge the graphic into an edge-to-edge or all-over print; most of the garment's fabric must remain blank.`
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
export function buildEmptyGarmentPromptPair(opts: RunMockupOpts): { prompt: string; negativePrompt: string } {
  const productName = PRODUCT_NAMES[opts.productType] ?? 't-shirt'
  const fabricColor = COLOR_DESC[opts.shirtColor] ?? 'black'

  // The background MUST contrast with the garment. A white garment on a white
  // background is the classic image-model failure: with no contrast to anchor
  // the subject, Imagen darkens the garment to gray/black so it stays visible —
  // which is exactly why white-shirt flat-lay/ghost mockups came back black
  // while the static-asset Mr. Imagine slot stayed white. So light garments get
  // a soft neutral-gray studio backdrop; dark/mid garments keep clean white.
  const isWhiteGarment = opts.shirtColor === 'white'
  const bgDesc = isWhiteGarment
    ? 'a soft neutral light-gray seamless studio background (#d6d8dc)'
    : 'a pure white (#FFFFFF) seamless background'
  // Positive insurance that a light garment is rendered light, plus matching
  // negatives so the model can't fall back to a dark garment for contrast.
  const lightAssertion = isWhiteGarment
    ? ` The ${productName} fabric is genuinely bright white (#FFFFFF) cotton — render it as a clearly white, well-lit garment that stands out against the gray backdrop; never darken, shade, or tint it gray or black.`
    : ''
  const darkGarmentNeg = isWhiteGarment
    ? ', black garment, dark garment, gray garment, charcoal shirt, navy shirt, underexposed garment, dim garment'
    : ''

  // Negative variants name the specific failure mode (a purple furry character
  // / "Mr. Imagine") because Imagen treats explicit named exclusions much more
  // strictly than abstract ones when they're in the negative_prompt field.
  // (In the positive prompt the same names act as priming, which is why we
  // moved them out.)
  // Ghost slot ALSO needs anti-flat pressure. Without it this list only said
  // "no wearer", so Imagen was free to satisfy the prompt with a flat garment —
  // which is why the ghost and flat_lay slots kept coming back looking like the
  // same photo (David 2026-07-29: "doesn't look like we got the ghost
  // mannequin"). The positive asks for volume; nothing was pushing away from
  // flatness, and Step B then faithfully preserves whatever Step A produced.
  const flatNeg = 'flat lay, flat garment, laid flat, lying flat, folded garment, folded shirt, top-down view, overhead shot, birds-eye view, flattened fabric, deflated garment, empty limp fabric, creased flat cotton, two-dimensional garment, garment on a table, garment on the floor, hanger, coat hanger, clothes hanger'

  const noWearerNeg = `real human, person, face, head, hands, arms, legs, skin, model, wearer, mascot, character, cartoon character, animal, furry creature, purple character, Mr. Imagine, logos, text, graphics, print on fabric, ${flatNeg}${darkGarmentNeg}`

  const noWearerOrFormNeg = `human, body, head, face, hands, arms, legs, skin, model, wearer, mannequin shape, mascot, character, cartoon character, animal, furry creature, purple character, Mr. Imagine, logos, text, graphics, print on fabric, multiple garments${darkGarmentNeg}`

  if (opts.template === 'ghost_mannequin') {
    return {
      // Camera angle is stated explicitly and first: a ghost mannequin is shot
      // STRAIGHT ON at chest height. Leaving the angle unspecified let Imagen
      // pick a top-down framing, which reads as a flat lay no matter how much
      // volume language follows.
      prompt: `Professional ghost-mannequin / invisible-mannequin product photograph of a single plain ${fabricColor} ${productName}, standing upright and photographed STRAIGHT ON at chest height with the camera level — eye-level front view, never from above — on ${bgDesc}. The garment is inflated into a full three-dimensional human torso form and holds that shape in mid-air: shoulders filled out and squared, chest and belly rounded with real internal volume, natural waist taper, sleeves rounded as if arms fill them, and a hollow open collar looking down into the inside of the garment. It must read unmistakably as a solid 3D garment floating with the body removed — clear depth, side planes visible, soft self-shadowing inside the folds. Standard Amazon / Shopify listing photography. Soft grounding shadow beneath, clean even studio e-commerce lighting.${lightAssertion} Just the empty hollow garment, centered, e-commerce catalog quality.`,
      negativePrompt: noWearerNeg,
    }
  }
  // flat_lay
  return {
    prompt: `Professional flat-lay catalog photograph of a single plain ${fabricColor} ${productName}, laid flat by itself on ${bgDesc}. Camera shoots straight down — top-down overhead view. Fabric lies flat with slight natural texture and minor wrinkles, soft even studio lighting, subtle grounding shadow.${lightAssertion} Just the empty garment laid flat, nothing else in the frame.`,
    negativePrompt: noWearerOrFormNeg,
  }
}

/**
 * Prompt for compositing a design (decal) onto an already-generated empty
 * garment scene. Input 1 = empty garment photo (preserve scene). Input 2 =
 * design graphic (apply as decal). This is the gpt-image-2 sweet spot:
 * multi-image compositing with clearly-roled inputs.
 */
/**
 * Corrective clause appended when QA rejected the previous render. Naming the
 * specific defect is the whole point — re-running an identical prompt that just
 * failed mostly reproduces the same failure.
 */
function retryClause(opts: RunMockupOpts): string {
  if (!opts.retryNote) return ''
  return ` CORRECTION — a print-QA inspector rejected the previous attempt for this reason: "${String(opts.retryNote).slice(0, 200)}". Fix exactly that problem in this render while keeping everything else the same.`
}

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
    ? `do NOT add a real human wearer, model, mascot, character, cartoon character, animal, furry creature, purple character, or "Mr. Imagine" into the scene. Do NOT add any face, head, hands, arms, or skin. Keep the invisible-mannequin garment form from INPUT 1 exactly as-is — empty and unworn. Do NOT flatten the garment, do NOT turn it into a flat lay, do NOT lay it on a surface, and do NOT change the camera angle: the inflated three-dimensional torso volume, the rounded shoulders and sleeves, and the hollow open collar from INPUT 1 must all survive completely unchanged.`
    : `do NOT add a wearer, model, mannequin, mascot, character, cartoon character, animal, furry creature, purple character, or "Mr. Imagine" into the scene. Do NOT add any body, head, face, hands, arms, or skin. Keep the flat-lay garment from INPUT 1 exactly as-is.`
  return `INPUT 1 is a product photograph of an empty plain ${productName}. INPUT 2 is a flat 2D graphic design (a decal / DTF print artwork). Task: print the graphic from INPUT 2 onto the ${productName} in INPUT 1, ${placement}. Preserve INPUT 1 exactly — same scene, same camera angle, same lighting, same background, same garment shape, same fabric color, no wearer added. Preserve INPUT 2's colors, shapes, and proportions exactly. Make the print look like a realistic DTF transfer on cotton, conforming to the fabric's curvature and folds.${buildSizeClause(opts)} STRICTLY FORBIDDEN: ${forbiddenList} The garment stays empty exactly as in INPUT 1 — the only change is that the graphic from INPUT 2 now appears printed on the fabric. Output a single composited photograph: the unchanged empty-garment scene from INPUT 1, with the graphic from INPUT 2 printed on the garment, nothing else added.${retryClause(opts)}`
}

/**
 * PROTOTYPE — single-call flux-2-pro prompt for flat_lay / ghost_mannequin.
 *
 * This collapses the 2-step chain (empty-garment scene → composite) into one
 * flux-2-pro call that takes the design (and optionally a blank-garment photo)
 * as reference images.
 *
 * The prompt is deliberately written in a DIFFERENT dialect from
 * buildEmptyGarmentPromptPair / buildCompositePrompt, and the difference is
 * not cosmetic. Both of those lean on explicit exclusions — Imagen's dedicated
 * `negative_prompt` field and a "STRICTLY FORBIDDEN: do NOT add a wearer …
 * Mr. Imagine" block. flux-2-pro has NO negative_prompt parameter, and Black
 * Forest Labs explicitly document that phrasing a request as an exclusion can
 * make the excluded thing appear ("it might actually add what you're trying to
 * avoid"). Naming the mascot in a negation here would therefore risk summoning
 * the exact failure the 2-step pipeline was built to kill.
 *
 * So every constraint below is stated positively: the garment is "empty",
 * "unworn", "hollow", the frame "contains only" the garment, the backdrop is
 * "uninterrupted". Do not reintroduce "no ..." / "do NOT ..." phrasing here.
 */
function buildFlux2SingleCallPrompt(opts: RunMockupOpts): string {
  const productName = PRODUCT_NAMES[opts.productType] ?? 't-shirt'
  const fabricColor = COLOR_DESC[opts.shirtColor] ?? 'black'
  const placement = PLACEMENT_DESC[opts.printPlacement ?? 'front-center'] ?? PLACEMENT_DESC['front-center']

  // Same contrast rule as the 2-step path: a white garment on a white backdrop
  // has nothing to anchor against, so image models darken the garment to keep
  // it visible — which is how white shirts kept coming back black.
  const isWhiteGarment = opts.shirtColor === 'white'
  const bgDesc = isWhiteGarment
    ? 'a soft neutral light-gray seamless studio background (#d6d8dc)'
    : 'a pure white (#FFFFFF) seamless background'
  const lightAssertion = isWhiteGarment
    ? ` The fabric is bright white (#FFFFFF) cotton, well lit and clearly lighter than the gray backdrop.`
    : ''

  // Reference-image roles. flux-2-pro addresses references by index, so the
  // prompt has to agree with the array order used in runImageFlowMockup.
  const hasGarmentRef = !!opts.garmentRefImageUrl
  const designIdx = hasGarmentRef ? 'image 2' : 'image 1'
  const garmentClause = hasGarmentRef
    ? `Image 1 is a photograph of the blank ${fabricColor} ${productName} — keep its exact fabric colour, cut, and proportions. `
    : ''

  const sceneDesc =
    opts.template === 'ghost_mannequin'
      ? `Professional ghost-mannequin product photograph of a single ${fabricColor} ${productName} on ${bgDesc}. The garment is empty and unworn and holds its own three-dimensional shape — shoulders filled out, chest rounded, natural torso taper, slight sleeve volume, and a hollow collar opening that reveals the inside of the fabric, as an invisible-mannequin e-commerce catalog shot. Soft grounding shadow, clean even studio lighting.`
      : `Professional flat-lay catalog photograph of a single ${fabricColor} ${productName} lying flat and unworn on ${bgDesc}, photographed straight down from directly overhead. The fabric lies flat with soft natural texture and minor natural wrinkles, soft even studio lighting, subtle grounding shadow.`

  return `${garmentClause}${sceneDesc}${lightAssertion} The artwork in ${designIdx} is printed on the ${productName} ${placement}, rendered as a realistic DTF transfer on cotton that follows the fabric's curvature and folds while preserving the artwork's exact colours, shapes, and proportions. The frame contains only the empty garment resting on an uninterrupted seamless backdrop, photographed as a clean product-only e-commerce listing image.`
}

/**
 * Hanger mockup — new Step Flow template (plan
 * docs/plans/2026-09-01-imagine-studio-step-flow-plan.md, Track A #3).
 * Single-call flux-2-pro, same mechanism as flat_lay/ghost_mannequin's
 * default path (one reference image, the design), but its own prompt: a
 * garment on a wooden hanger is the entire point of this shot, which is
 * exactly what buildEmptyGarmentPromptPair's flat_lay negative list forbids
 * ("hanger, coat hanger, clothes hanger" — anti-flat-lay pressure for a
 * template that must never show a hanger). Reusing that list here would have
 * the hanger template fight its own premise, so this gets an independent
 * positive prompt and an independent negative list.
 *
 * flux-2-pro has no negative_prompt input (see buildFlux2SingleCallPrompt's
 * doc comment — BFL warns naming an exclusion can make it appear), so the
 * generation call below is purely positive, same as the flat_lay/
 * ghost_mannequin single-call path. buildHangerNegatives() is kept as its own
 * exported value anyway: a record of what this template must avoid, ready to
 * feed a negative_prompt-capable model if one ever replaces flux-2-pro here,
 * and independently testable so it can never accidentally re-borrow the
 * flat-lay list (which would forbid the hanger itself).
 */
export function buildHangerPrompt(opts: RunMockupOpts): string {
  const fabricColor = COLOR_DESC[opts.shirtColor] ?? 'black'
  const garmentNoun = getGarment(opts.productType)?.noun ?? PRODUCT_NAMES[opts.productType] ?? 't-shirt'
  return `${fabricColor} ${garmentNoun} hanging on a natural wooden hanger against a plain light studio wall, front view, straight-on, garment hanging naturally with soft fabric drape, the graphic printed front-center at true scale (${buildSizeClause(opts)})`
}

/** Hanger-specific negatives — deliberately does not overlap flat_lay's list. See buildHangerPrompt above. */
export function buildHangerNegatives(): string {
  return 'mannequin, ghost mannequin, invisible mannequin, human, person, model, wearer, body, torso, face, hands, arms, folded garment, flat lay, laid flat, garment on the floor, garment on the ground, text overlay, caption, watermark, logo overlay'
}

/**
 * Mr. Imagine character mockup.
 *
 * ANATOMY GUARD (David 2026-07-29: "mrimagine is missing a whole arm lol"):
 * the previous prompt only said "keep Mr. Imagine exactly as in the first
 * image", which nano-banana treats as a soft style hint, not a structural
 * constraint — so while repainting the garment it routinely dropped the arm
 * that isn't doing the waving. Nano Banana takes NO `negative_prompt`
 * parameter (see models.ts — its input is prompt + image_input), so the
 * exclusions have to be spelled out inside the positive prompt, the same way
 * buildCompositePrompt carries its STRICTLY FORBIDDEN block.
 */
export function buildMrImaginePrompt(opts: RunMockupOpts): string {
  const productName = PRODUCT_NAMES[opts.productType] ?? 't-shirt'
  const fabricColor = COLOR_DESC[opts.shirtColor] ?? 'black'
  const placement = PLACEMENT_DESC[opts.printPlacement ?? 'front-center'] ?? PLACEMENT_DESC['front-center']
  return `Create a lifestyle mockup featuring Mr. Imagine. The FIRST input image shows Mr. Imagine (a friendly purple furry character) wearing a ${fabricColor} ${productName}. The SECOND input image is a graphic design — apply it ${placement} on the ${productName}. The ONLY change you may make is printing that graphic onto the ${productName}. Keep Mr. Imagine pixel-for-pixel as he appears in the first image: same character, same pose, same fabric color, same face, same eyes, same fur. PRESERVE HIS COMPLETE ANATOMY — both arms present and fully visible with both hands, both legs and both feet present, every limb exactly where it is in the first image and none of them cropped, hidden, shortened, or removed. STRICTLY FORBIDDEN: missing arm, missing limb, only one arm, one-armed character, amputated or stumped limb, arm hidden behind or absorbed into the garment, limb swallowed by the sleeve, extra arms, extra limbs, duplicated or fused limbs, deformed or melted hands, altered face, changed pose. If a sleeve covers part of an arm, the rest of that arm and its hand must still emerge and be clearly visible. Make the print look like a real DTF graphic on cotton.${buildSizeClause(opts)} Professional lifestyle photography with natural lighting. Result: the same complete, unaltered Mr. Imagine proudly modeling the custom ${productName}.${retryClause(opts)}`
}

/**
 * Generate a mockup.
 *
 *  - mr_imagine: single call to nano-banana-2-lite (Gemini 3.1 Flash-Lite
 *    Image) with [character, design]. Nano Banana excels at character + design
 *    compositing; the lite tier holds the mascot and the print equally well.
 *
 *  - flat_lay / ghost_mannequin: 2-step pipeline to defeat Money's recurring
 *    "all three mockups come back as Mr. Imagine" bug.
 *      Step A: text-only generation of the EMPTY garment scene via
 *              google/imagen-4-fast — a photoreal-product specialist with no
 *              prior contact with the Mr. Imagine character. Nothing to
 *              preserve, nothing to drift toward.
 *      Step B: multi-image composite [empty_garment, design] via
 *              google/nano-banana-2-lite — the dedicated mockup model that
 *              already powers the mr_imagine slot reliably; it handles
 *              clearly-roled inputs (scene to preserve + decal to apply)
 *              without falling back to a "person wearing clothing" prior.
 *
 *  Why these models: previous attempts used openai/gpt-image-2 for both
 *  steps. That model has been the consistent failure point — even with no
 *  input image, it kept producing Mr. Imagine-like wearers in the
 *  empty-garment slot. Swapping both steps to Google models (Imagen + Nano
 *  Banana) eliminates the OpenAI-side drift. Cost dropped from ~$0.08 to
 *  ~$0.059 per non-character mockup; latency stayed in the same ballpark.
 *
 *  2026-07-26: step B moved from google/nano-banana v1 ($0.039) to
 *  google/nano-banana-2-lite ($0.034), taking the non-character mockup to
 *  ~$0.054. A 5-shot-per-arm A/B on these exact prompts showed lite is 2.07x
 *  faster (4.35s vs 9.02s avg predict), never drifted a wearer into the
 *  empty-garment scene, and reproduced outline strokes / letterform arcs that
 *  v1 flattened. Its one wart: it ignores output_format and always emits JPEG.
 *
 *  Earlier attempts (in git history): three prompt iterations on single-call
 *  gpt-image-2 edit, then a 2-step pipeline still using gpt-image-2 for
 *  both halves. All failed because the bias lived in the model, not the
 *  prompt.
 *
 *  Callers can pass opts.modelId to force a single-call path with the legacy
 *  behavior (backwards-compatible escape hatch for admin overrides).
 *
 *  DEFAULT (2026-08-16): the single-call flux-2-pro path collapses the
 *  flat_lay + ghost_mannequin chain into ONE black-forest-labs/flux-2-pro
 *  call that takes the design — and optionally a blank-garment photo via
 *  opts.garmentRefImageUrl — as reference images (~$0.03 vs ~$0.054, one
 *  round-trip vs two). It falls back to the 2-step chain on any error.
 *  flux-2-pro has no `negative_prompt` — the field that originally stopped
 *  the mascot hallucination — so this stayed opt-in until graded on a real
 *  batch; that grade (40 real jobs, 0 wearer/mascot hallucinations, 0 E005
 *  refusals) is why it is now the default. Set MOCKUP_FLUX2_SINGLE_CALL=false
 *  to force the 2-step chain. See buildFlux2SingleCallPrompt for why the
 *  constraints are re-expressed positively, and
 *  docs/FLUX2_SINGLE_CALL_GRADING_REPORT.md for the full data.
 */
export async function runImageFlowMockup(opts: RunMockupOpts): Promise<{ url: string; modelId: string }> {
  // Metal art — size-accurate staging (David 2026-07-28: a 4x6 must never be
  // mocked up looking massive on a wall). Single call to nano-banana with the
  // artwork as the only input; the prompt carries hard scale anchors from
  // shared/metal-art.ts for the panel's real physical size.
  if (opts.template === 'metal_shelf' || opts.template === 'metal_wall') {
    const sizeKey: MetalArtSizeKey = opts.metalSize ?? '4x6'
    const scene = opts.template === 'metal_wall'
      ? (sizeKey === '4x6'
        ? 'hanging on a wall in a tight close-up vignette beside a door frame and a light switch, a small accent piece'
        : 'hanging on a small wall spot above a desk, nearby furniture visible for scale')
      : (sizeKey === '4x6'
        ? 'standing on a styled desk among everyday objects — next to a coffee mug and a small plant'
        : 'standing on a wooden shelf leaning against the wall, books and a small plant beside it')
    const prompt =
      `The INPUT image is a piece of artwork. Task: a professional interior product photograph of that artwork ` +
      `reproduced as a thin, frameless, glossy aluminum metal print panel with clean edges, ${scene}. ` +
      `${metalScaleAnchor(sizeKey)} ` +
      'Photorealistic, tasteful minimal decor, soft natural light. ' +
      'CRITICAL: reproduce the artwork exactly — do not redraw, restyle, distort, crop, or reinterpret it in any way. ' +
      'High-resolution ecommerce product photography.'
    const modelId = 'google/nano-banana'
    const model = getModel(modelId)
    if (!model) throw new Error(`unknown image-flow model: ${modelId}`)
    const input = buildInput(model, { prompt, inputImages: [opts.designImageUrl] })
    const r = await runReplicate({ modelId: model.id, input })
    return { url: r.imageUrls[0], modelId: model.id }
  }

  if (opts.template === 'mr_imagine') {
    const modelId = opts.modelId ?? DEFAULT_MOCKUP_MODEL
    const model = getModel(modelId)
    if (!model) throw new Error(`unknown image-flow model: ${modelId}`)
    const inputImages = opts.characterImageUrl
      ? [opts.characterImageUrl, opts.designImageUrl]
      : [opts.designImageUrl]
    const input = buildInput(model, { prompt: buildMrImaginePrompt(opts), inputImages })
    const r = await runReplicate({ modelId: model.id, input })
    return { url: r.imageUrls[0], modelId: model.id }
  }

  // Hanger — same single-call flux-2-pro mechanism as flat_lay/ghost_mannequin
  // below (one Replicate call, the design as the sole reference image), but
  // its own prompt/negatives (see buildHangerPrompt's doc comment); no 2-step
  // fallback chain exists for this template, so a flux-2-pro failure surfaces
  // to the caller like any other job error.
  if (opts.template === 'hanger') {
    const model = getModel(SINGLE_CALL_FLUX2_MODEL)
    if (!model) throw new Error(`unknown image-flow model: ${SINGLE_CALL_FLUX2_MODEL}`)
    const input = buildInput(model, {
      prompt: buildHangerPrompt(opts),
      inputImages: [opts.designImageUrl],
      extra: { safety_tolerance: 5 },
    })
    console.log('[image-flow] 🧪 flux-2-pro single-call mockup — hanger')
    const r = await runReplicate({ modelId: model.id, input, timeoutMs: 150_000 })
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
    const r = await runReplicate({ modelId: model.id, input })
    return { url: r.imageUrls[0], modelId: model.id }
  }

  // DEFAULT PATH — single-call flux-2-pro for flat_lay / ghost_mannequin.
  //
  // One flux-2-pro call replaces the Imagen 4 Fast → Nano Banana chain, taking
  // the design (and optionally a blank-garment photo) as reference images.
  // Cost: ~$0.03 with one 1 MP reference vs ~$0.054 for the 2-step chain, and
  // one round-trip instead of two.
  //
  // On by default; MOCKUP_FLUX2_SINGLE_CALL=false (or opts.singleCallFlux2
  // explicitly false via the opts.modelId escape hatch above) forces the
  // 2-step chain below, which is the product of several failed single-call
  // attempts (see the doc comment on this function) and remains the fallback
  // on ANY flux-2-pro error — flux-2-pro cannot use the `negative_prompt`
  // field that originally fixed the mascot-hallucination bug, so this path
  // stayed opt-in until a 40-job real-batch grade (2026-08-16, Watchtower
  // task 6456344b) showed 0 hallucinations and 0 E005 refusals.
  if (opts.singleCallFlux2 ?? flux2SingleCallEnabled()) {
    const model = getModel(SINGLE_CALL_FLUX2_MODEL)
    if (!model) throw new Error(`unknown image-flow model: ${SINGLE_CALL_FLUX2_MODEL}`)
    // Order must match buildFlux2SingleCallPrompt's index references:
    // garment (when supplied) is image 1, design is the last image.
    const inputImages = opts.garmentRefImageUrl
      ? [opts.garmentRefImageUrl, opts.designImageUrl]
      : [opts.designImageUrl]
    const input = buildInput(model, {
      prompt: buildFlux2SingleCallPrompt(opts),
      inputImages,
      // 5 = most permissive. Garment mockups are benign commercial product
      // shots; the stricter default has a history of false-positiving on this
      // exact content (the Imagen E005 problem documented in FANOUT_EXCLUDE).
      extra: { safety_tolerance: 5 },
    })
    console.log(
      '[image-flow] 🧪 flux-2-pro single-call mockup —',
      opts.template,
      `(${inputImages.length} ref${inputImages.length === 1 ? '' : 's'})`
    )
    try {
      const r = await runReplicate({ modelId: model.id, input, timeoutMs: 150_000 })
      return { url: r.imageUrls[0], modelId: model.id }
    } catch (e: any) {
      // Never let the prototype take down a real mockup job — fall through to
      // the proven 2-step chain on any failure.
      console.warn(
        '[image-flow] ⚠️ flux-2-pro single-call failed, falling back to 2-step chain —',
        e?.message ?? e
      )
    }
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
  const sceneRes = await runReplicate({ modelId: sceneModel.id, input: sceneInput })
  const emptyGarmentUrl = sceneRes.imageUrls[0]

  // Step B: composite the design onto the empty garment via Nano Banana 2 Lite.
  // Same model that already drives the mr_imagine slot reliably.
  const compositeModelId = DEFAULT_MOCKUP_MODEL
  const compositeModel = getModel(compositeModelId)
  if (!compositeModel) throw new Error(`unknown image-flow model: ${compositeModelId}`)
  const compositeInput = buildInput(compositeModel, {
    prompt: buildCompositePrompt(opts),
    inputImages: [emptyGarmentUrl, opts.designImageUrl],
  })
  const compositeRes = await runReplicate({ modelId: compositeModel.id, input: compositeInput })
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
  // Edits stay on the premium engine (gpt-image-2) — only mockup COMPOSITING
  // moved to the cheap Nano Banana 2 Lite lane.
  const modelId = opts.modelId ?? DEFAULT_EDIT_MODEL
  const model = getModel(modelId)
  if (!model) throw new Error(`unknown image-flow model: ${modelId}`)

  const inputImages = [opts.sourceImageUrl, ...(opts.refImageUrls ?? [])]
  const r = await runRegisteredModel(model, { prompt: opts.prompt, inputImages, extra: opts.extra })
  return { url: r.url, modelId: model.id }
}
