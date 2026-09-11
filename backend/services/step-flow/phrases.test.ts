import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for the Step Flow phrase step (Mrs. Imagine's pitch,
// backend/services/step-flow/phrases.ts — design doc §11).
//
// Three properties matter most:
//   1. parsing a clean model reply into well-formed, print-friendly phrases,
//   2. every candidate is filtered through the Etsy copyright gate's
//      trademark/brand denylist, and a low survivor count (<3) triggers
//      exactly one retry,
//   3. a call that never produces anything usable (network failure both
//      times, or everything trips the denylist) resolves to the
//      deterministic fallback — this route must never come up empty.
// ---------------------------------------------------------------------------

const create = vi.fn()
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } }
  },
}))

process.env.OPENAI_API_KEY ||= 'test-openai-key'

const { pitchPhrases, pitchPhrasesForDesign, fallbackPhrases, MRS_IMAGINE_INTRO, MRS_IMAGINE_DESIGN_INTRO } =
  await import('./phrases.js')

const reply = (content: string) => create.mockResolvedValueOnce({ choices: [{ message: { content } }] })
const phrasesReply = (phrases: any[]) => reply(JSON.stringify({ phrases }))

beforeEach(() => {
  create.mockReset()
})

describe('MRS_IMAGINE_INTRO', () => {
  it('is exactly David\'s line', () => {
    expect(MRS_IMAGINE_INTRO).toBe('Based on this prompt, you can add these phrases that will make this shirt POP.')
  })
})

describe('fallbackPhrases', () => {
  it('returns 6 print-friendly phrases derived from the idea', () => {
    const phrases = fallbackPhrases('hip-hop street monkey')
    expect(phrases).toHaveLength(6)
    for (const p of phrases) {
      expect(p.text.length).toBeGreaterThan(0)
      expect(p.text).not.toMatch(/[#"']/)
      expect(['funny', 'hype', 'wholesome', 'minimal', 'pun']).toContain(p.vibe)
      expect(['below', 'above', 'integrated']).toContain(p.placement)
      expect(p.reason.length).toBeGreaterThan(0)
      expect([
        'graffiti', 'varsity', 'brush-script', 'chrome-3d', 'retro-70s', 'distressed',
        'heavy-sans', 'blackletter', 'bubble-comic', 'neon-tube', 'western',
      ]).toContain(p.suggestedStyle)
    }
    // At least one line should riff on the idea itself.
    expect(phrases.some((p) => /hip-hop|street|monkey/i.test(p.text))).toBe(true)
  })

  it('derives suggestedStyle from each template phrase\'s own vibe', () => {
    const phrases = fallbackPhrases('idea')
    for (const p of phrases) {
      const expected =
        p.vibe === 'funny' ? 'bubble-comic' :
        p.vibe === 'hype' ? 'heavy-sans' :
        p.vibe === 'wholesome' ? 'brush-script' :
        p.vibe === 'minimal' ? 'heavy-sans' :
        'retro-70s'
      expect(p.suggestedStyle).toBe(expected)
    }
  })

  it('never returns an empty list even for a blank idea', () => {
    const phrases = fallbackPhrases('   ')
    expect(phrases.length).toBeGreaterThan(0)
  })

  it('honours a smaller requested count', () => {
    expect(fallbackPhrases('idea', 3)).toHaveLength(3)
  })
})

describe('pitchPhrases', () => {
  it('rejects a blank idea before ever calling the model', async () => {
    await expect(pitchPhrases('   ')).rejects.toThrow(/idea is required/i)
    expect(create).not.toHaveBeenCalled()
  })

  it('parses a clean reply into a well-formed PhrasesResult', async () => {
    phrasesReply([
      { text: 'Wild And Free', vibe: 'hype', placement: 'below', reason: 'Matches the untamed energy.', suggestedStyle: 'chrome-3d' },
      { text: 'Just Vibing', vibe: 'funny', placement: 'below', reason: 'Light and easy.', suggestedStyle: 'bubble-comic' },
      { text: 'Handmade With Heart', vibe: 'wholesome', placement: 'above', reason: 'Warm framing.', suggestedStyle: 'brush-script' },
    ])

    const result = await pitchPhrases('a lone wolf howling')

    expect(result.persona).toBe('mrs-imagine')
    expect(result.intro).toBe(MRS_IMAGINE_INTRO)
    expect(result.phrases).toHaveLength(3)
    expect(result.phrases[0]).toEqual({
      text: 'Wild And Free',
      vibe: 'hype',
      placement: 'below',
      reason: 'Matches the untamed energy.',
      suggestedStyle: 'chrome-3d',
    })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('coerces a missing/invalid suggestedStyle to the vibe fallback instead of dropping the candidate', async () => {
    phrasesReply([
      { text: 'One Line', vibe: 'funny', placement: 'below', reason: 'ok' }, // no suggestedStyle at all
      { text: 'Two Line', vibe: 'hype', placement: 'below', reason: 'ok', suggestedStyle: 'not-a-real-style' },
      { text: 'Three Line', vibe: 'wholesome', placement: 'above', reason: 'ok', suggestedStyle: 'brush-script' },
    ])

    const result = await pitchPhrases('idea')

    expect(result.phrases[0].suggestedStyle).toBe('bubble-comic') // funny fallback
    expect(result.phrases[1].suggestedStyle).toBe('heavy-sans') // hype fallback
    expect(result.phrases[2].suggestedStyle).toBe('brush-script') // model's valid pick passes through
  })

  it('strips quotes, hashtags, and caps length on each candidate', async () => {
    phrasesReply([
      { text: '"Hashtag #blessed" ', vibe: 'funny', placement: 'below', reason: 'silly' },
      { text: 'Second one', vibe: 'hype', placement: 'below', reason: 'ok' },
      { text: 'Third one', vibe: 'minimal', placement: 'above', reason: 'ok' },
    ])

    const result = await pitchPhrases('idea')

    expect(result.phrases[0].text).not.toMatch(/["#]/)
    expect(result.phrases[0].text).toBe('Hashtag blessed')
  })

  it('coerces an unknown vibe/placement to the safe defaults instead of dropping the candidate', async () => {
    phrasesReply([
      { text: 'One Line', vibe: 'sarcastic', placement: 'sideways', reason: 'weird input' },
      { text: 'Two Line', vibe: 'hype', placement: 'below', reason: 'ok' },
      { text: 'Three Line', vibe: 'minimal', placement: 'above', reason: 'ok' },
    ])

    const result = await pitchPhrases('idea')

    expect(result.phrases[0].vibe).toBe('hype')
    expect(result.phrases[0].placement).toBe('below')
  })

  it('drops any candidate that trips the copyright gate denylist', async () => {
    phrasesReply([
      { text: 'Nike Energy Only', vibe: 'hype', placement: 'below', reason: 'brand hit' },
      { text: 'Wild And Free', vibe: 'hype', placement: 'below', reason: 'clean' },
      { text: 'Just Vibing', vibe: 'funny', placement: 'below', reason: 'clean' },
      { text: 'Handmade With Heart', vibe: 'wholesome', placement: 'above', reason: 'clean' },
    ])

    const result = await pitchPhrases('idea')

    expect(result.phrases.map((p) => p.text)).not.toContain('Nike Energy Only')
    expect(result.phrases).toHaveLength(3)
    // 3 clean survivors on the first pass — no retry needed.
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('asks once more when fewer than 3 candidates survive the gate, then merges', async () => {
    // First pass: only 1 clean survivor (2 trip the denylist).
    phrasesReply([
      { text: 'Nike Energy Only', vibe: 'hype', placement: 'below', reason: 'brand hit' },
      { text: 'Disney Dreams', vibe: 'wholesome', placement: 'below', reason: 'brand hit' },
      { text: 'Only Clean One', vibe: 'minimal', placement: 'below', reason: 'clean' },
    ])
    // Retry: two more clean phrases.
    phrasesReply([
      { text: 'Second Clean Line', vibe: 'hype', placement: 'below', reason: 'clean' },
      { text: 'Third Clean Line', vibe: 'funny', placement: 'above', reason: 'clean' },
    ])

    const result = await pitchPhrases('idea')

    expect(create).toHaveBeenCalledTimes(2)
    const texts = result.phrases.map((p) => p.text)
    expect(texts).toContain('Only Clean One')
    expect(texts).toContain('Second Clean Line')
    expect(texts).toContain('Third Clean Line')
    expect(texts).not.toContain('Nike Energy Only')
    expect(texts).not.toContain('Disney Dreams')
  })

  it('falls back to the deterministic set when the model call fails both times', async () => {
    create.mockRejectedValueOnce(new Error('network down'))
    create.mockRejectedValueOnce(new Error('network down again'))

    const result = await pitchPhrases('a lone wolf howling')

    expect(create).toHaveBeenCalledTimes(2)
    expect(result.persona).toBe('mrs-imagine')
    expect(result.phrases).toEqual(fallbackPhrases('a lone wolf howling', 6))
  })

  it('falls back when every candidate from both calls trips the denylist', async () => {
    phrasesReply([{ text: 'Nike Air Energy', vibe: 'hype', placement: 'below', reason: 'brand' }])
    phrasesReply([{ text: 'Adidas Forever', vibe: 'hype', placement: 'below', reason: 'brand' }])

    const result = await pitchPhrases('idea')

    expect(create).toHaveBeenCalledTimes(2)
    expect(result.phrases.length).toBeGreaterThan(0)
    expect(result.phrases).toEqual(fallbackPhrases('idea', 6))
  })

  it('clamps count to the 1-10 range', async () => {
    phrasesReply(
      Array.from({ length: 10 }, (_, i) => ({ text: `Line ${i}`, vibe: 'hype', placement: 'below', reason: 'ok' }))
    )
    const result = await pitchPhrases('idea', undefined, 30)
    expect(result.phrases.length).toBeLessThanOrEqual(10)

    create.mockReset()
    phrasesReply([{ text: 'Line A', vibe: 'hype', placement: 'below', reason: 'ok' }])
    const resultLow = await pitchPhrases('idea', undefined, -5)
    expect(resultLow.phrases.length).toBeLessThanOrEqual(1)
  })

  it('passes the brief\'s designPrompt through to the brain when provided', async () => {
    phrasesReply([
      { text: 'One', vibe: 'hype', placement: 'below', reason: 'ok' },
      { text: 'Two', vibe: 'hype', placement: 'below', reason: 'ok' },
      { text: 'Three', vibe: 'hype', placement: 'below', reason: 'ok' },
    ])

    await pitchPhrases('idea', {
      designPrompt: 'A neon tiger, solid white background.',
      background: 'white',
      title: 'Neon Tiger',
      styleTags: [],
      garmentHint: 'tshirt',
      rationale: 'x',
    } as any)

    const userMessage = create.mock.calls[0][0].messages.find((m: any) => m.role === 'user')
    expect(userMessage.content).toContain('A neon tiger, solid white background.')
  })
})

// ---------------------------------------------------------------------------
// The vision-grounded pitch (David 2026-09-09): "she is going off the prompt
// and it really doesnt match the design of the image so it sucks".
//
// The property that makes this different from the pitch above is not the
// output shape — it is that the ARTWORK is in the request at all. The first
// test pins exactly that, because a refactor that quietly dropped the image
// would still return six perfectly well-formed phrases and look fine.
// ---------------------------------------------------------------------------

const DESIGN_URL = 'https://storage.googleapis.com/itp/graphics/samurai/original/take-1.png'

// A real 1x1 PNG, so `sharp` does genuine work rather than being mocked out —
// the inlining step is only worth testing if it actually decodes an image.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => ONE_PIXEL_PNG.buffer.slice(ONE_PIXEL_PNG.byteOffset, ONE_PIXEL_PNG.byteOffset + ONE_PIXEL_PNG.byteLength),
}))
vi.stubGlobal('fetch', fetchMock)
beforeEach(() => fetchMock.mockClear())

const visionReply = (body: Record<string, unknown>) => reply(JSON.stringify(body))

const goodPhrases = [
  { text: 'Bloom Or Bust', vibe: 'hype', placement: 'below', reason: 'The blossom branch over his shoulder.', suggestedStyle: 'heavy-sans' },
  { text: 'Quiet Storm', vibe: 'minimal', placement: 'above', reason: 'He is mid-draw but perfectly still.', suggestedStyle: 'blackletter' },
  { text: 'Petals And Steel', vibe: 'wholesome', placement: 'below', reason: 'Pink petals against the blade.', suggestedStyle: 'brush-script' },
]

describe('pitchPhrasesForDesign', () => {
  it('rejects a blank image url before ever calling the model', async () => {
    await expect(pitchPhrasesForDesign('   ')).rejects.toThrow(/designImageUrl is required/i)
    expect(create).not.toHaveBeenCalled()
  })

  it('actually sends the design to the model — the whole point of this path', async () => {
    visionReply({ saw: 'A stoic samurai under a cherry blossom branch.', existingText: null, phrases: goodPhrases })

    await pitchPhrasesForDesign(DESIGN_URL, { idea: 'stoic samurai' })

    const sent = create.mock.calls[0][0]
    const userContent = sent.messages[1].content
    expect(Array.isArray(userContent)).toBe(true)
    const image = userContent.find((part: any) => part.type === 'image_url')
    expect(image?.image_url?.url).toMatch(/^data:image\/png;base64,/)
  })

  // PROVEN NECESSARY on real products 2026-09-09: a design adopted from the
  // library is served by api.imaginethisprinted.com/api/media/..., which
  // answers 302 to a signed GCS link. The model's own fetcher does not follow
  // it, so passing the URL through came back blind for every library design.
  // Inlining the bytes is what fixed it.
  it('inlines the design rather than making the model fetch a redirecting url', async () => {
    visionReply({ saw: 'A witch on a broom.', existingText: null, phrases: goodPhrases })

    await pitchPhrasesForDesign('https://api.imaginethisprinted.com/api/media/design-library/halloween/021.png')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const image = create.mock.calls[0][0].messages[1].content.find((part: any) => part.type === 'image_url')
    expect(image.image_url.url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('still tries the raw url when the design cannot be fetched', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as any)
    visionReply({ saw: 'Something.', existingText: null, phrases: goodPhrases })

    await pitchPhrasesForDesign(DESIGN_URL)

    // A direct-URL attempt that might work beats refusing to pitch at all.
    const image = create.mock.calls[0][0].messages[1].content.find((part: any) => part.type === 'image_url')
    expect(image.image_url.url).toBe(DESIGN_URL)
  })

  it('reports what she saw and any words already drawn into the art', async () => {
    visionReply({
      saw: 'A stoic samurai under a cherry blossom branch.',
      existingText: 'RONIN',
      phrases: goodPhrases,
    })

    const result = await pitchPhrasesForDesign(DESIGN_URL)

    expect(result.saw).toBe('A stoic samurai under a cherry blossom branch.')
    expect(result.existingText).toBe('RONIN')
    expect(result.intro).toBe(MRS_IMAGINE_DESIGN_INTRO)
    expect(result.phrases.map((p) => p.text)).toEqual(['Bloom Or Bust', 'Quiet Storm', 'Petals And Steel'])
  })

  it('reads a design with no words on it as existingText null, not an empty string', async () => {
    visionReply({ saw: 'A lone wolf on a ridge.', existingText: '', phrases: goodPhrases })

    const result = await pitchPhrasesForDesign(DESIGN_URL)

    expect(result.existingText).toBeNull()
  })

  it('runs pitched lines through the same copyright gate as the blind pitch', async () => {
    visionReply({
      saw: 'A cartoon mouse in red shorts.',
      existingText: null,
      phrases: [
        { text: 'Disney Magic Forever', vibe: 'hype', placement: 'below', reason: 'nope', suggestedStyle: 'heavy-sans' },
        ...goodPhrases,
      ],
    })
    // Under three survivors would trigger the retry; four go in, one is gated,
    // three survive, so this single reply is the whole call.
    const result = await pitchPhrasesForDesign(DESIGN_URL)

    expect(result.phrases.map((p) => p.text)).not.toContain('Disney Magic Forever')
    expect(result.phrases).toHaveLength(3)
  })

  it('falls back to the blind set with saw:null when the vision call is dead', async () => {
    create.mockRejectedValue(new Error('vision down'))

    const result = await pitchPhrasesForDesign(DESIGN_URL, { idea: 'hip-hop street monkey' })

    // saw:null is the contract the UI reads to warn David that these lines
    // came off his idea, not off the picture — the exact failure he reported.
    expect(result.saw).toBeNull()
    expect(result.existingText).toBeNull()
    expect(result.phrases.length).toBeGreaterThan(0)
    expect(result.phrases.some((p) => /hip-hop|street|monkey/i.test(p.text))).toBe(true)
  })

  it('keeps the first call\'s description when a retry only tops up the phrases', async () => {
    visionReply({ saw: 'A lone wolf on a ridge.', existingText: null, phrases: [goodPhrases[0]] })
    visionReply({ saw: null, existingText: null, phrases: goodPhrases })

    const result = await pitchPhrasesForDesign(DESIGN_URL)

    expect(create).toHaveBeenCalledTimes(2)
    expect(result.saw).toBe('A lone wolf on a ridge.')
  })
})
