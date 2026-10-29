// Mockups from her store assistant (David 2026-10-29: "crystal agent rico should handle mockups too. crystal gives him a
// image says mock this on a shirt he does it he comes up in a lightbox"). Not a second mockup engine: the render is the
// product builder's own runImageFlowMockup (services/image-flow/worker-helpers.ts, the call the worker's processMockupJob
// makes, on the same picture models), checked against her picture by the same verifyWithOneRetry (services/mockup-qa.ts).
// What this file adds is only what a chat needs and a product build does not: which ITP products she can see a picture
// on, the colour when she names none (the Step Flow's own colour advice), and the price, one picture at the Imagination
// 'generate' rate, which is what each picture in her Create a design flow costs her (routes/studio-flow.ts).
import { nanoid } from 'nanoid'
import { runImageFlowMockup, type RunMockupOpts } from './image-flow/worker-helpers.js'
import { verifyWithOneRetry } from './mockup-qa.js'
import { uploadImageFromUrl } from './google-cloud-storage.js'
import { measureArtworkStats, scoreColorsForGarment } from './step-flow/color-advice.js'
import { pricingService } from './imagination-pricing.js'
import { getGarment, type ColorId, type GarmentId } from '../shared/catalog-capability.js'
import type { MockupChoice } from './store-mockup-choice.js'

/** One picture at the Imagination 'generate' rate, read the way routes/studio-flow.ts reads it for her design steps. */
export async function mockupPriceItc(): Promise<number> {
  try {
    const cost = Number((await pricingService.getPricing('generate'))?.current_cost)
    if (Number.isFinite(cost) && cost > 0) return Math.round(cost)
  } catch {
    /* the default below */
  }
  return 15
}

/** The garment colour her picture shows best on, from the Step Flow's colour advice. Black when it can't be read. */
async function bestColor(designUrl: string, garment: GarmentId): Promise<ColorId> {
  try {
    const res = await fetch(designUrl, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`design ${res.status}`)
    return scoreColorsForGarment(await measureArtworkStats(Buffer.from(await res.arrayBuffer())), garment)[0]?.id ?? 'black'
  } catch {
    return 'black'
  }
}

export type MockupStage = 'Getting it ready…' | 'Putting your picture on it…' | 'Checking it against your picture…' | 'Saving it…'

/**
 * Renders her picture on the product and saves it under her store's assistant folder. Answers the stored path (the
 * route serves it through the media host) and the colour it was made in. Throws when the render fails; the caller
 * hands her credits back.
 */
export async function renderStoreMockup(opts: {
  slug: string
  designUrl: string
  choice: MockupChoice
  onStage?: (stage: MockupStage) => void | Promise<void>
}): Promise<{ path: string; color: ColorId | null; modelId: string; qaOk: boolean }> {
  const { choice, designUrl } = opts
  const stage = async (s: MockupStage) => { try { await opts.onStage?.(s) } catch { /* a stage line is only a label */ } }
  await stage('Getting it ready…')
  const metal = choice.product === 'metal'
  const garment = metal ? null : getGarment(choice.product)!
  const color = garment ? choice.color || (await bestColor(designUrl, garment.id)) : null
  // The builder's own product shot: a ghost mannequin for a garment (shots.ts pickTemplate), the wall scene for metal.
  const mockup: RunMockupOpts = {
    template: metal ? 'metal_wall' : 'ghost_mannequin',
    designImageUrl: designUrl,
    productType: garment?.id ?? 'tshirt',
    shirtColor: color ?? 'black',
    printPlacement: 'front-center',
    printSizeInches: garment?.printWidthInches ?? 11,
    metalSize: choice.size ?? undefined,
  }

  await stage('Putting your picture on it…')
  const first = await runImageFlowMockup(mockup)
  await stage('Checking it against your picture…')
  const kept = await verifyWithOneRetry(
    designUrl,
    first.url,
    'front-center',
    async (reason) => {
      try {
        return (await runImageFlowMockup({ ...mockup, retryNote: reason })).url || null
      } catch {
        return null
      }
    },
    `store mockup ${opts.slug} ${choice.product}`,
    mockup.printSizeInches
  )

  await stage('Saving it…')
  const { path } = await uploadImageFromUrl(kept.url, `products/vendor-stores/${opts.slug}/assistant/mockups/${nanoid(12)}.png`)
  return { path, color, modelId: first.modelId, qaOk: kept.check.ok }
}
