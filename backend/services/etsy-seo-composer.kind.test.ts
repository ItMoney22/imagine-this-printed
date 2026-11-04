// Task 28ab467c: the composer writes copy for what the product IS. Before it,
// there were two prompts — metal, and "soft unisex tees" for everything else —
// so the 2026-10-12 dry run found every hoodie, DTF transfer and 3D figurine
// composed as a tee.
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.OPENAI_API_KEY ||= 'test-openai-key'
delete process.env.OPENROUTER_API_KEY

const db: { product: any; updates: any[] } = { product: null, updates: [] }
vi.mock('../lib/supabase.js', () => {
  const chain = (): any => {
    const c: any = {}
    c.select = () => c
    c.eq = () => c
    c.update = (patch: any) => {
      db.updates.push(patch)
      return { eq: async () => ({ error: null }) }
    }
    c.maybeSingle = async () => ({ data: db.product, error: null })
    return c
  }
  return { supabase: { from: () => chain() } }
})

const create = vi.fn()
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: (...args: any[]) => create(...args) } }
  },
}))

const { composeEtsyPack, composerPromptFor, etsyAnchorPriceFor, isHoodieProduct, ETSY_HOODIE_ANCHOR_PRICE, ETSY_ANCHOR_PRICE } =
  await import('./etsy-seo-composer.js')

// The prompt every tee listing was composed with before this task, verbatim.
const PRE_TASK_TEE_PROMPT =
  'You write Etsy listing copy for ImagineThisPrinted, a custom print shop selling soft unisex tees ' +
  'with DTF-printed designs, made to order in Rockmart, Georgia. Respond ONLY with JSON: ' +
  '{"title": string, "tags": string[], "description": string}. Rules: ' +
  'TITLE: clear and human-readable — Etsy\'s current quality guidance explicitly penalizes keyword-stuffed, ' +
  'comma-stacked titles (their own listing feedback rewrites them). Format: the design name, one or two ' +
  'natural style descriptors, the product type, then optionally ONE "|" separator and a short audience/fit ' +
  'phrase. Example shape: "Simply Be You Retro Varsity T-Shirt | Unisex Graphic Tee". Aim for 50-90 ' +
  'characters. No comma-separated keyword lists, no repeated synonyms, no emoji, no ALL-CAPS words, no ' +
  'quotes. Every search phrase you would have stacked in the title belongs in the tags instead. ' +
  'TAGS (exactly 13): 2-3 word lowercase buyer phrases, each <=20 characters, no duplicates or ' +
  'near-duplicates, no bare generic words like "shirt". Spread across: style/aesthetic, audience, ' +
  'occasion/season, gift phrasing, and the design subject. ' +
  'DESCRIPTION: first line is a hook <=155 chars saying what it is and who it is for (that is the ' +
  'mobile preview). Then short scannable sections: the design; the shirt (soft unisex tee, vibrant ' +
  'DTF print); a sizing nudge (size up for an oversized fit); made to order + printed in Rockmart, ' +
  'Georgia; care (machine wash cold, inside out). Friendly and concrete. Never invent facts, ' +
  'materials, or shipping promises.'

describe('composerPromptFor', () => {
  it('keeps the tee prompt byte-for-byte', () => {
    expect(composerPromptFor('tee')).toBe(PRE_TASK_TEE_PROMPT)
  })

  it('tells the model what a hoodie, a transfer and a figure actually are', () => {
    expect(composerPromptFor('hoodie')).toMatch(/selling soft unisex hoodies/)
    expect(composerPromptFor('hoodie')).not.toMatch(/unisex tees/)
    expect(composerPromptFor('transfer')).toMatch(/garment is NOT included/)
    expect(composerPromptFor('3d')).toMatch(/3D printed collectible/)
    expect(composerPromptFor('3d')).not.toMatch(/machine wash|sizing nudge/)
    expect(composerPromptFor('other')).toMatch(/never call it a shirt unless they do/)
  })
})

describe('anchor price follows the kind', () => {
  it('takes an explicit kind over the floor', () => {
    expect(etsyAnchorPriceFor({ category: 'shirts', name: 'Plain' }, 'hoodie')).toBe(ETSY_HOODIE_ANCHOR_PRICE)
    expect(etsyAnchorPriceFor({ category: 'shirts', name: 'Cozy Hoodie' }, 'tee')).toBe(ETSY_ANCHOR_PRICE)
    expect(etsyAnchorPriceFor({ category: null, name: 'Panel' }, 'metal')).toBe(ETSY_ANCHOR_PRICE)
  })

  it('reads a live kind stamp, and the admin\'s pick over it', () => {
    const stamp = { kind: 'hoodie', source: 'jev', needs_review: false, category: 'shirts' }
    expect(isHoodieProduct({ category: 'shirts', name: 'Art', metadata: { product_kind: stamp } })).toBe(true)
    expect(isHoodieProduct({ category: 'shirts', name: 'Art', metadata: { category_source: 'admin', product_kind: stamp } })).toBe(false)
  })
})

describe('composeEtsyPack', () => {
  const reply = { choices: [{ message: { content: JSON.stringify({ title: 'Robo Rascal Figure | 3D Printed Collectible', tags: ['robot figure', 'desk decor figure'], description: 'A robot.\n\nMade to order.' }) } }] }

  beforeEach(() => {
    db.updates = []
    create.mockReset()
    create.mockResolvedValue(reply)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('composes a 3D figure with the figure prompt, no shirt colours, and stamps the kind', async () => {
    db.product = { id: 'p1', name: 'Toy: Robo Rascal', category: '3d-prints', price: 30, metadata: {} }
    const pack = await composeEtsyPack('p1')
    const system = create.mock.calls[0][0].messages[0].content
    expect(system).toMatch(/3D printed collectible figures/)
    expect(JSON.parse(create.mock.calls[0][0].messages[1].content).product_kind).toBe('3d')
    expect(pack.colors).toEqual([])
    expect(pack.price).toBe(ETSY_ANCHOR_PRICE)
    expect(db.updates[0].metadata.product_kind).toMatchObject({ kind: '3d', needs_review: false, category: '3d-prints' })
  })

  it('composes a hoodie as a hoodie at the hoodie anchor', async () => {
    db.product = { id: 'p2', name: 'Unleashed Power Athlete Hoodie', category: 'hoodies', price: 35, metadata: {} }
    const pack = await composeEtsyPack('p2')
    expect(create.mock.calls[0][0].messages[0].content).toMatch(/soft unisex hoodies/)
    expect(pack.price).toBe(ETSY_HOODIE_ANCHOR_PRICE)
    expect(pack.colors.length).toBeGreaterThan(0)
  })

  it('refuses to compose a product nothing identifies instead of writing it up as a tee', async () => {
    db.product = { id: 'p3', name: 'Camper Apology', category: null, price: 20, metadata: {} }
    await expect(composeEtsyPack('p3')).rejects.toThrow(/Nothing on this product says what it is/)
    expect(create).not.toHaveBeenCalled()
    expect(db.updates).toEqual([])
  })
})
