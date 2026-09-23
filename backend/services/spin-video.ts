/**
 * The spin hero video's request — which frame(s), which engine, which prompt —
 * as a pure function of the product row, so the two-sided branch can be
 * tested without a Replicate call. The route (routes/ai/realtime.ts) only
 * loads the row, calls this, and fires the prediction.
 *
 * TWO-SIDED PRODUCTS TURN AROUND (David 2026-09-21: "when i do a video subject
 * should turn around and show the back"; 2026-09-22: "if we do a video shoot
 * it needs to be able to show front nd back").
 *
 * The first version of this asked grok-imagine-video to turn the model around
 * from a single FRONT photo. That model takes one image and no end frame, so
 * the back print it showed was whatever it imagined — the prompt's "do not
 * invent artwork" was an instruction it had no way to follow. Now a two-sided
 * product whose Step Flow has an on-person back shot (`model-back`, rendered
 * FROM the front shot, carrying the real back artwork) is animated as an
 * interpolation: front shot = first frame, back shot = last frame, on an
 * engine that takes both.
 */
import { productPrintsOnBack } from './step-flow/shots.js'

export const SPIN_VIDEO_MODEL = process.env.SPIN_VIDEO_MODEL || 'xai/grok-imagine-video'
export const SPIN_VIDEO_SECONDS = Math.min(15, Math.max(3, Number(process.env.SPIN_VIDEO_SECONDS) || 5))
/** Needs a first AND last frame input. kling-v2.5-turbo-pro: start_image + end_image, 5s or 10s. */
export const SPIN_VIDEO_TWO_SIDED_MODEL = process.env.SPIN_VIDEO_TWO_SIDED_MODEL || 'kwaivgi/kling-v2.5-turbo-pro'

export type SpinBackSource =
  /** One-sided product — nothing to turn around for. */
  | 'none'
  /** Two-sided, animated front shot -> on-person back shot. The back is real. */
  | 'paired'
  /** Two-sided but no matching on-person back shot yet: the video model has to
   *  imagine the back. Reported, never silent — the panel/log says so. */
  | 'imagined'

export interface SpinVideoPlan {
  model: string
  input: Record<string, unknown>
  prompt: string
  twoSided: boolean
  backSource: SpinBackSource
  /** Plain-English reason when the plan is weaker than it could be. */
  warning?: string
}

export interface SpinProductRow {
  images?: string[] | null
  metadata?: Record<string, any> | null
  print_locations?: string[] | null
}

/**
 * @param rand injectable for tests — the one-in-three jacket styling on
 *   one-sided products.
 */
export function planSpinVideo(product: SpinProductRow, rand: () => number = Math.random): SpinVideoPlan | { error: string } {
  const meta = (product.metadata || {}) as Record<string, any>
  const shots = meta.step_flow?.shots || {}
  // Source frame (David 2026-09-02): ALWAYS the on-person mockup — the
  // approved Step Flow model shot first, then the Etsy model shoot, then
  // whatever the gallery leads with. Never a flat lay.
  const stepModelShot: string | undefined =
    shots.model?.approved && typeof shots.model?.url === 'string' ? shots.model.url : undefined
  const shot: string | undefined = stepModelShot || meta.etsy_shots?.images?.[0] || product.images?.[0]
  if (!shot) return { error: 'No model shot or image to animate — shoot the model first.' }

  const baseColor: string = String(meta.shirt_color || 'black').replace(/-/g, ' ')
  const garmentNoun = meta.product_type === 'hoodie' ? 'hoodie' : 't-shirt'

  const twoSided = productPrintsOnBack({ metadata: meta, print_locations: product.print_locations ?? null })

  // The back shot only pairs with the front it was rendered FROM. A back made
  // from an older front take would cut to a different person mid-turn.
  const back = shots['model-back']
  const pairedBack: string | undefined =
    twoSided &&
    stepModelShot &&
    back?.status === 'done' &&
    typeof back.url === 'string' &&
    back.sourceAssetId &&
    back.sourceAssetId === shots.model?.assetId
      ? back.url
      : undefined

  const fidelity =
    `The ${garmentNoun} keeps EXACTLY the same ${baseColor} fabric colour and every printed graphic stays ` +
    `undistorted and fully legible throughout — no colour change, no new graphics, no text overlays. `

  if (pairedBack) {
    const prompt =
      `Professional lifestyle fashion video of one person modeling a ${baseColor} ${garmentNoun}. ` +
      `They start facing the camera exactly as in the first frame so the front print reads clearly, then turn ` +
      `a smooth, unhurried 180 degrees on the spot and finish with their back to the camera exactly as in the ` +
      `last frame, the back print square-on and centred. Same person, same clothes, same location throughout. ` +
      fidelity +
      `The front print and the back print are the ones in the first and last frames: never swap, mirror, merge ` +
      `or duplicate them. Steady camera, soft flattering light, no cuts.`
    return {
      model: SPIN_VIDEO_TWO_SIDED_MODEL,
      prompt,
      twoSided,
      backSource: 'paired',
      input: {
        start_image: shot,
        end_image: pairedBack,
        prompt,
        // kling's only lengths are 5 and 10.
        duration: SPIN_VIDEO_SECONDS > 5 ? 10 : 5,
        negative_prompt:
          'colour change, extra text, new graphics, mirrored print, print on the wrong side, second person, cut, jump cut, morphing face',
      },
    }
  }

  // David 2026-09-02: "i dont want the shirt to change color anymore ... they
  // should be modeling the shirt sometimes the shirt can be under a jacket".
  // The jacket variant is suppressed for two-sided products: an open jacket is
  // styled to keep the FRONT visible, the opposite of what a turn is for.
  const jacketVariant = !twoSided && rand() < 0.34
  const styling = twoSided
    ? `They start facing the camera so the front print reads clearly, then turn a full 180 degrees, unhurried, and hold with their back to the camera so the design on the BACK of the ${garmentNoun} is square-on, centred and fully legible for the last half of the clip. `
    : jacketVariant
      ? `They are wearing an open, unbuttoned jacket over the ${garmentNoun} (denim, flannel or a light bomber), and the front of the ${garmentNoun} with the printed design stays fully visible the whole time. `
      : `They model the ${garmentNoun} naturally — shifting their weight, turning slightly to show the print, a relaxed smile, maybe tugging the hem straight. `
  const prompt =
    `Professional lifestyle fashion video of the same person from the reference image modeling the ${baseColor} ${garmentNoun}. ` +
    styling +
    fidelity +
    (twoSided ? `Both printed designs are the ones already on the garment: do not invent, duplicate or mirror artwork onto either side. ` : '') +
    `Natural handheld-steady camera, soft flattering light, same location as the reference, no cuts.`

  return {
    model: SPIN_VIDEO_MODEL,
    prompt,
    twoSided,
    backSource: twoSided ? 'imagined' : 'none',
    ...(twoSided
      ? {
          warning:
            'This product prints on the back but has no on-person back shot made from its approved front shot, ' +
            'so the video model has to imagine the back. Approve the "On a person — back" shot in the Step Flow ' +
            'for a turn that shows the real back print.',
        }
      : {}),
    input: { image: shot, prompt, duration: SPIN_VIDEO_SECONDS, resolution: '720p' },
  }
}
