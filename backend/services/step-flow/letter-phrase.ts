// Step Flow — letter a phrase INTO a design that already exists.
//
// David 2026-09-09: "the phrases or ask mrs imagine to come up with a phrase
// she is going off the prompt and it really doesnt match the design of the
// image so it sucks can we fix that in the flow".
//
// The old order made that unavoidable: phrase -> prompt -> render. The phrase
// had to be chosen before anything was drawn, so it could only ever be a guess
// at the art. Reversing the order is the fix — draw first, LOOK
// (./phrases.ts's pitchPhrasesForDesign), then letter the winning line onto
// the picture that is already on screen.
//
// The words are added with an image EDIT, not a fresh render, and that is the
// whole point of David's choice here: a re-render off a new prompt returns
// DIFFERENT art, so the take he picked would be gone. `editOpenAIImage` keeps
// the artwork and changes only what the prompt asks for — the same call
// already running the Imagination Station refine path, the metal mockups and
// the Etsy model shots.
//
// The result lands as ANOTHER take (product_assets kind:'source',
// asset_role:'design', is_primary false), so it appears beside the originals
// in the Design step and is chosen with the same "Use this" button. Nothing
// downstream needed a new concept: select-design -> rembg -> approve runs
// untouched, and if David hates the lettering the original take is still
// sitting right next to it.
import { supabase } from '../../lib/supabase.js'
import { editOpenAIImage } from '../image-flow/providers/openai-image.js'
import { runCopyrightGate } from '../etsy-copyright-gate.js'
import { coercePhraseInput, letteringStyleClause, type StepBriefPhrase } from './brief.js'

/** Thrown for expected, user-facing rejections — the route maps this to 400 (mirrors StepFlowValidationError in shots.ts). */
export class LetterPhraseValidationError extends Error {}
/** Thrown when the asset does not exist on this product — the route maps this to 404. */
export class LetterPhraseNotFoundError extends Error {}

export interface LetteredDesign {
  asset: any
  phrase: StepBriefPhrase
  modelId: string
}

/**
 * The edit instruction. Deliberately built from the SAME
 * `letteringStyleClause` the up-front render uses (./brief.ts), so one
 * lettering style id cannot come out looking like two different typefaces
 * depending on which path drew it.
 *
 * Everything after the first sentence exists because an image edit will
 * happily repaint the whole canvas if you let it: the run of "change nothing
 * else" clauses is what keeps this an addition to David's take rather than a
 * new picture that merely resembles it.
 */
export function buildLetteringPrompt(phrase: StepBriefPhrase): string {
  return [
    `Add the exact text "${phrase.text}" to this artwork, ${letteringStyleClause(phrase.style)}, spelled exactly as written, placed ${phrase.placement} the existing subject.`,
    'The lettering must sit in the empty space around the subject and must not cover, crop, or obscure any part of the existing artwork.',
    'Match the artwork\'s own palette and finish so the words read as part of the original design, not a caption pasted on top.',
    'Change NOTHING else: keep the subject, the pose, the composition, the colours, the line work, and the background exactly as they are.',
    'Keep the background the same flat solid colour it already is — do not add scenery, texture, gradients, or a mockup.',
  ].join(' ')
}

/** The three sizes the image models take; anything else is snapped to the nearest by aspect so the lettered take keeps the original's shape. */
function sizeForAsset(width: unknown, height: unknown): '1024x1024' | '1024x1536' | '1536x1024' {
  const w = typeof width === 'number' && width > 0 ? width : 1024
  const h = typeof height === 'number' && height > 0 ? height : 1024
  const ratio = w / h
  if (ratio > 1.15) return '1536x1024'
  if (ratio < 0.87) return '1024x1536'
  return '1024x1024'
}

/**
 * Letters a phrase onto one existing design take and saves the result as a new
 * take on the same product.
 *
 * The phrase runs the same funnel as one typed at the Idea step
 * (`coercePhraseInput`) plus the Etsy copyright gate — a pitched line was
 * already filtered in phrases.ts, but this route also accepts hand-typed text,
 * and a trademark reaching the image model is exactly the failure the gate
 * exists to stop.
 */
export async function letterPhraseIntoDesign(
  productId: string,
  assetId: string,
  phraseInput: unknown,
  opts?: { userId?: string }
): Promise<LetteredDesign> {
  const phrase = coercePhraseInput(phraseInput)
  if (!phrase) throw new LetterPhraseValidationError('A phrase is required')

  const gate = runCopyrightGate({ name: phrase.text })
  if (!gate.pass) {
    throw new LetterPhraseValidationError(
      `That phrase can't go on a listing — it matches ${gate.matchedTerms.join(', ')}. Pick another line.`
    )
  }

  const { data: asset, error: assetError } = await supabase
    .from('product_assets')
    .select('*')
    .eq('id', assetId)
    .eq('product_id', productId)
    .single()
  if (assetError || !asset) throw new LetterPhraseNotFoundError('Asset not found on this product')
  // Same rule select-design enforces: only a raw generated take can be
  // lettered. Lettering a mockup or the details card would put words on a
  // photo of a shirt rather than on the print file.
  if (asset.kind !== 'source' || !asset.url) {
    throw new LetterPhraseValidationError('Only a generated design take can have words added — pick one of the takes')
  }

  const size = sizeForAsset(asset.width, asset.height)
  const { url, path, modelId } = await editOpenAIImage({
    sourceUrl: asset.url,
    prompt: buildLetteringPrompt(phrase),
    size,
    quality: 'high',
    // House pipeline: the standard filter false-positives on stylized design
    // work (see OpenAIImageOpts.moderation), and this edit only ever adds
    // copyright-gated text to art we drew ourselves.
    moderation: 'low',
    userId: opts?.userId,
    objectPath: `graphics/step-flow/${productId}/lettered/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
  })

  const [w, h] = size.split('x').map((n) => parseInt(n, 10))
  const { data: inserted, error: insertError } = await supabase
    .from('product_assets')
    .insert({
      product_id: productId,
      kind: 'source',
      path,
      url,
      width: w,
      height: h,
      asset_role: 'design',
      is_primary: false,
      display_order: 99,
      metadata: {
        model_id: modelId,
        // Surfaces as the take's label in the Design step's grid
        // (getDesignCandidates reads metadata.model_name), so the lettered
        // take is obvious at a glance instead of looking like a fourth render.
        model_name: `Lettered - "${phrase.text}"`,
        provider: 'openai',
        lettered: true,
        lettered_from_asset_id: assetId,
        phrase,
        generated_at: new Date().toISOString(),
      },
    })
    .select()
    .single()
  if (insertError) throw new Error(insertError.message)

  return { asset: inserted, phrase, modelId }
}
