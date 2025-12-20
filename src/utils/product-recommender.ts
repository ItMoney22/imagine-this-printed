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
  private userBehaviors: Map<string, UserBehavior> = new Map()
  private productSimilarity: Map<string, Map<string, number>> = new Map()
  private trendingProducts: string[] = []

  constructor() {
  }

  // Main recommendation method - optimized with fast query
  async getRecommendations(context: RecommendationContext): Promise<Product[]> {
    const { limit = 6, excludeIds = [] } = context

    try {
      // Optimized query - only fetch needed columns, smaller limit
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, images, category, is_active, is_featured')
        .eq('is_active', true)
        .limit(limit + excludeIds.length + 5) // Just enough buffer for filtering

      if (error) throw error

      if (!data) return []

      // Map to Product type and filter excluded - fast in-memory ops
      const products: Product[] = data
        .filter((p: any) => !excludeIds.includes(p.id))
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          description: p.description || '',
          price: p.price || 0,
          images: p.images || [],
          category: p.category || 'shirts',
          inStock: true,
          is_featured: p.is_featured
        }))

      // Fast shuffle using Fisher-Yates
      for (let i = products.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [products[i], products[j]] = [products[j], products[i]]
      }

      return products.slice(0, limit)

    } catch (error) {
      console.error('Error fetching recommendations:', error)
      return []
    }
  }

  // Calculate recommendation scores using multiple algorithms
  private async calculateRecommendationScores(
    context: RecommendationContext
  ): Promise<RecommendationScore[]> {
    const { user, currentProduct: _currentProduct, cartItems: _cartItems, page } = context
    const allProducts = await this.getAllProducts()
    const scores: Map<string, RecommendationScore> = new Map()

    // Initialize scores for all products
    allProducts.forEach(product => {
      scores.set(product.id, {
        productId: product.id,
        score: 0,
        reasons: []
      })
    })

    // Apply different recommendation algorithms
    if (user) {
      await this.applyCollaborativeFiltering(scores, user, allProducts)
      await this.applyContentBasedFiltering(scores, user, allProducts)
      await this.applyBehavioralRecommendations(scores, user, allProducts)
    }

    if (context.currentProduct) {
      await this.applySimilarProductRecommendations(scores, context.currentProduct, allProducts)
      await this.applyCrossSellRecommendations(scores, context.currentProduct, allProducts)
    }

    if (context.cartItems && context.cartItems.length > 0) {
      await this.applyCartBasedRecommendations(scores, context.cartItems, allProducts)
    }

    // Apply trending and seasonal recommendations
    await this.applyTrendingRecommendations(scores, allProducts, page)
    await this.applySeasonalRecommendations(scores, allProducts)

    return Array.from(scores.values())
  }

  // Collaborative filtering: "Users like you also liked"
  private async applyCollaborativeFiltering(
    scores: Map<string, RecommendationScore>,
    user: User,
    _allProducts: Product[]
  ): Promise<void> {
    const userBehavior = this.getUserBehavior(user.id)
    if (!userBehavior) return

    // Find similar users based on purchase history
    const similarUsers = await this.findSimilarUsers(user.id)

    similarUsers.forEach(similarUser => {
      const weight = similarUser.similarity * 0.3 // 30% weight for collaborative filtering

      similarUser.purchasedProducts.forEach(productId => {
        if (!userBehavior.purchasedProducts.includes(productId)) {
          const score = scores.get(productId)
          if (score) {
            score.score += weight
            score.reasons.push({
              type: 'collaborative',
              weight,
              description: 'Users with similar preferences also bought this'
            })
          }
        }
      })
    })
  }

  // Content-based filtering: Based on product attributes
  private async applyContentBasedFiltering(
    scores: Map<string, RecommendationScore>,
    user: User,
    _allProducts: Product[]
  ): Promise<void> {
    const userBehavior = this.getUserBehavior(user.id)
    if (!userBehavior) return

    // Calculate user's category preferences
    const categoryPreferences = userBehavior.categoryPreferences

    const products = await this.getAllProducts()
    products.forEach((product: any) => {
      const categoryScore = categoryPreferences[product.category] || 0
      const weight = categoryScore * 0.25 // 25% weight for content-based

      if (weight > 0) {
        const score = scores.get(product.id)
        if (score) {
          score.score += weight
          score.reasons.push({
            type: 'content_based',
            weight,
            description: `Based on your interest in ${product.category}`
          })
        }
      }
    })
  }

  // Behavioral recommendations: Based on browsing patterns
  private async applyBehavioralRecommendations(
    scores: Map<string, RecommendationScore>,
    user: User,
    _allProducts: Product[]
  ): Promise<void> {
    const userBehavior = this.getUserBehavior(user.id)
    if (!userBehavior) return

    // Boost products similar to recently viewed items
    userBehavior.viewedProducts.slice(-10).forEach((viewedProductId, index) => {
      const recency = (index + 1) / 10 // More recent = higher weight
      const similarProducts = this.getSimilarProducts(viewedProductId)

      similarProducts.forEach(similarProduct => {
        const weight = similarProduct.similarity * recency * 0.2 // 20% weight
        const score = scores.get(similarProduct.productId)
        if (score) {
          score.score += weight
          score.reasons.push({
            type: 'behavioral',
            weight,
            description: 'Based on your recent browsing history'
          })
        }
      })
    })
  }

  // Similar product recommendations
  private async applySimilarProductRecommendations(
    scores: Map<string, RecommendationScore>,
    currentProduct: Product,
    _allProducts: Product[]
  ): Promise<void> {
    const similarProducts = this.getSimilarProducts(currentProduct.id)

    similarProducts.forEach(similar => {
      const weight = similar.similarity * 0.4 // 40% weight for similar products
      const score = scores.get(similar.productId)
      if (score) {
        score.score += weight
        score.reasons.push({
          type: 'content_based',
          weight,
          description: 'Similar to this product'
        })
      }
    })
  }

  // Cross-sell recommendations: Complementary products
  private async applyCrossSellRecommendations(
    scores: Map<string, RecommendationScore>,
    currentProduct: Product,
    allProducts: Product[]
  ): Promise<void> {
    // Mock cross-sell rules based on product categories
    const crossSellRules: Record<string, string[]> = {
      'shirts': ['dtf-transfers', 'hoodies'],
      'tumblers': ['dtf-transfers'],
      'dtf-transfers': ['shirts', 'hoodies', 'tumblers'],
      'hoodies': ['dtf-transfers', 'shirts'],
      '3d-models': ['dtf-transfers']
    }

    const complementaryCategories = crossSellRules[currentProduct.category] || []

    allProducts.forEach(product => {
      if (complementaryCategories.includes(product.category)) {
        const weight = 0.15 // 15% weight for cross-sell
        const score = scores.get(product.id)
        if (score) {
          score.score += weight
          score.reasons.push({
            type: 'cross_sell',
            weight,
            description: `Perfect complement to ${currentProduct.category}`
          })
        }
      }
    })
  }

  // Cart-based recommendations
  private async applyCartBasedRecommendations(
    scores: Map<string, RecommendationScore>,
    cartItems: CartItem[],
    allProducts: Product[]
  ): Promise<void> {
    const cartCategories = [...new Set(cartItems.map(item => item.product.category))]

    // Recommend products that complete the set
    allProducts.forEach(product => {
      if (!cartItems.find(item => item.product.id === product.id)) {
        let weight = 0

        // Boost products in same categories as cart items
        if (cartCategories.includes(product.category)) {
          weight += 0.2
        }

        // Boost complementary products
        cartCategories.forEach(cartCategory => {
          const crossSellRules: Record<string, string[]> = {
            'shirts': ['dtf-transfers'],
            'dtf-transfers': ['shirts', 'hoodies', 'tumblers']
          }

          if (crossSellRules[cartCategory]?.includes(product.category)) {
            weight += 0.15
          }
        })

        if (weight > 0) {
          const score = scores.get(product.id)
          if (score) {
            score.score += weight
            score.reasons.push({
              type: 'cross_sell',
              weight,
              description: 'Goes well with items in your cart'
            })
          }
        }
      }
    })
  }

  // Trending recommendations
  private async applyTrendingRecommendations(
    scores: Map<string, RecommendationScore>,
    _allProducts: Product[],
    page: string
  ): Promise<void> {
    // Boost trending products, especially on home page
    const trendingWeight = page === 'home' ? 0.25 : 0.1

    this.trendingProducts.forEach((productId, index) => {
      const trendScore = (this.trendingProducts.length - index) / this.trendingProducts.length
      const weight = trendingWeight * trendScore

      const score = scores.get(productId)
      if (score) {
        score.score += weight
        score.reasons.push({
          type: 'trending',
          weight,
          description: 'Trending this week'
        })
      }
    })
  }

  // Seasonal recommendations
  private async applySeasonalRecommendations(
    scores: Map<string, RecommendationScore>,
    allProducts: Product[]
  ): Promise<void> {
    const currentMonth = new Date().getMonth()
    const seasonalBoosts: Record<string, number[]> = {
      'hoodies': [10, 11, 0, 1, 2], // Winter months
      'shirts': [4, 5, 6, 7, 8], // Summer months
      'tumblers': [5, 6, 7, 8], // Summer/hot months
    }

    allProducts.forEach(product => {
      const boostMonths = seasonalBoosts[product.category]
      if (boostMonths?.includes(currentMonth)) {
        const weight = 0.1 // 10% seasonal boost
        const score = scores.get(product.id)
        if (score) {
          score.score += weight
          score.reasons.push({
            type: 'seasonal',
            weight,
            description: 'Perfect for this season'
          })
        }
      }
    })
  }

  // Helper methods
  private getUserBehavior(userId: string): UserBehavior | undefined {
    return this.userBehaviors.get(userId)
  }

  private async findSimilarUsers(userId: string): Promise<Array<{ similarity: number, purchasedProducts: string[] }>> {
    // Mock implementation - in real app, this would use ML algorithms
    const userBehavior = this.getUserBehavior(userId)
    if (!userBehavior) return []

    // Return mock similar users
    return [
      {
        similarity: 0.8,
        purchasedProducts: ['product_1', 'product_3', 'product_7']
      },
      {
        similarity: 0.6,
        purchasedProducts: ['product_2', 'product_5', 'product_8']
      }
    ]
  }

  private getSimilarProducts(productId: string): Array<{ productId: string, similarity: number }> {
    const similarities = this.productSimilarity.get(productId)
    if (!similarities) return []

    return Array.from(similarities.entries())
      .map(([id, similarity]) => ({ productId: id, similarity }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10)
  }

  private async getAllProducts(): Promise<Product[]> {
    // Mock products - in real app, this would fetch from database
    return [
      {
        id: 'product_1',
        name: 'Custom T-Shirt',
        description: 'High-quality cotton t-shirt',
        price: 25.99,
        images: ['/images/tshirt1.jpg'],
        category: 'shirts',
        inStock: true
      },
      {
        id: 'product_2',
        name: 'DTF Transfer - Logo Design',
        description: 'Professional logo transfer',
        price: 8.99,
        images: ['/images/dtf1.jpg'],
        category: 'dtf-transfers',
        inStock: true
      },
      {
        id: 'product_3',
        name: 'Custom Hoodie',
        description: 'Warm and comfortable hoodie',
        price: 45.99,
        images: ['/images/hoodie1.jpg'],
        category: 'hoodies',
        inStock: true
      },
      {
        id: 'product_4',
        name: 'Stainless Steel Tumbler',
        description: 'Insulated travel tumbler',
        price: 22.99,
        images: ['/images/tumbler1.jpg'],
        category: 'tumblers',
        inStock: true
      },
      {
        id: 'product_5',
        name: '3D Printed Figurine',
        description: 'Custom 3D printed model',
        price: 35.99,
        images: ['/images/3d1.jpg'],
        category: '3d-models',
        inStock: true
      }
    ]
  }

  private async getProductsByIds(productIds: string[]): Promise<Product[]> {
    const allProducts = await this.getAllProducts()
    return allProducts.filter(product => productIds.includes(product.id))
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

  // Initialize with mock data
  private initializeMockData(): void {
    // Mock product similarities
    const similarities = new Map([
      ['product_1', new Map([
        ['product_3', 0.8], // T-shirts and hoodies are similar
        ['product_2', 0.6]  // T-shirts often use DTF transfers
      ])],
      ['product_2', new Map([
        ['product_1', 0.6],
        ['product_3', 0.5],
        ['product_4', 0.4]
      ])],
      ['product_3', new Map([
        ['product_1', 0.8],
        ['product_2', 0.5]
      ])]
    ])

    this.productSimilarity = similarities

    // Mock trending products
    this.trendingProducts = ['product_2', 'product_1', 'product_4', 'product_3']

    // Mock user behaviors
    this.userBehaviors.set('demo-user-id', {
      userId: 'demo-user-id',
      viewedProducts: ['product_1', 'product_2', 'product_3'],
      purchasedProducts: ['product_1'],
      cartProducts: [],
      searchQueries: ['custom shirt', 'logo design'],
      categoryPreferences: {
        'shirts': 5,
        'dtf-transfers': 3,
        'hoodies': 2
      },
      timeSpentPerCategory: {
        'shirts': 120000, // 2 minutes
        'dtf-transfers': 80000
      },
      lastActivity: new Date().toISOString()
    })
  }
}

export const productRecommender = new ProductRecommender()
