import { describe, it, expect, beforeEach, vi } from 'vitest'
import sharp from 'sharp'

// ---------------------------------------------------------------------------
// Tests for the Step Flow Inspiration step
// (backend/services/step-flow/inspiration.ts — David 2026-09-02: "upload a
// photo of a design mrs imagine will anaylze it and ask what we like ...
// she basically breaks down the whole design").
//
// The properties that matter most:
//   1. decode/validate rejects a non-image and enforces the 8MB size limit
//      BEFORE ever decoding the base64 payload,
//   2. a loosely-typed model reply coerces into a well-formed breakdown,
//      falling back per-field,
//   3. anything the model flags (logo/brand/character/celebrity/copied
//      text) never survives into `suggestedIdea` — the Etsy copyright
//      gate's denylist is the enforced safety net, not just a prompt ask,
//   4. a vision-call failure (both providers) resolves to the deterministic,
//      stats-based fallback breakdown — this step must never come up empty.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.OPENAI_API_KEY ||= 'test-openai-key'

const create = vi.fn()
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } }
  },
}))

const uploadFile = vi.fn()
vi.mock('../gcs-storage.js', () => ({ uploadFile: (...args: any[]) => uploadFile(...args) }))

const {
  decodeInspirationImage,
  measureInspirationStats,
  coerceModelBreakdown,
  buildInspirationQuestions,
  analyzeInspirationImage,
  InspirationValidationError,
  INSPIRATION_INTRO,
} = await import('./inspiration.js')

const reply = (content: string) => create.mockResolvedValueOnce({ choices: [{ message: { content } }] })
const breakdownReply = (obj: any) => reply(JSON.stringify(obj))

async function solidPngBuffer(r: number, g: number, b: number, size = 16): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer()
}

async function solidPngDataUrl(r: number, g: number, b: number, size = 16): Promise<string> {
  const buf = await solidPngBuffer(r, g, b, size)
  return `data:image/png;base64,${buf.toString('base64')}`
}

beforeEach(() => {
  create.mockReset()
  uploadFile.mockReset()
  uploadFile.mockResolvedValue({ gcsPath: 'users/system/inspiration/test.png', publicUrl: 'https://gcs.example/inspiration/test.png', filename: 'test.png' })
  ;(globalThis as any).fetch = undefined
})

describe('INSPIRATION_INTRO', () => {
  it('is Mrs. Imagine\'s fixed voice line, never model-written', () => {
    expect(INSPIRATION_INTRO).toBe("Here's what's working in this one — tell me what to keep and what to make ours.")
  })
})

describe('decodeInspirationImage', () => {
  it('rejects a missing/blank image', async () => {
    await expect(decodeInspirationImage(undefined)).rejects.toThrow(InspirationValidationError)
    await expect(decodeInspirationImage('   ')).rejects.toThrow(/image is required/i)
  })

  it('rejects a data URL with an unsupported mime type', async () => {
    const badUrl = `data:text/plain;base64,${Buffer.from('hello world').toString('base64')}`
    await expect(decodeInspirationImage(badUrl)).rejects.toThrow(/base64 PNG, JPG, or WEBP/i)
  })

  it('enforces the 8MB size limit BEFORE decoding — a huge base64 payload is rejected without ever reaching sharp', async () => {
    // ~9MB of decoded bytes estimated straight from the base64 string length.
    const hugeBase64 = 'A'.repeat(12_000_000)
    const hugeUrl = `data:image/png;base64,${hugeBase64}`
    await expect(decodeInspirationImage(hugeUrl)).rejects.toThrow(/too large/i)
  })

  it('rejects a small, well-sized data URL whose bytes are not actually a decodable image', async () => {
    const notAnImage = `data:image/png;base64,${Buffer.from('this is not a real png').toString('base64')}`
    await expect(decodeInspirationImage(notAnImage)).rejects.toThrow(/could not be decoded/i)
  })

  it('accepts a real PNG data URL and returns the decoded buffer + contentType', async () => {
    const url = await solidPngDataUrl(200, 50, 50)
    const result = await decodeInspirationImage(url)
    expect(result.contentType).toBe('image/png')
    expect(result.buffer.length).toBeGreaterThan(0)
  })

  it('rejects a scheme that is neither a data URL nor https', async () => {
    await expect(decodeInspirationImage('ftp://example.com/x.png')).rejects.toThrow(/data URL or an https URL/i)
    await expect(decodeInspirationImage('http://example.com/x.png')).rejects.toThrow(/data URL or an https URL/i)
  })

  it('fetches and decodes an https URL reference image', async () => {
    const buf = await solidPngBuffer(10, 200, 30)
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/png' : k.toLowerCase() === 'content-length' ? String(buf.length) : null) },
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    })
    const result = await decodeInspirationImage('https://example.com/reference.png')
    expect(result.contentType).toBe('image/png')
    expect(result.buffer.length).toBeGreaterThan(0)
  })

  it('rejects an https fetch that fails', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })
    await expect(decodeInspirationImage('https://example.com/missing.png')).rejects.toThrow(/Failed to fetch/i)
  })
})

describe('measureInspirationStats', () => {
  it('reads a bright, low-saturation gray image as light and muted', async () => {
    const buf = await solidPngBuffer(230, 230, 230, 32)
    const stats = await measureInspirationStats(buf)
    expect(stats.meanLuma).toBeGreaterThan(0.7)
    expect(stats.saturation).toBeLessThan(0.1)
    expect(stats.dominantColors.length).toBeGreaterThan(0)
  })

  it('reads a square image as aspect "square" and a wide image as "landscape"', async () => {
    const square = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()
    const wide = await sharp({ create: { width: 120, height: 40, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()
    expect((await measureInspirationStats(square)).aspect).toBe('square')
    expect((await measureInspirationStats(wide)).aspect).toBe('landscape')
  })
})

describe('coerceModelBreakdown', () => {
  const stats = { aspect: 'square' as const, meanLuma: 0.5, saturation: 0.4, dominantColors: ['#112233'] }

  it('passes through a well-formed reply', () => {
    const { breakdown, suggestedIdea } = coerceModelBreakdown(
      {
        subject: 'A roaring lion',
        style: 'flat vector illustration',
        palette: ['gold', 'black'],
        text: null,
        composition: 'centered, close crop',
        mood: 'fierce',
        techniques: ['bold outlines'],
        whatWorks: ['strong silhouette'],
        flags: [],
        suggestedIdea: 'An original fierce lion illustration in gold and black.',
      },
      stats
    )
    expect(breakdown.subject).toBe('A roaring lion')
    expect(breakdown.palette).toEqual(['gold', 'black'])
    expect(breakdown.flags).toEqual([])
    expect(suggestedIdea).toBe('An original fierce lion illustration in gold and black.')
  })

  it('falls back per-field when the reply is missing fields', () => {
    const { breakdown } = coerceModelBreakdown({ subject: 'Only a subject' }, stats)
    expect(breakdown.subject).toBe('Only a subject')
    expect(breakdown.palette).toEqual(stats.dominantColors)
    expect(breakdown.flags).toEqual([])
  })

  it('returns the full stats-based fallback when the reply is not an object', () => {
    const { breakdown: a } = coerceModelBreakdown(null, stats)
    const { breakdown: b } = coerceModelBreakdown('nonsense', stats)
    expect(a.palette).toEqual(stats.dominantColors)
    expect(b.palette).toEqual(stats.dominantColors)
  })

  it('flags a detected logo and still produces a non-empty, clean suggestedIdea', () => {
    const { breakdown, suggestedIdea } = coerceModelBreakdown(
      {
        subject: 'A running shoe',
        style: 'photorealistic',
        palette: ['white', 'red'],
        text: null,
        composition: 'side profile',
        mood: 'athletic',
        techniques: [],
        whatWorks: ['dynamic angle'],
        flags: ['Nike swoosh logo on the shoe'],
        suggestedIdea: 'A shoe with a bold Nike swoosh and lightning accents.',
      },
      stats
    )
    expect(breakdown.flags.length).toBeGreaterThan(0)
    expect(breakdown.flags[0]).toMatch(/nike/i) // the flag itself honestly names what was detected
    expect(suggestedIdea.length).toBeGreaterThan(0)
    // The copyright-gate safety net strips the denylisted term regardless of what the model wrote.
    expect(suggestedIdea).not.toMatch(/nike/i)
  })

  it('caps array fields and drops non-string entries', () => {
    const { breakdown } = coerceModelBreakdown(
      { whatWorks: [...Array(10)].map((_, i) => `point ${i}`).concat([42 as any]), flags: [] },
      stats
    )
    expect(breakdown.whatWorks).toHaveLength(5)
    expect(breakdown.whatWorks.every((t) => typeof t === 'string')).toBe(true)
  })
})

describe('buildInspirationQuestions', () => {
  it('always returns exactly the 5 fixed dimensions', () => {
    const breakdown = coerceModelBreakdown({ subject: 'x' }, { aspect: 'square', meanLuma: 0.5, saturation: 0.3, dominantColors: ['#000000'] }).breakdown
    const questions = buildInspirationQuestions(breakdown)
    expect(questions.map((q) => q.key)).toEqual(['subject', 'words', 'style', 'palette', 'composition'])
    for (const q of questions) {
      expect(q.prompt.length).toBeGreaterThan(0)
      expect(q.options.length).toBeGreaterThan(0)
    }
  })
})

describe('analyzeInspirationImage', () => {
  it('uploads the ORIGINAL to GCS under folder "inspiration" and returns the model breakdown', async () => {
    breakdownReply({
      subject: 'A neon tiger',
      style: 'neon vector art',
      palette: ['magenta', 'cyan'],
      text: null,
      composition: 'centered',
      mood: 'electric',
      techniques: ['neon glow'],
      whatWorks: ['bold color contrast'],
      flags: [],
      suggestedIdea: 'An original neon tiger in magenta and cyan.',
    })

    const url = await solidPngDataUrl(20, 200, 200)
    const result = await analyzeInspirationImage(url, { actorId: 'admin-1' })

    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(uploadFile.mock.calls[0][1]).toMatchObject({ userId: 'admin-1', folder: 'inspiration' })
    expect(result.persona).toBe('mrs-imagine')
    expect(result.intro).toBe(INSPIRATION_INTRO)
    expect(result.inspiration.imageUrl).toBe('https://gcs.example/inspiration/test.png')
    expect(result.inspiration.breakdown.subject).toBe('A neon tiger')
    expect(result.inspiration.suggestedIdea).toBe('An original neon tiger in magenta and cyan.')
    expect(result.inspiration.questions).toHaveLength(5)
  })

  it('falls back to the deterministic, stats-based breakdown when the vision call fails', async () => {
    create.mockRejectedValueOnce(new Error('network down'))

    const url = await solidPngDataUrl(10, 10, 10, 32) // dark image
    const result = await analyzeInspirationImage(url)

    expect(result.inspiration.breakdown.subject).toMatch(/didn't run|didn't identify|fallback/i)
    expect(result.inspiration.breakdown.flags.length).toBeGreaterThan(0)
    expect(result.inspiration.breakdown.flags[0]).toMatch(/have a human confirm/i)
    expect(result.inspiration.suggestedIdea.length).toBeGreaterThan(0)
    expect(result.inspiration.questions).toHaveLength(5)
  })

  it('rejects before ever calling the model or GCS when the image fails validation', async () => {
    await expect(analyzeInspirationImage('not a url at all')).rejects.toThrow(InspirationValidationError)
    expect(uploadFile).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
