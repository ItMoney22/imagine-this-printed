import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for lettering a phrase INTO an existing design
// (backend/services/step-flow/letter-phrase.ts).
//
// David 2026-09-09: "she is going off the prompt and it really doesnt match
// the design of the image so it sucks can we fix that in the flow". The fix
// is this path, and it has three ways to be quietly wrong:
//
//   1. It re-renders instead of editing, and the take David picked is gone.
//      Pinned by asserting the SOURCE image goes to the model.
//   2. A trademark reaches the image model. The pitched lines are already
//      copyright-gated in phrases.ts, but this route also takes hand-typed
//      text — so the gate is re-run here, before the paid call.
//   3. The result overwrites the original take instead of joining it. Pinned
//      by asserting the insert is a NON-primary source take.
// ---------------------------------------------------------------------------

const db: { asset: any; inserts: any[] } = { asset: null, inserts: [] }
vi.mock('../../lib/supabase.js', () => {
  const chain = (): any => {
    const c: any = {}
    c.select = () => c
    c.eq = () => c
    c.single = async () => (db.asset ? { data: db.asset, error: null } : { data: null, error: { message: 'no rows' } })
    c.insert = (row: any) => {
      db.inserts.push(row)
      return { select: () => ({ single: async () => ({ data: { id: 'new-asset', ...row }, error: null }) }) }
    }
    return c
  }
  return { supabase: { from: () => chain() } }
})

const edits: any[] = []
let editBehaviour: 'ok' | 'throw' = 'ok'
vi.mock('../image-flow/providers/openai-image.js', () => ({
  editOpenAIImage: async (opts: any) => {
    edits.push(opts)
    if (editBehaviour === 'throw') throw new Error('image model unreachable')
    return { url: 'https://cdn/lettered.png', path: 'graphics/lettered.png', modelId: 'openai/gpt-image-2' }
  },
}))

// brief.ts builds its writing-brain client at import time and this module
// imports it for the phrase funnel it shares — same guard phrases.test.ts uses.
process.env.OPENAI_API_KEY ||= 'test-openai-key'

const {
  letterPhraseIntoDesign,
  buildLetteringPrompt,
  LetterPhraseValidationError,
  LetterPhraseNotFoundError,
} = await import('./letter-phrase.js')

const sourceTake = (over: Record<string, unknown> = {}) => ({
  id: 'take-2',
  product_id: 'p-1',
  kind: 'source',
  asset_role: 'design',
  url: 'https://cdn/take-2.png',
  width: 1024,
  height: 1024,
  metadata: {},
  ...over,
})

beforeEach(() => {
  db.asset = sourceTake()
  db.inserts = []
  edits.length = 0
  editBehaviour = 'ok'
})

describe('buildLetteringPrompt', () => {
  it('asks for the exact text and forbids changing anything else', () => {
    const prompt = buildLetteringPrompt({ text: 'Bloom Or Bust', placement: 'below', style: 'heavy-sans' })
    expect(prompt).toContain('"Bloom Or Bust"')
    expect(prompt).toContain('below the existing subject')
    // The clause that makes this an addition rather than a new picture.
    expect(prompt).toMatch(/Change NOTHING else/i)
    expect(prompt).toMatch(/must not cover, crop, or obscure/i)
  })

  it("describes 'auto' as a style that matches the artwork, not a named typeface", () => {
    expect(buildLetteringPrompt({ text: 'Quiet Storm', placement: 'above', style: 'auto' })).toContain(
      'in a lettering style that matches the artwork'
    )
  })
})

describe('letterPhraseIntoDesign', () => {
  it('edits the take that was picked instead of rendering a new picture', async () => {
    await letterPhraseIntoDesign('p-1', 'take-2', { text: 'Bloom Or Bust', placement: 'below', style: 'heavy-sans' })

    expect(edits).toHaveLength(1)
    // The source image IS the request. Without this the artwork David chose
    // would be replaced by a lookalike rather than lettered.
    expect(edits[0].sourceUrl).toBe('https://cdn/take-2.png')
    expect(edits[0].prompt).toContain('"Bloom Or Bust"')
  })

  it('saves the result as another take, never over the original', async () => {
    const { asset } = await letterPhraseIntoDesign('p-1', 'take-2', { text: 'Quiet Storm' })

    expect(db.inserts).toHaveLength(1)
    const row = db.inserts[0]
    expect(row.kind).toBe('source')
    expect(row.asset_role).toBe('design')
    // Non-primary: picking it is still David's separate, explicit act.
    expect(row.is_primary).toBe(false)
    expect(row.url).toBe('https://cdn/lettered.png')
    expect(row.metadata.lettered).toBe(true)
    expect(row.metadata.lettered_from_asset_id).toBe('take-2')
    expect(row.metadata.model_name).toContain('Quiet Storm')
    expect(asset.id).toBe('new-asset')
  })

  it('refuses a trademarked line BEFORE spending an image call', async () => {
    await expect(
      letterPhraseIntoDesign('p-1', 'take-2', { text: 'Disney Magic Forever' })
    ).rejects.toBeInstanceOf(LetterPhraseValidationError)

    expect(edits).toHaveLength(0)
    expect(db.inserts).toHaveLength(0)
  })

  it('refuses an empty phrase', async () => {
    await expect(letterPhraseIntoDesign('p-1', 'take-2', { text: '   ' })).rejects.toBeInstanceOf(
      LetterPhraseValidationError
    )
    expect(edits).toHaveLength(0)
  })

  it('refuses to letter a mockup — words belong on the print file, not on a photo of a shirt', async () => {
    db.asset = sourceTake({ kind: 'mockup' })

    await expect(letterPhraseIntoDesign('p-1', 'take-2', { text: 'Quiet Storm' })).rejects.toBeInstanceOf(
      LetterPhraseValidationError
    )
    expect(edits).toHaveLength(0)
  })

  it('404s an asset that is not on this product', async () => {
    db.asset = null

    await expect(letterPhraseIntoDesign('p-1', 'nope', { text: 'Quiet Storm' })).rejects.toBeInstanceOf(
      LetterPhraseNotFoundError
    )
  })

  it('keeps a portrait take portrait', async () => {
    db.asset = sourceTake({ width: 1024, height: 1536 })

    await letterPhraseIntoDesign('p-1', 'take-2', { text: 'Quiet Storm' })

    // A metal print is 3:4. Snapping it to a square would crop the artwork the
    // edit was supposed to leave alone.
    expect(edits[0].size).toBe('1024x1536')
    expect(db.inserts[0].width).toBe(1024)
    expect(db.inserts[0].height).toBe(1536)
  })

  it('writes nothing when the image call fails', async () => {
    editBehaviour = 'throw'

    await expect(letterPhraseIntoDesign('p-1', 'take-2', { text: 'Quiet Storm' })).rejects.toThrow(/unreachable/i)
    expect(db.inserts).toHaveLength(0)
  })
})
