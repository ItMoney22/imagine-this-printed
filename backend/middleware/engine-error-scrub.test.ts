import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/role-cache.js', () => ({ getCachedRole: async () => null }))

const { namesEngine } = await import('./engine-error-scrub.js')
const { MODELS } = await import('../services/image-flow/models.js')

describe('namesEngine', () => {
  it('catches every engine in the model registry, by id and by label', () => {
    const missed = MODELS.flatMap((m) => [m.id, m.label]).filter((name) => !namesEngine(name))
    expect(missed).toEqual([])
  })

  it.each([
    'gpt-image-2.6-flare edit: no image returned',
    'openai/gpt-image-2',
    'OpenAIError: 500 upstream',
    '429 Rate limit reached, see https://platform.openai.com/docs',
    'Request to https://api.replicate.com/v1/predictions failed with status 500',
    'ReplicateError: prediction failed',
    'https://pbxt.replicate.delivery/abc/out.png could not be fetched',
    'Replicate: insufficient credit',
    'OpenAI: no credits remaining',
    'FLUX.1 failed',
    'flux2 timed out',
    'flare_edit_high failed',
    'FlareLab is busy',
    'Nano Banana refused the image',
    'nano_banana_2 timeout',
    'real-esrgan out of memory',
    'REMOVEBG_API_KEY is not set',
    'fal-ai/birefnet failed',
    'tripo3d task failed',
    'TripoError: 500',
    'gemini-2.5-flash returned nothing',
    'OpenRouter 503',
    'typesafe/jev-1.13 refused',
  ])('flags %s', (text) => {
    expect(namesEngine(text)).toBe(true)
  })

  // The real lines these routes answer, plus plain words that sit next to an engine name.
  it.each([
    'Insufficient ITC',
    'Insufficient ITC balance',
    'Insufficient ITC balance. Need 5 ITC.',
    'Insufficient ITC for premium reimagine (need 50 ITC, have 10).',
    'Not enough ITC: need 8, have 2',
    'ITC balance changed concurrently — insufficient funds. Please retry.',
    'All image generations failed. You were not charged.',
    'Image processing completed but no output URL was produced. You were not charged.',
    'Image generation completed but no output URLs were produced. You were not charged.',
    'Could not fetch the design image (404)',
    'Unknown product type: tripod. Valid types: shirts, hoodies',
    'ITP Enhance Engine is busy',
    'Imagination could not finish that',
    'Failed to generate mockup',
    'Sheet not found',
    'An influx of orders is slowing things down',
    'The flared jeans mockup is not available',
    'This design replicates a trademark',
    'Wallet not found',
    'image/png only',
  ])('leaves %s alone', (text) => {
    expect(namesEngine(text)).toBe(false)
  })
})
