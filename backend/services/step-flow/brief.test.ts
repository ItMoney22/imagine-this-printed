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

const { writeStepBrief, fallbackBrief, coerceBrief, sanitizePhraseText } = await import('./brief.js')

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

// ---------------------------------------------------------------------------
// Phrase step (design doc §11, David 2026-09-02): "add a phrase to this
// design then a agent thinks of catchy phrase ... add Mrs Imagine to this
// step." The property under test: the exact-text render instruction MUST
// reach designPrompt verbatim whether the writing brain succeeds or fails —
// a picked phrase can never silently go missing.
// ---------------------------------------------------------------------------

describe('sanitizePhraseText', () => {
  it('trims and collapses internal whitespace', () => {
    expect(sanitizePhraseText('  Wild   And   Free  ')).toBe('Wild And Free')
  })

  it('caps at 60 characters by default', () => {
    const long = 'x'.repeat(100)
    expect(sanitizePhraseText(long)).toHaveLength(60)
  })

  it('strips ASCII control characters', () => {
    expect(sanitizePhraseText('Wild\u0000And\u0007Free')).toBe('WildAndFree')
  })

  it('returns an empty string for non-string input', () => {
    expect(sanitizePhraseText(undefined)).toBe('')
    expect(sanitizePhraseText(42 as any)).toBe('')
  })
})

describe('writeStepBrief with a phrase', () => {
  it('embeds the exact quoted phrase text in designPrompt when the model succeeds', async () => {
    reply(
      JSON.stringify({
        designPrompt: 'A fierce street monkey, solid white background.',
        background: 'white',
        title: 'Street Monkey',
        styleTags: ['streetwear'],
        garmentHint: 'tshirt',
        rationale: 'Bold ink pops on white.',
      })
    )
    const b = await writeStepBrief('street monkey', { phrase: { text: 'Stay Wild', placement: 'above' } })

    expect(b.designPrompt).toContain(
      'Render the exact text "Stay Wild" in bold, clean, highly legible lettering, spelled exactly as written, placed above the subject, part of the artwork on the same solid background.'
    )
    expect(b.phrase).toEqual({ text: 'Stay Wild', placement: 'above' })
  })

  it('embeds the exact quoted phrase text in designPrompt even on the fallback path (model call throws)', async () => {
    create.mockRejectedValueOnce(new Error('network down'))

    const b = await writeStepBrief('street monkey', { phrase: { text: 'Stay Wild', placement: 'above' } })

    expect(b.designPrompt).toContain(
      'Render the exact text "Stay Wild" in bold, clean, highly legible lettering, spelled exactly as written, placed above the subject, part of the artwork on the same solid background.'
    )
    expect(b.background).toBe('white')
    expect(b.phrase).toEqual({ text: 'Stay Wild', placement: 'above' })
  })

  it('embeds the exact quoted phrase text even when the model reply is not valid JSON', async () => {
    reply('Sorry, I cannot help with that.')

    const b = await writeStepBrief('idea', { phrase: { text: 'Catch Phrase', placement: 'below' } })

    expect(b.designPrompt).toContain('Render the exact text "Catch Phrase"')
  })

  it('defaults placement to "below" when not given', async () => {
    create.mockRejectedValueOnce(new Error('network down'))
    const b = await writeStepBrief('idea', { phrase: { text: 'No Placement Given' } })
    expect(b.phrase?.placement).toBe('below')
    expect(b.designPrompt).toContain('placed below the subject')
  })

  it('sanitizes the incoming phrase text (trims, collapses whitespace, caps at 60 chars)', async () => {
    create.mockRejectedValueOnce(new Error('network down'))
    const b = await writeStepBrief('idea', { phrase: { text: '  Too   Much   Space  ', placement: 'below' } })
    expect(b.phrase?.text).toBe('Too Much Space')
  })

  it('treats an empty/whitespace-only phrase as no phrase at all', async () => {
    const b = await writeStepBrief('idea', { phrase: { text: '   ' } })
    expect(b.phrase).toBeUndefined()
    expect(b.designPrompt).not.toContain('Render the exact text')
  })

  it('never adds phrase language when no phrase is given', async () => {
    create.mockRejectedValueOnce(new Error('network down'))
    const b = await writeStepBrief('idea')
    expect(b.phrase).toBeUndefined()
    expect(b.designPrompt).not.toContain('Render the exact text')
  })
})

// ---------------------------------------------------------------------------
// Inspiration step (design doc §12, David 2026-09-02): "upload a photo of a
// design mrs imagine will anaylze it and ask what we like ... she basically
// breaks down the whole design." The property under test: the final
// designPrompt MUST read as an original design "inspired by" the reference
// — never a reproduction — and MUST NOT carry through any term Mrs.
// Imagine's breakdown flagged (a logo/brand/character/celebrity), on BOTH
// the model-written path and the deterministic fallback path.
// ---------------------------------------------------------------------------

const inspirationInput = (overrides?: Partial<{ flags: string[]; keep: string[]; change: Record<string, string> }>) => ({
  imageUrl: 'https://gcs.example/inspiration/ref.png',
  breakdown: {
    subject: 'A running shoe',
    style: 'photorealistic',
    palette: ['white', 'red'],
    text: null,
    composition: 'side profile',
    mood: 'athletic',
    techniques: [],
    whatWorks: ['dynamic angle'],
    flags: overrides?.flags ?? ['Nike swoosh logo on the shoe'],
  },
  choices: {
    keep: overrides?.keep ?? ['the athletic pose'],
    change: overrides?.change ?? { subject: 'a wolf instead of a shoe' },
  },
})

describe('writeStepBrief with inspiration', () => {
  it('stamps StepBrief.inspiration and includes the "original artwork inspired by" clause when the model succeeds', async () => {
    reply(
      JSON.stringify({
        designPrompt: 'A fierce wolf mid-stride, solid white background.',
        background: 'white',
        title: 'Fierce Wolf',
        styleTags: ['athletic'],
        garmentHint: 'tshirt',
        rationale: 'Bold ink pops on white.',
      })
    )

    const b = await writeStepBrief('a wolf running', { inspiration: inspirationInput() })

    expect(b.designPrompt.toLowerCase()).toContain('original artwork inspired by')
    expect(b.designPrompt).not.toMatch(/nike/i)
    expect(b.inspiration).toEqual({
      imageUrl: 'https://gcs.example/inspiration/ref.png',
      keep: ['the athletic pose'],
      change: { subject: 'a wolf instead of a shoe' },
    })
  })

  it('strips a flagged brand name even if the model ignores the instruction and writes it into designPrompt/title', async () => {
    reply(
      JSON.stringify({
        designPrompt: 'A shoe with a bold Nike swoosh, solid white background.',
        background: 'white',
        title: 'Nike Style Shoe',
        styleTags: ['athletic'],
        garmentHint: 'tshirt',
        rationale: 'Pops on white.',
      })
    )

    const b = await writeStepBrief('a shoe design', { inspiration: inspirationInput() })

    expect(b.designPrompt).not.toMatch(/nike/i)
    expect(b.title).not.toMatch(/nike/i)
    expect(b.designPrompt.toLowerCase()).toContain('original artwork inspired by')
  })

  it('includes the "original artwork inspired by" clause and drops flagged terms on the fallback path (model call throws)', async () => {
    create.mockRejectedValueOnce(new Error('network down'))

    const b = await writeStepBrief('a wolf running', { inspiration: inspirationInput() })

    expect(b.designPrompt.toLowerCase()).toContain('original artwork inspired by')
    expect(b.designPrompt).not.toMatch(/nike/i)
    expect(b.background).toBe('white')
    expect(b.inspiration?.imageUrl).toBe('https://gcs.example/inspiration/ref.png')
  })

  it('never adds the inspiration clause or field when no inspiration is given', async () => {
    create.mockRejectedValueOnce(new Error('network down'))
    const b = await writeStepBrief('idea')
    expect(b.inspiration).toBeUndefined()
    expect(b.designPrompt.toLowerCase()).not.toContain('original artwork inspired by')
  })

  it('treats an inspiration input with no imageUrl as no inspiration at all', async () => {
    create.mockRejectedValueOnce(new Error('network down'))
    const b = await writeStepBrief('idea', { inspiration: { breakdown: {}, choices: {} } })
    expect(b.inspiration).toBeUndefined()
  })

  it('is idempotent — never doubles the clause when it is already present', async () => {
    reply(
      JSON.stringify({
        designPrompt:
          'A wolf. This is an original artwork inspired by a reference image — keeping the pose in spirit — and is NOT a reproduction.',
        background: 'white',
        title: 'Wolf',
        styleTags: [],
        garmentHint: 'tshirt',
        rationale: 'x',
      })
    )
    const b = await writeStepBrief('a wolf', { inspiration: inspirationInput({ flags: [] }) })
    const occurrences = (b.designPrompt.match(/original artwork inspired by/gi) || []).length
    expect(occurrences).toBe(1)
  })

  it('works together with a phrase — both the phrase text and the inspiration clause land in designPrompt', async () => {
    create.mockRejectedValueOnce(new Error('network down'))
    const b = await writeStepBrief('a wolf running', {
      phrase: { text: 'Run Wild', placement: 'below' },
      inspiration: inspirationInput(),
    })
    expect(b.designPrompt).toContain('Render the exact text "Run Wild"')
    expect(b.designPrompt.toLowerCase()).toContain('original artwork inspired by')
    expect(b.designPrompt).not.toMatch(/nike/i)
  })
})
