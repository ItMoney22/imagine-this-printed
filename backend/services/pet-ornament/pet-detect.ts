// Pet ornament — which pet is in the buyer's photo (task 5d007181).
//
// On the site the customer taps Cat, Dog or Bunny. An Etsy buyer only answers
// the listing's two questions (name + photo), and we ask nothing new, so the
// pet type is read off the photo. It does the same job the tap does: it is the
// word the portrait prompt uses ("Redraw the dog in this photo...") and the
// stock design if a photo can never be used.
//
// One small vision call on the house vision model (OPENAI_VISION_MODEL, the
// same one the mockup and casting checks use), the photo sent at low detail.
// The decision is pure (decidePet) and pinned by tests:
//   - the model saw no animal            -> unusable: the order is held, never a guessed print
//   - it named one of the template's pets -> that pet
//   - anything else / unsure / no answer  -> the closest stock shape it named, else the
//                                            template's first pet, flagged for a person
import OpenAI from 'openai'
import sharp from 'sharp'
import type { PetChoice } from '../../shared/pet-ornament.js'

const VISION_MODEL = () => process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra'
const isReasoningModel = (m: string) => /^(o[1-9]|gpt-5)/.test(m)

/** Below this the model's pick is used but a person is asked to look. */
export const PET_CONFIDENCE_FLOOR = 0.6

export interface PetVision {
  /** What the model says the animal is, in its own words ("golden retriever", "hamster", "none"). */
  animal: string
  /** Its pick among the template's pets, or null. */
  closest: string | null
  /** Is a real animal clearly the subject? */
  visible: boolean
  confidence: number
  modelId: string
  usage?: { input: number; output: number }
}

export interface PetDecision {
  pet: string
  /** vision = the model's pick; default = no usable answer, the template's first pet. */
  source: 'vision' | 'default'
  /** False only when the model is sure there is no animal to draw. */
  usable: boolean
  /** True when a person should look before this prints. */
  uncertain: boolean
  /** One plain line for the order and the floor. */
  reason: string
  vision: PetVision | null
}

export function decidePet(pets: PetChoice[], vision: PetVision | null, visionError?: string): PetDecision {
  const fallback = pets[0].id
  if (!vision) {
    return {
      pet: fallback, source: 'default', usable: true, uncertain: true, vision: null,
      reason: `pet type not checked (${visionError || 'no vision model'}); used the ${fallback} default`,
    }
  }
  if (!vision.visible) {
    return {
      pet: fallback, source: 'default', usable: false, uncertain: true, vision,
      reason: `no pet could be seen in the photo (saw: ${vision.animal || 'nothing'})`,
    }
  }
  const pick = pets.find((p) => p.id === vision.closest)
  if (!pick) {
    return {
      pet: fallback, source: 'default', usable: true, uncertain: true, vision,
      reason: `saw a ${vision.animal || 'pet'} but no matching shape; used the ${fallback} default`,
    }
  }
  const unsure = vision.confidence < PET_CONFIDENCE_FLOOR
  const exact = vision.animal.toLowerCase().includes(pick.id) || (pick.id === 'bunny' && /rabbit|hare/.test(vision.animal.toLowerCase()))
  return {
    pet: pick.id, source: 'vision', usable: true, uncertain: unsure, vision,
    reason: exact
      ? `photo shows a ${vision.animal} (${Math.round(vision.confidence * 100)}% sure)`
      : `photo shows a ${vision.animal}; closest shape ${pick.id} (${Math.round(vision.confidence * 100)}% sure)`,
  }
}

/** Parses the model's JSON. Anything malformed is null, never guessed at. */
export function parseVision(content: string | null | undefined, pets: PetChoice[], modelId: string): PetVision | null {
  if (!content) return null
  let raw: any
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const animal = typeof raw.animal === 'string' ? raw.animal.trim().toLowerCase().slice(0, 40) : ''
  const closest = typeof raw.closest === 'string' && pets.some((p) => p.id === raw.closest.trim().toLowerCase()) ? raw.closest.trim().toLowerCase() : null
  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? Math.max(0, Math.min(1, raw.confidence)) : 0
  if (typeof raw.pet_visible !== 'boolean') return null
  return { animal, closest, visible: raw.pet_visible, confidence, modelId }
}

export function petPrompt(pets: PetChoice[]): string {
  const ids = pets.map((p) => p.id).join(', ')
  return (
    'A customer sent this photo of their pet so we can make a small ornament of it. ' +
    'Look at the main animal in the photo. Reply in JSON: ' +
    '{"animal": "what the animal is, one to three plain words (e.g. cat, golden retriever, rabbit, hamster), or none", ' +
    `"closest": "the closest of: ${ids}", ` +
    '"pet_visible": true if a real animal is clearly the subject (a photo of a pet, not a drawing, toy or empty scene), else false, ' +
    '"confidence": 0 to 1, how sure you are of "closest"}.'
  )
}

/** The one network call. Swappable for tests and the offline harness. */
export const petVisionDeps = {
  async look(photo: Buffer, pets: PetChoice[]): Promise<PetVision | null> {
    if (!process.env.OPENAI_API_KEY) throw new Error('no OPENAI_API_KEY')
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const model = VISION_MODEL()
    // 512 px is plenty to tell a cat from a dog, and low detail keeps the call to a few hundred tokens.
    const small = await sharp(photo).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: petPrompt(pets) },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}`, detail: 'low' } },
          ],
        },
      ],
      ...(isReasoningModel(model) ? { max_completion_tokens: 800 } : { max_tokens: 120, temperature: 0 }),
      response_format: { type: 'json_object' },
    })
    const vision = parseVision(response.choices[0]?.message?.content, pets, response.model || model)
    if (vision && response.usage) vision.usage = { input: response.usage.prompt_tokens, output: response.usage.completion_tokens }
    return vision
  },
}

/** Never throws: a vision failure becomes the flagged default, not a lost order. */
export async function detectPet(photo: Buffer, pets: PetChoice[]): Promise<PetDecision> {
  try {
    const vision = await petVisionDeps.look(photo, pets)
    return decidePet(pets, vision, vision ? undefined : 'the model gave no readable answer')
  } catch (err: any) {
    return decidePet(pets, null, err?.message ?? 'vision call failed')
  }
}
