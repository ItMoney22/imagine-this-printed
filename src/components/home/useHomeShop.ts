import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { applyStorefrontVisibility } from '../../lib/product-visibility'
import { STOREFRONT_PRODUCT_COLUMNS, mapProductRow } from '../../lib/storefront-row'
import { isBlankProduct, productKindOf, HOME_DECOR_CATEGORY } from '../../lib/product-kind'
import type { Product } from '../../types'

/**
 * The seasonal row on the home page. It only shows real listings whose names
 * match, and it switches itself off on `endsOn`, so it never goes stale.
 * No discount is claimed here: a real offer needs David's terms (task 7fa5c8c5).
 */
export const SEASONAL_PICKS = {
  label: 'October',
  title: 'Halloween picks',
  line: 'Spooky season favorites, printed in our Rockmart shop.',
  endsOn: '2026-11-01',
  match: /hallow|spook|ghost|witch|skull|pumpkin|haunt|skeleton/i,
  // The candle holder is the one listing that has sold more than once.
  leadId: '43d607e5-e8e1-4b57-a52f-110a5cd6a1c3',
}

export type DoorId = 'tees' | 'hoodies' | 'toys' | 'metal' | 'dtf' | 'blanks'

export interface HomeShop {
  loading: boolean
  popular: Product[]
  seasonal: Product[]
  toys: Product[]
  toyFrom: number | null
  counts: Record<DoorId, number>
}

const EMPTY_COUNTS: Record<DoorId, number> = { tees: 0, hoodies: 0, toys: 0, metal: 0, dtf: 0, blanks: 0 }

function doorOf(p: Product): DoorId | null {
  // Printed home decor (the candle holder) is not a toy and has no door.
  if (p.category === HOME_DECOR_CATEGORY) return null
  if (isBlankProduct(p)) return 'blanks'
  const kind = productKindOf(p)
  if (kind === 'metal') return 'metal'
  if (kind === '3d') return 'toys'
  if (String(p.category).includes('dtf')) return 'dtf'
  if (String(p.category).includes('hood')) return 'hoodies'
  return 'tees'
}

/** A Toy Factory figurine, not other 3D decor (the candle holder is 3D too). */
const isFigurine = (p: Product) => productKindOf(p) === '3d' && !!p.metadata?.print3d && p.category !== HOME_DECOR_CATEGORY

function summarize(products: Product[], now = new Date()): Omit<HomeShop, 'loading'> {
  const sellable = products.filter((p) => !isBlankProduct(p))

  const seasonOn = now < new Date(`${SEASONAL_PICKS.endsOn}T00:00:00`)
  const seasonal = seasonOn
    ? sellable
        .filter((p) => SEASONAL_PICKS.match.test(p.name))
        .sort((a, b) => Number(b.id === SEASONAL_PICKS.leadId) - Number(a.id === SEASONAL_PICKS.leadId))
        .slice(0, 4)
    : []

  // Popular never repeats a tile the seasonal row already shows.
  const inSeason = new Set(seasonal.map((p) => p.id))
  const rest = sellable.filter((p) => !inSeason.has(p.id))
  const featured = rest.filter((p) => p.is_featured)
  const popular = (featured.length >= 4 ? featured : [...featured, ...rest.filter((p) => !p.is_featured)]).slice(0, 4)

  const toys = products.filter(isFigurine)
  const toyFrom = toys.length ? Math.min(...toys.map((t) => t.price).filter((n) => n > 0)) : null

  const counts = { ...EMPTY_COUNTS }
  for (const p of products) {
    const door = doorOf(p)
    if (door) counts[door] += 1
  }
  return { popular, seasonal, toys, toyFrom: Number.isFinite(toyFrom) ? toyFrom : null, counts }
}

let cache: { data: Omit<HomeShop, 'loading'>; at: number } | null = null
const CACHE_MS = 60_000

/** One read of the live shop for every home section (shopper-visible rows only). */
export function useHomeShop(): HomeShop {
  const [data, setData] = useState(cache?.data ?? null)

  useEffect(() => {
    if (cache && Date.now() - cache.at < CACHE_MS) return
    let alive = true
    ;(async () => {
      const { data: rows, error } = await applyStorefrontVisibility(
        supabase.from('products').select(STOREFRONT_PRODUCT_COLUMNS)
      )
        .order('created_at', { ascending: false })
        .limit(400)
      if (error) console.error('[home] products', error)
      const next = summarize((rows || []).map(mapProductRow))
      cache = { data: next, at: Date.now() }
      if (alive) setData(next)
    })()
    return () => {
      alive = false
    }
  }, [])

  return data
    ? { loading: false, ...data }
    : { loading: true, popular: [], seasonal: [], toys: [], toyFrom: null, counts: EMPTY_COUNTS }
}
