import { supabase } from '../lib/supabase'
import type { Product, User, CartItem } from '../types'

export interface RecommendationScore {
  productId: string
  score: number
  reasons: RecommendationReason[]
}

export interface RecommendationReason {
  type: 'collaborative' | 'content_based' | 'trending' | 'seasonal' | 'cross_sell' | 'behavioral'
  weight: number
  description: string
}

export interface UserBehavior {
  userId: string
  viewedProducts: string[]
  purchasedProducts: string[]
  cartProducts: string[]
  searchQueries: string[]
  categoryPreferences: Record<string, number>
  timeSpentPerCategory: Record<string, number>
  lastActivity: string
}

export interface RecommendationContext {
  user?: User
  currentProduct?: Product
  cartItems?: CartItem[]
  page: 'home' | 'product' | 'cart' | 'checkout' | 'category'
  limit?: number
  excludeIds?: string[]
}

export class ProductRecommender {
  // Write-only today: updateUserBehavior() below still records into this
  // (ProductPage.tsx / ProductRecommendations.tsx both call it), but nothing
  // reads it anymore now that getRecommendations is copurchase-driven
  // instead of the old in-memory collaborative-filtering pipeline. Left in
  // place because removing updateUserBehavior's storage would mean either
  // breaking its two external callers or silently no-op'ing a public method
  // — out of scope for this pass (see handoff REMAINING).
  private userBehaviors: Map<string, UserBehavior> = new Map()

  constructor() {
  }

  // Main recommendation method. Ranking source, in priority order:
  //   1. product_copurchase (real "bought together" data, refreshed nightly
  //      by backend/scripts/refresh-product-copurchase.ts from order_items)
  //      when there's an anchor product (current product page, or a cart
  //      item) to look up co-purchases FOR.
  //   2. Context-aware banding (category match + featured + jitter) as the
  //      fallback — used on pages with no anchor product (e.g. Home) or
  //      when the anchor has no co-purchase history yet (new/low-volume
  //      product). This is the same logic the live path already used before
  //      this pass; it isn't co-purchase data, but "trending because
  //      featured" is a reasonable Home-page default with no purchase to
  //      anchor off of.
  async getRecommendations(context: RecommendationContext): Promise<Product[]> {
    const { limit = 6, excludeIds = [] } = context

    try {
      const anchorProductIds = Array.from(
        new Set(
          [
            context.currentProduct?.id,
            ...(context.cartItems ?? []).map((ci: any) => ci?.product?.id),
          ].filter(Boolean) as string[]
        )
      )

      if (anchorProductIds.length > 0) {
        const copurchased = await this.getCopurchaseRecommendations(anchorProductIds, excludeIds, limit)
        if (copurchased.length > 0) return copurchased
      }

      return await this.getFallbackRecommendations(context, excludeIds, limit)
    } catch (error) {
      console.error('Error fetching recommendations:', error)
      return []
    }
  }

  // Real co-purchase lookup. Frequency join, in plain English: for every
  // anchor product (the one being viewed / already in the cart), look up
  // its rows in product_copurchase — each row is "N other orders that
  // included <product_id> also included <co_product_id>" — sum
  // purchase_count across anchors when a co-product pairs with more than
  // one anchor (e.g. two different cart items both co-bought the same
  // accessory), then take the highest-frequency co_product_ids. This is a
  // single indexed range scan per anchor (idx_product_copurchase_ranked),
  // no model inference, no client-side scoring loop.
  private async getCopurchaseRecommendations(
    anchorProductIds: string[],
    excludeIds: string[],
    limit: number
  ): Promise<Product[]> {
    const { data: pairs, error: pairError } = await supabase
      .from('product_copurchase')
      .select('co_product_id, purchase_count')
      .in('product_id', anchorProductIds)
      .order('purchase_count', { ascending: false })

    if (pairError || !pairs || pairs.length === 0) return []

    const frequency = new Map<string, number>()
    for (const row of pairs as any[]) {
      if (!row.co_product_id || excludeIds.includes(row.co_product_id) || anchorProductIds.includes(row.co_product_id)) continue
      frequency.set(row.co_product_id, (frequency.get(row.co_product_id) || 0) + (row.purchase_count || 0))
    }
    if (frequency.size === 0) return []

    const rankedIds = Array.from(frequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id)

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, description, price, images, category, is_active, is_featured')
      .in('id', rankedIds)
      .eq('is_active', true)

    if (productsError || !products) return []

    const byId = new Map(products.map((p: any) => [p.id, p]))
    // Preserve frequency-ranked order — `.in()` doesn't guarantee row order.
    return rankedIds
      .map(id => byId.get(id))
      .filter(Boolean)
      .map((p: any) => this.mapRow(p))
  }

  // Context-aware banding fallback (no anchor product, or the anchor has no
  // co-purchase history yet). Same logic this file already had — moved
  // into its own method rather than rewritten, see class docstring above.
  private async getFallbackRecommendations(
    context: RecommendationContext,
    excludeIds: string[],
    limit: number
  ): Promise<Product[]> {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, description, price, images, category, is_active, is_featured')
      .eq('is_active', true)
      .limit(limit * 3 + excludeIds.length + 5)

    if (error || !data) return []

    const products: Product[] = data
      .filter((p: any) => !excludeIds.includes(p.id))
      .map((p: any) => this.mapRow(p))

    const contextCategories = new Set<string>(
      [
        context.currentProduct?.category,
        ...(context.cartItems ?? []).map((ci: any) => ci?.product?.category),
      ].filter(Boolean) as string[]
    )
    const ranked = products
      .map((p) => ({
        p,
        score:
          (contextCategories.has(p.category) ? 2 : 0) +
          ((p as any).is_featured ? 1 : 0) +
          Math.random(),
      }))
      .sort((a, b) => b.score - a.score)
      .map((r) => r.p)

    return ranked.slice(0, limit)
  }

  private mapRow(p: any): Product {
    return {
      id: p.id,
      name: p.name,
      description: p.description || '',
      price: p.price || 0,
      images: p.images || [],
      category: p.category || 'shirts',
      inStock: true,
      is_featured: p.is_featured
    } as Product
  }

  // Analytics and tracking
  private trackRecommendationImpression(
    userId: string,
    recommendations: RecommendationScore[],
    page: string
  ): void {
    // Mock tracking - in real app, this would send to analytics service
    console.log('Recommendation impression:', {
      userId,
      page,
      recommendations: recommendations.map(r => ({
        productId: r.productId,
        score: r.score,
        reasons: r.reasons.map(reason => reason.type)
      }))
    })
  }

  public trackRecommendationClick(
    userId: string,
    productId: string,
    context: string,
    position: number
  ): void {
    // Track when user clicks on a recommendation
    console.log('Recommendation click:', {
      userId,
      productId,
      context,
      position,
      timestamp: new Date().toISOString()
    })
  }

  // Update user behavior
  public updateUserBehavior(
    userId: string,
    action: 'view' | 'purchase' | 'cart_add' | 'search',
    data: any
  ): void {
    let behavior = this.userBehaviors.get(userId)

    if (!behavior) {
      behavior = {
        userId,
        viewedProducts: [],
        purchasedProducts: [],
        cartProducts: [],
        searchQueries: [],
        categoryPreferences: {},
        timeSpentPerCategory: {},
        lastActivity: new Date().toISOString()
      }
      this.userBehaviors.set(userId, behavior)
    }

    behavior.lastActivity = new Date().toISOString()

    switch (action) {
      case 'view':
        behavior.viewedProducts.push(data.productId)
        behavior.categoryPreferences[data.category] =
          (behavior.categoryPreferences[data.category] || 0) + 1
        break
      case 'purchase':
        behavior.purchasedProducts.push(data.productId)
        behavior.categoryPreferences[data.category] =
          (behavior.categoryPreferences[data.category] || 0) + 3
        break
      case 'cart_add':
        behavior.cartProducts.push(data.productId)
        break
      case 'search':
        behavior.searchQueries.push(data.query)
        break
    }

    // Keep arrays to reasonable size
    if (behavior.viewedProducts.length > 100) {
      behavior.viewedProducts = behavior.viewedProducts.slice(-50)
    }
  }

}

export const productRecommender = new ProductRecommender()
