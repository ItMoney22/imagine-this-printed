// Recommendation rows stay in the anchor's lane (David 2026-10-07): the live
// "Similar Products" row put "Man I Love Frogs" and "Leftovers Are for
// Quitters" beside Darrell McCutchen's "Walk By Faith".
import { describe, it, expect, vi, beforeEach } from 'vitest'

const DARRELL = '41c6873c-68a5-4365-8f6f-3ce3f1c6ae9e'

// Rows as the slim REC_SELECT returns them (JSON-path aliases, no metadata blob).
const ROWS: Record<string, any> = {
  frogs: { id: 'frogs', name: 'Man I Love Frogs', price: 25, images: [], category: 'shirts' },
  left: { id: 'left', name: 'Leftovers Are for Quitters', price: 24.99, images: [], category: 'shirts' },
  lion: { id: 'lion', name: 'Roar to the Skies Lion Tee', price: 25, images: [], category: 'shirts' },
  bless: { id: 'bless', name: 'Blessed Mama Tee', price: 25, images: [], category: 'shirts' },
  faith2: { id: 'faith2', name: 'Faith Over Fear', price: 26, images: [], category: 'shirts', created_by_user_id: DARRELL, rec_source: 'merch-studio', rec_creator_id: DARRELL },
  walk: { id: 'walk', name: 'Walk By Faith', price: 24.99, images: [], category: 'shirts', created_by_user_id: DARRELL, rec_source: 'merch-studio', rec_creator_id: DARRELL, rec_tags: ['christian apparel'] }
}

const calls: { table: string; ops: [string, unknown[]][] }[] = []
let copurchase: any[] = []

function builder(table: string) {
  const entry = { table, ops: [] as [string, unknown[]][] }
  calls.push(entry)
  const chain: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') {
        const rows = table === 'product_copurchase' ? copurchase : resolveProducts(entry.ops)
        return (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
      }
      return (...args: unknown[]) => { entry.ops.push([prop, args]); return chain }
    }
  })
  return chain
}

function resolveProducts(ops: [string, unknown[]][]): any[] {
  let rows = Object.values(ROWS)
  for (const [op, args] of ops) {
    if (op === 'in' && args[0] === 'id') rows = rows.filter(r => (args[1] as string[]).includes(r.id))
    if (op === 'eq' && args[0] === 'created_by_user_id') rows = rows.filter(r => r.created_by_user_id === args[1])
  }
  return rows
}

vi.mock('../lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))

import { productRecommender, recCandidateOf, anchorCandidateOf } from './product-recommender'
import type { Product } from '../types'

const walkByFaith = {
  id: 'walk',
  name: 'Walk By Faith',
  category: 'shirts',
  searchKeywords: 'walk by faith shirt, custom faith t-shirt',
  metadata: { source: 'merch-studio', creator_id: DARRELL, creator_name: 'Darrell McCutchen' }
} as unknown as Product

const ids = (list: Product[]) => list.map(p => p.id).sort()

beforeEach(() => {
  calls.length = 0
  copurchase = []
})

describe('lane adapters', () => {
  it('reads the slim row and the page product in one shape', () => {
    expect(recCandidateOf(ROWS.walk).metadata).toEqual({ source: 'merch-studio', creator_id: DARRELL, etsy_pack: { tags: ['christian apparel'] } })
    expect(anchorCandidateOf(walkByFaith).search_keywords).toBe('walk by faith shirt, custom faith t-shirt')
  })
})

describe('getRecommendations lanes', () => {
  it("Darrell's product page shows only Darrell's other work", async () => {
    const out = await productRecommender.getRecommendations({ page: 'product', currentProduct: walkByFaith, excludeIds: ['walk'], limit: 6 })
    expect(ids(out)).toEqual(['faith2'])
    // Straight to his catalog: no co-purchase or generic window behind it.
    expect(calls.map(c => c.table)).toEqual(['products'])
    expect(calls[0].ops).toContainEqual(['eq', ['created_by_user_id', DARRELL]])
  })

  it('a generic row never carries a creator or a faith product, even from co-purchases', async () => {
    copurchase = [
      { co_product_id: 'walk', purchase_count: 9 },
      { co_product_id: 'bless', purchase_count: 5 },
      { co_product_id: 'frogs', purchase_count: 3 }
    ]
    const lion = { id: 'lion', name: 'Roar to the Skies Lion Tee', category: 'shirts', metadata: {} } as unknown as Product
    const out = await productRecommender.getRecommendations({ page: 'product', currentProduct: lion, excludeIds: ['lion'], limit: 6 })
    expect(ids(out)).toEqual(['frogs'])
  })

  it('the home row (no anchor) drops creator and faith products from the fallback', async () => {
    const out = await productRecommender.getRecommendations({ page: 'home', limit: 6 })
    expect(ids(out)).toEqual(['frogs', 'left', 'lion'])
  })

  it('a faith product (not a creator one) sits only beside other faith products', async () => {
    const blessed = { id: 'bless', name: 'Blessed Mama Tee', category: 'shirts', metadata: {} } as unknown as Product
    const out = await productRecommender.getRecommendations({ page: 'product', currentProduct: blessed, excludeIds: ['bless'], limit: 6 })
    expect(ids(out)).toEqual([])
  })
})
