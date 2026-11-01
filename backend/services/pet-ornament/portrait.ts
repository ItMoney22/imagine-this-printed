// Pet ornament — the customer's photo in, their pet's four-colour portrait
// out (task 81358f3a).
//
// ONE paid call per new photo: a GPT Image 2.5 Flare edit at quality "low"
// through the house OpenAI chain (~10 s). Chosen on 2026-11-01 from a sweep of
// three real pet photos through Flare low, Flare medium and Nano Banana 2.1
// (jobs/saturn/20261101-t81358f3a-*.previews/ab): all three drew clean flat
// portraits that kept the pet's markings; after the four-colour cut the low
// tier printed as well as medium, Nano was ~2x slower, and Flare is the key
// production already holds. The same photo is never drawn twice (the id is
// the photo's hash), so "try again" with a new photo is the only new cost.
import sharp from 'sharp'
import { editOpenAIImage } from '../image-flow/providers/openai-image.js'
import { portraitFromPhotoPrompt } from './portrait-prompt.js'
import { quantizePortrait, type PortraitMap } from './quantize.js'
import { blobStore, loadPortrait, photoPath, portraitId, portraitPngPath, savePortrait } from './store.js'

export const PORTRAIT_MODEL = 'gpt-image-2.5-flare'
export const PORTRAIT_QUALITY = 'low' as const

/** The one paid call. Swappable so the walk harness can run without GCS. */
export const portraitDeps = {
  async draw(photo: Buffer, prompt: string, objectPath: string): Promise<{ png: Buffer; modelId: string }> {
    const out = await editOpenAIImage({
      sourceUrl: '',
      sourceBuffer: photo,
      prompt,
      model: PORTRAIT_MODEL,
      quality: PORTRAIT_QUALITY,
      size: '1024x1024',
      objectPath,
      userId: 'pet-ornaments',
    })
    return { png: await blobStore.read(out.path), modelId: out.modelId }
  },
}

export interface DrawnPortrait {
  id: string
  map: PortraitMap
  /** True when this call paid for a new drawing. */
  drawn: boolean
  modelId?: string
}

/** Normalises a customer photo: EXIF-rotated, at most 1024 px, PNG. Throws on anything that is not an image. */
export async function normalisePhoto(raw: Buffer): Promise<Buffer> {
  return sharp(raw, { limitInputPixels: 50_000_000 }).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
}

export async function drawPortrait(rawPhoto: Buffer, petLabel: string): Promise<DrawnPortrait> {
  const photo = await normalisePhoto(rawPhoto)
  const id = portraitId(photo)
  const existing = await loadPortrait(id)
  if (existing) return { id, map: existing, drawn: false }

  // Kept for the floor (a person can compare the print with the pet) and for
  // a redraw if the pipeline improves.
  await blobStore.write(photo, photoPath(id, 'png'), 'image/png')

  let drawnPng: Buffer
  let modelId: string | undefined
  if (await blobStore.exists(portraitPngPath(id))) {
    drawnPng = await blobStore.read(portraitPngPath(id))
  } else {
    const out = await portraitDeps.draw(photo, portraitFromPhotoPrompt(petLabel.toLowerCase()), portraitPngPath(id))
    modelId = out.modelId
    drawnPng = out.png
  }
  const { map } = await quantizePortrait(drawnPng)
  await savePortrait(id, map)
  return { id, map, drawn: true, modelId }
}
