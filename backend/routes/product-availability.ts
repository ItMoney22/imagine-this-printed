// Per-size/per-color product availability for the storefront.
//
// Public read endpoint. The storefront product page can call this to show
// granular "Only 2 left in XL / Black" stock hints that the product-level
// `is_active` flag cannot express. Read-only — it only ever SELECTs from
// products and blank_inventory.
//
// SCOPE: apparel products whose fulfillment is blank-driven (products with a
// blank_style mapping OR whose sizes/colors resolve to blank_inventory rows).
// Metal art / 3D prints / DTF transfers fall back to the product-level
// `is_active` + `stock_quantity` signal, which is the honest "we don't track
// granular stock for this kind" answer rather than a fabricated zero.

import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'
import { computeVariantAvailability, type AvailabilityBlank } from '../lib/variant-availability.js'

const router = Router()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHIRT_CATEGORIES = new Set(['shirts', 'hoodies'])

router.get('/:productId', async (req: Request, res: Response): Promise<any> => {
  try {
    const { productId } = req.params
    if (!UUID_RE.test(productId)) {
      return res.status(400).json({ error: 'Invalid product id' })
    }

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, category, metadata, sizes, colors, is_active, stock_quantity')
      .eq('id', productId)
      .maybeSingle()

    if (productError) throw productError
    if (!product) return res.status(404).json({ error: 'Product not found' })

    const category = String(product.category ?? '').toLowerCase()
    const sizes: string[] = (product.sizes || product.metadata?.sizes) ?? []
    const colors: string[] = (product.colors || product.metadata?.colors) ?? []

    // Non-blank-tracked products: report product-level availability only.
    if (!SHIRT_CATEGORIES.has(category)) {
      return res.json({
        mode: 'product-level',
        available: product.is_active !== false,
        stockQuantity: product.stock_quantity ?? null
      })
    }

    // Shirts: resolve per-variant availability from blank_inventory. When no
    // blank rows exist at all (blank_inventory is empty/sparse for this
    // product), fall back cleanly — the storefront keeps using is_active and
    // simply shows no granular hints.
    const { data: blanks, error: blanksError } = await supabase
      .from('blank_inventory')
      .select('color, size, style_code, qty_on_hand')

    if (blanksError) throw blanksError

    const availability = computeVariantAvailability(
      (blanks || []) as AvailabilityBlank[],
      sizes,
      colors,
      product.metadata?.blank_style
    )

    return res.json({
      mode: availability.blankBacked ? 'blank-inventory' : 'product-level',
      available: product.is_active !== false,
      stockQuantity: product.stock_quantity ?? null,
      byVariant: availability.byVariant,
      sizes,
      colors
    })
  } catch (error: any) {
    console.error('[product-availability] failed:', error)
    res.status(500).json({ error: 'Failed to load availability' })
  }
})

export default router
