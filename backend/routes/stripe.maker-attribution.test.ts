// The checkout end of maker attribution: does a cart of Amelia Chan's candle
// holders actually put `agent_id: "amelia-chan"` into the Stripe payload?
//
// `makerStampForItems` is the seam between the products table and the metadata
// object handed to stripe.paymentIntents.create, and it is the piece that has
// to be untrustworthy-input-proof:
//   - the maker comes from the PRODUCT ROW, never the cart's copy of it
//   - a lookup failure must not fail checkout
//   - a cart that changes makers must produce a different stamp
//
// The Stripe call itself is not mocked here — these tests pin the METADATA
// OBJECT, which is the thing that was wrong. See backend/shared/
// maker-attribution.test.ts for the multi-maker policy's own tests.
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.SUPABASE_JWT_SECRET ||= 'test-only-secret-do-not-use-in-prod-0123456789'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_maker_attribution'

// The real Gothic Ghost Face Candle Holder id, so this test reads as the
// incident it came from.
const CANDLE_HOLDER = '43d607e5-e8e1-4b57-a52f-110a5cd6a1c3'
const HOUSE_TEE = '11111111-1111-4111-8111-111111111111'
const SIFU_HOODIE = '22222222-2222-4222-8222-222222222222'

/** What the products table returns for this test. Swapped per case. */
let productRows: any[] = []
/** Set to a PostgREST-shaped error to simulate the column not existing yet. */
let productError: any = null

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'products') {
        return {
          select: () => ({
            in: async () => ({ data: productError ? null : productRows, error: productError }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  },
}))

const { makerStampForItems } = await import('./stripe.js')

const req: any = { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

const cartLine = (id: string, quantity = 1, extra: Record<string, any> = {}) => ({
  quantity,
  product: { id, name: 'whatever the client called it', ...extra },
})

beforeEach(() => {
  productRows = []
  productError = null
  req.log.info.mockClear()
  req.log.warn.mockClear()
})

describe('makerStampForItems', () => {
  it('stamps amelia-chan for a cart of her candle holders — the 2026-09-21 case', async () => {
    productRows = [{ id: CANDLE_HOLDER, price: 20, maker_agent_id: 'amelia-chan' }]

    const stamp = await makerStampForItems([cartLine(CANDLE_HOLDER, 2)], req)

    expect(stamp).toEqual({
      agent_id: 'amelia-chan',
      maker_agents: 'amelia-chan',
      maker_split: 'amelia-chan:10000',
    })
  })

  it('produces a Stripe-legal metadata object', async () => {
    productRows = [
      { id: CANDLE_HOLDER, price: 20, maker_agent_id: 'amelia-chan' },
      { id: HOUSE_TEE, price: 25, maker_agent_id: null },
    ]

    const stamp = await makerStampForItems(
      [cartLine(CANDLE_HOLDER, 3), cartLine(HOUSE_TEE)],
      req,
    )

    for (const [key, value] of Object.entries(stamp)) {
      expect(typeof value).toBe('string')
      expect(key.length).toBeLessThanOrEqual(40)
      expect(key).not.toMatch(/[[\]]/)
      expect((value as string).length).toBeLessThanOrEqual(500)
    }
    // $60 of Amelia vs $25 of house — she takes it.
    expect(stamp.agent_id).toBe('amelia-chan')
  })

  it('reads the maker off the PRODUCT ROW, ignoring whatever the cart claims', async () => {
    // The cart says sifu made it. The table says Amelia. The table wins —
    // otherwise anyone could hand a stranger 3x Watts by editing their cart.
    productRows = [{ id: CANDLE_HOLDER, price: 20, maker_agent_id: 'amelia-chan' }]

    const stamp = await makerStampForItems(
      [cartLine(CANDLE_HOLDER, 1, { maker_agent_id: 'sifu', metadata: { maker_agent_id: 'sifu' } })],
      req,
    )

    expect(stamp.agent_id).toBe('amelia-chan')
  })

  it('prices the weight from the CATALOG, not from anything the cart sent', async () => {
    // Client claims the house tee is a $900 item to drag the cart its way.
    productRows = [
      { id: CANDLE_HOLDER, price: 20, maker_agent_id: 'amelia-chan' },
      { id: HOUSE_TEE, price: 25, maker_agent_id: null },
    ]

    const stamp = await makerStampForItems(
      [cartLine(CANDLE_HOLDER, 2), cartLine(HOUSE_TEE, 1, { price: 900 })],
      req,
    )

    // $40 Amelia vs $25 house on catalog prices.
    expect(stamp.agent_id).toBe('amelia-chan')
    expect(stamp.maker_split).toBe('amelia-chan:6154,house:3846')
  })

  it('stamps nothing for a house-only cart, so the account default still applies', async () => {
    productRows = [{ id: HOUSE_TEE, price: 25, maker_agent_id: null }]

    expect(await makerStampForItems([cartLine(HOUSE_TEE, 4)], req)).toEqual({})
  })

  it('rejects a maker id that is not on the Watchtower roster', async () => {
    // A typo'd id is worse than none: creditDecision returns `unknown_agent`
    // and credits NOBODY, where an absent key at least pays the default agent.
    productRows = [{ id: CANDLE_HOLDER, price: 20, maker_agent_id: 'amelia-chen' }]

    expect(await makerStampForItems([cartLine(CANDLE_HOLDER)], req)).toEqual({})
  })

  it('fails open when the products lookup errors — checkout must not break', async () => {
    // 42703 is what PostgREST returns when the maker_agent_id column has not
    // been applied to this database yet. The API and the frontend deploy
    // independently, so this really happens.
    productError = { code: '42703', message: 'column products.maker_agent_id does not exist' }

    expect(await makerStampForItems([cartLine(CANDLE_HOLDER)], req)).toEqual({})
    expect(req.log.warn).toHaveBeenCalled()
  })

  it('handles an empty cart and non-UUID ids without a lookup', async () => {
    expect(await makerStampForItems([], req)).toEqual({})
    expect(await makerStampForItems(null, req)).toEqual({})
    // Imagination Station / custom lines carry non-UUID ids and no product row.
    expect(await makerStampForItems([cartLine('custom-tee-front')], req)).toEqual({})
  })

  it('changes its answer when the cart changes, which is why the update path re-stamps', async () => {
    productRows = [
      { id: CANDLE_HOLDER, price: 20, maker_agent_id: 'amelia-chan' },
      { id: SIFU_HOODIE, price: 55, maker_agent_id: 'sifu' },
    ]

    const before = await makerStampForItems([cartLine(CANDLE_HOLDER, 2)], req)
    const after = await makerStampForItems(
      [cartLine(CANDLE_HOLDER, 2), cartLine(SIFU_HOODIE, 1)],
      req,
    )

    expect(before.agent_id).toBe('amelia-chan')
    // $55 of Sifu beats $40 of Amelia — the draft intent's stamp has to move.
    expect(after.agent_id).toBe('sifu')
    expect(after.maker_agents).toBe('sifu,amelia-chan')
  })

  it('ignores a line with no quantity rather than weighting it', async () => {
    productRows = [
      { id: CANDLE_HOLDER, price: 20, maker_agent_id: 'amelia-chan' },
      { id: SIFU_HOODIE, price: 55, maker_agent_id: 'sifu' },
    ]

    const stamp = await makerStampForItems(
      [cartLine(CANDLE_HOLDER, 1), cartLine(SIFU_HOODIE, 0)],
      req,
    )

    expect(stamp.agent_id).toBe('amelia-chan')
    expect(stamp.maker_agents).toBe('amelia-chan')
  })
})
