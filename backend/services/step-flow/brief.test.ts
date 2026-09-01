import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for the Step Flow writing brain (backend/services/step-flow/brief.ts).
//
// The property that matters most: this call must NEVER throw and must NEVER
// leave the flow stuck. A network failure, a bad key, or a model that ignores
// the JSON instruction all have to resolve to a usable StepBrief — a solid
// white background, a tee, and a print-ready prompt — so Step 1 always
// advances into Step 2.
// ---------------------------------------------------------------------------

const create = vi.fn()
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } }
  },
}))

process.env.OPENAI_API_KEY ||= 'test-openai-key'

const { writeStepBrief, fallbackBrief, coerceBrief } = await import('./brief.js')

const reply = (content: string) => create.mockResolvedValueOnce({ choices: [{ message: { content } }] })

beforeEach(() => {
  create.mockReset()
})

describe('fallbackBrief', () => {
  it('is always a solid white background with no garment/mockup language', () => {
    const b = fallbackBrief('a hip-hop street monkey')
    expect(b.background).toBe('white')
    expect(b.garmentHint).toBe('tshirt')
    expect(b.designPrompt).toMatch(/solid/i)
    // The prompt explicitly FORBIDS these — it should name them as a
    // negative constraint, not merely avoid the words entirely.
    expect(b.designPrompt).toMatch(/no checkerboard/i)
    expect(b.designPrompt).toMatch(/no gradient/i)
    expect(b.designPrompt).toMatch(/no.*drop shadow/i)
    expect(b.designPrompt).toMatch(/no garment|no mockup/i)
  })

  it('never returns an empty title even for a blank idea', () => {
    const b = fallbackBrief('   ')
    expect(b.title.length).toBeGreaterThan(0)
  })
})

describe('coerceBrief', () => {
  it('passes through a well-formed reply', () => {
    const b = coerceBrief('street monkey', {
      designPrompt: 'A fierce street monkey, solid black background.',
      background: 'black',
      title: 'Street Monkey',
      styleTags: ['streetwear', 'bold'],
      garmentHint: 'hoodie',
      rationale: 'Bright ink pops on black.',
    })
    expect(b).toEqual({
      designPrompt: 'A fierce street monkey, solid black background.',
      background: 'black',
      title: 'Street Monkey',
      styleTags: ['streetwear', 'bold'],
      garmentHint: 'hoodie',
      rationale: 'Bright ink pops on black.',
    })
  })

  it('coerces an unknown garmentHint (e.g. "polo") to tshirt', () => {
    const b = coerceBrief('idea', { garmentHint: 'polo' })
    expect(b.garmentHint).toBe('tshirt')
  })

  it('coerces an invalid background to the fallback default', () => {
    const b = coerceBrief('idea', { background: 'transparent' })
    expect(b.background).toBe('white')
  })

  it('falls back per-field when the reply is missing fields', () => {
    const b = coerceBrief('idea', { title: 'Only a title' })
    expect(b.title).toBe('Only a title')
    expect(b.designPrompt).toContain('idea')
    expect(b.background).toBe('white')
    expect(b.garmentHint).toBe('tshirt')
  })

  it('returns the full fallback when the reply is not an object', () => {
    expect(coerceBrief('idea', null)).toEqual(fallbackBrief('idea'))
    expect(coerceBrief('idea', 'nonsense')).toEqual(fallbackBrief('idea'))
  })

  it('caps styleTags at 8 and drops non-string entries', () => {
    const b = coerceBrief('idea', { styleTags: [...Array(12)].map((_, i) => `tag${i}`).concat([42 as any]) })
    expect(b.styleTags).toHaveLength(8)
    expect(b.styleTags.every((t) => typeof t === 'string')).toBe(true)
  })
})

describe('writeStepBrief', () => {
  it('parses a clean JSON reply from the model', async () => {
    reply(
      JSON.stringify({
        designPrompt: 'A neon tiger, solid white background.',
        background: 'white',
        title: 'Neon Tiger',
        styleTags: ['neon', 'bold'],
        garmentHint: 'tshirt',
        rationale: 'Dark neon pops on white.',
      })
    )
    const b = await writeStepBrief('neon tiger')
    expect(b.title).toBe('Neon Tiger')
    expect(b.background).toBe('white')
  })

  it('unwraps a ```json fenced reply', async () => {
    reply('```json\n' + JSON.stringify({ title: 'Fenced', background: 'black' }) + '\n```')
    const b = await writeStepBrief('idea')
    expect(b.title).toBe('Fenced')
    expect(b.background).toBe('black')
  })

  it('falls back when the model call throws (network/auth failure)', async () => {
    create.mockRejectedValueOnce(new Error('network down'))
    const b = await writeStepBrief('a lone wolf howling')
    expect(b).toEqual(fallbackBrief('a lone wolf howling'))
  })

  it('falls back when the model reply is not valid JSON at all', async () => {
    reply('Sorry, I cannot help with that.')
    const b = await writeStepBrief('idea')
    // parseJsonLoose returns null -> coerceBrief(idea, null) -> full fallback
    expect(b).toEqual(fallbackBrief('idea'))
  })

  it('rejects a blank idea before ever calling the model', async () => {
    await expect(writeStepBrief('   ')).rejects.toThrow(/idea is required/i)
    expect(create).not.toHaveBeenCalled()
  })
})
