export interface RecommendationEvent {
  id: string
  userId: string
  productId: string
  eventType: 'impression' | 'click' | 'add_to_cart' | 'purchase'
  context: string // 'home', 'product', 'cart', etc.
  position: number
  recommendationReason: string[]
  timestamp: string
  sessionId?: string
  metadata?: Record<string, any>
}

export interface RecommendationMetrics {
  totalImpressions: number
  totalClicks: number
  totalAddToCarts: number
  totalPurchases: number
  clickThroughRate: number
  conversionRate: number
  addToCartRate: number
  revenue: number
  topPerformingProducts: Array<{
    productId: string
    productName: string
    impressions: number
    clicks: number
    conversions: number
    revenue: number
  }>
  performanceByContext: Record<string, {
    impressions: number
    clicks: number
    ctr: number
  }>
  performanceByReason: Record<string, {
    impressions: number
    clicks: number
    ctr: number
  }>
}

export interface UserRecommendationMetrics {
  userId: string
  totalRecommendationsViewed: number
  totalRecommendationsClicked: number
  totalRecommendationsPurchased: number
  clickThroughRate: number
  conversionRate: number
  averageOrderValue: number
  preferredCategories: string[]
  mostClickedReasons: string[]
  lastActivity: string
}

export class RecommendationAnalytics {
  private events: RecommendationEvent[] = []
  private sessionId: string

  constructor() {
    this.sessionId = this.generateSessionId()
    this.initializeMockData()
  }

  // Track recommendation impression
  trackImpression(
    userId: string,
    productId: string,
    context: string,
    position: number,
    reasons: string[],
    metadata?: Record<string, any>
  ): void {
    const event: RecommendationEvent = {
      id: this.generateEventId(),
      userId,
      productId,
      eventType: 'impression',
      context,
      position,
      recommendationReason: reasons,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      metadata
    }

    this.events.push(event)
    this.sendToAnalytics(event)
  }

  // Track recommendation click
  trackClick(
    userId: string,
    productId: string,
    context: string,
    position: number,
    reasons: string[],
    metadata?: Record<string, any>
  ): void {
    const event: RecommendationEvent = {
      id: this.generateEventId(),
      userId,
      productId,
      eventType: 'click',
      context,
      position,
      recommendationReason: reasons,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      metadata
    }

    this.events.push(event)
    this.sendToAnalytics(event)
  }

  // Track add to cart from recommendation
  trackAddToCart(
    userId: string,
    productId: string,
    context: string,
    position: number,
    reasons: string[],
    metadata?: Record<string, any>
  ): void {
    const event: RecommendationEvent = {
      id: this.generateEventId(),
      userId,
      productId,
      eventType: 'add_to_cart',
      context,
      position,
      recommendationReason: reasons,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      metadata
    }

    this.events.push(event)
    this.sendToAnalytics(event)
  }

  // Track purchase from recommendation
  trackPurchase(
    userId: string,
    productId: string,
    context: string,
    position: number,
    reasons: string[],
    orderValue: number,
    metadata?: Record<string, any>
  ): void {
    const event: RecommendationEvent = {
      id: this.generateEventId(),
      userId,
      productId,
      eventType: 'purchase',
      context,
      position,
      recommendationReason: reasons,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      metadata: {
        ...metadata,
        orderValue
      }
    }

    this.events.push(event)
    this.sendToAnalytics(event)
  }

  // Get overall recommendation metrics
  getOverallMetrics(startDate?: string, endDate?: string): RecommendationMetrics {
    const filteredEvents = this.filterEventsByDate(startDate, endDate)
    
    const impressions = filteredEvents.filter(e => e.eventType === 'impression')
    const clicks = filteredEvents.filter(e => e.eventType === 'click')
    const addToCarts = filteredEvents.filter(e => e.eventType === 'add_to_cart')
    const purchases = filteredEvents.filter(e => e.eventType === 'purchase')

    const totalImpressions = impressions.length
    const totalClicks = clicks.length
    const totalAddToCarts = addToCarts.length
    const totalPurchases = purchases.length

    const clickThroughRate = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
    const conversionRate = totalClicks > 0 ? (totalPurchases / totalClicks) * 100 : 0
    const addToCartRate = totalClicks > 0 ? (totalAddToCarts / totalClicks) * 100 : 0

    const revenue = purchases.reduce((sum, event) => {
      return sum + (event.metadata?.orderValue || 0)
    }, 0)

    // Calculate top performing products
    const productStats = new Map<string, {
      impressions: number
      clicks: number
      conversions: number
      revenue: number
    }>()

    filteredEvents.forEach(event => {
      if (!productStats.has(event.productId)) {
        productStats.set(event.productId, {
          impressions: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0
        })
      }

      const stats = productStats.get(event.productId)!
      
      switch (event.eventType) {
        case 'impression':
          stats.impressions++
          break
        case 'click':
          stats.clicks++
          break
        case 'purchase':
          stats.conversions++
          stats.revenue += event.metadata?.orderValue || 0
          break
      }
    })

    const topPerformingProducts = Array.from(productStats.entries())
      .map(([productId, stats]) => ({
        productId,
        productName: this.getProductName(productId),
        ...stats
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)

    // Performance by context
    const performanceByContext: Record<string, { impressions: number, clicks: number, ctr: number }> = {}
    const contextStats = new Map<string, { impressions: number, clicks: number }>()

    filteredEvents.forEach(event => {
      if (!contextStats.has(event.context)) {
        contextStats.set(event.context, { impressions: 0, clicks: 0 })
      }

      const stats = contextStats.get(event.context)!
      if (event.eventType === 'impression') stats.impressions++
      if (event.eventType === 'click') stats.clicks++
    })

    contextStats.forEach((stats, context) => {
      performanceByContext[context] = {
        impressions: stats.impressions,
        clicks: stats.clicks,
        ctr: stats.impressions > 0 ? (stats.clicks / stats.impressions) * 100 : 0
      }
    })

    // Performance by reason
    const performanceByReason: Record<string, { impressions: number, clicks: number, ctr: number }> = {}
    const reasonStats = new Map<string, { impressions: number, clicks: number }>()

    filteredEvents.forEach(event => {
      event.recommendationReason.forEach(reason => {
        if (!reasonStats.has(reason)) {
          reasonStats.set(reason, { impressions: 0, clicks: 0 })
        }

        const stats = reasonStats.get(reason)!
        if (event.eventType === 'impression') stats.impressions++
        if (event.eventType === 'click') stats.clicks++
      })
    })

    reasonStats.forEach((stats, reason) => {
      performanceByReason[reason] = {
        impressions: stats.impressions,
        clicks: stats.clicks,
        ctr: stats.impressions > 0 ? (stats.clicks / stats.impressions) * 100 : 0
      }
    })

    return {
      totalImpressions,
      totalClicks,
      totalAddToCarts,
      totalPurchases,
      clickThroughRate,
      conversionRate,
      addToCartRate,
      revenue,
      topPerformingProducts,
      performanceByContext,
      performanceByReason
    }
  }

  // Get user-specific recommendation metrics
  getUserMetrics(userId: string, startDate?: string, endDate?: string): UserRecommendationMetrics {
    const userEvents = this.filterEventsByDate(startDate, endDate)
      .filter(event => event.userId === userId)

    const impressions = userEvents.filter(e => e.eventType === 'impression')
    const clicks = userEvents.filter(e => e.eventType === 'click')
    const purchases = userEvents.filter(e => e.eventType === 'purchase')

    const totalRecommendationsViewed = impressions.length
    const totalRecommendationsClicked = clicks.length
    const totalRecommendationsPurchased = purchases.length

    const clickThroughRate = totalRecommendationsViewed > 0 
      ? (totalRecommendationsClicked / totalRecommendationsViewed) * 100 
      : 0

    const conversionRate = totalRecommendationsClicked > 0 
      ? (totalRecommendationsPurchased / totalRecommendationsClicked) * 100 
      : 0

    const averageOrderValue = purchases.length > 0
      ? purchases.reduce((sum, event) => sum + (event.metadata?.orderValue || 0), 0) / purchases.length
      : 0

    // Get preferred categories (mock implementation)
    const preferredCategories = ['shirts', 'dtf-transfers', 'hoodies']

    // Get most clicked reasons
    const reasonCounts = new Map<string, number>()
    clicks.forEach(event => {
      event.recommendationReason.forEach(reason => {
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1)
      })
    })

    const mostClickedReasons = Array.from(reasonCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason]) => reason)

    const lastActivity = userEvents.length > 0 
      ? userEvents[userEvents.length - 1].timestamp 
      : new Date().toISOString()

    return {
      userId,
      totalRecommendationsViewed,
      totalRecommendationsClicked,
      totalRecommendationsPurchased,
      clickThroughRate,
      conversionRate,
      averageOrderValue,
      preferredCategories,
      mostClickedReasons,
      lastActivity
    }
  }

  // Get recommendation performance for A/B testing
  getABTestMetrics(testId: string, variant: string): {
    impressions: number
    clicks: number
    conversions: number
    ctr: number
    conversionRate: number
  } {
    const testEvents = this.events.filter(event => 
      event.metadata?.testId === testId && event.metadata?.variant === variant
    )

    const impressions = testEvents.filter(e => e.eventType === 'impression').length
    const clicks = testEvents.filter(e => e.eventType === 'click').length
    const conversions = testEvents.filter(e => e.eventType === 'purchase').length

    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
    const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : 0

    return {
      impressions,
      clicks,
      conversions,
      ctr,
      conversionRate
    }
  }

  // Helper methods
  private generateEventId(): string {
    return `rec_event_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  }

  private filterEventsByDate(startDate?: string, endDate?: string): RecommendationEvent[] {
    let filtered = this.events

    if (startDate) {
      filtered = filtered.filter(event => event.timestamp >= startDate)
    }

    if (endDate) {
      filtered = filtered.filter(event => event.timestamp <= endDate)
    }

    return filtered
  }

  private getProductName(productId: string): string {
    // Mock product names - in real app, this would fetch from database
    const productNames: Record<string, string> = {
      'product_1': 'Custom T-Shirt',
      'product_2': 'DTF Transfer - Logo Design',
      'product_3': 'Custom Hoodie',
      'product_4': 'Stainless Steel Tumbler',
      'product_5': '3D Printed Figurine'
    }
    
    return productNames[productId] || `Product ${productId}`
  }

  private sendToAnalytics(event: RecommendationEvent): void {
    // Mock analytics sending - in real app, this would send to analytics service
    console.log('Analytics Event:', {
      eventType: event.eventType,
      productId: event.productId,
      context: event.context,
      position: event.position,
      reasons: event.recommendationReason,
      timestamp: event.timestamp
    })

    // In a real implementation, you might send to:
    // - Google Analytics
    // - Mixpanel
    // - Segment
    // - Custom analytics service
  }

  private initializeMockData(): void {
    // Add some mock events for demo purposes
    const mockEvents: RecommendationEvent[] = [
      {
        id: 'mock_1',
        userId: 'demo-user-id',
        productId: 'product_1',
        eventType: 'impression',
        context: 'home',
        position: 0,
        recommendationReason: ['trending', 'collaborative'],
        timestamp: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        sessionId: 'mock_session_1'
      },
      {
        id: 'mock_2',
        userId: 'demo-user-id',
        productId: 'product_1',
        eventType: 'click',
        context: 'home',
        position: 0,
        recommendationReason: ['trending', 'collaborative'],
        timestamp: new Date(Date.now() - 86300000).toISOString(),
        sessionId: 'mock_session_1'
      },
      {
        id: 'mock_3',
        userId: 'demo-user-id',
        productId: 'product_2',
        eventType: 'impression',
        context: 'product',
        position: 1,
        recommendationReason: ['content_based', 'cross_sell'],
        timestamp: new Date(Date.now() - 82800000).toISOString(),
        sessionId: 'mock_session_1'
      }
    ]

    this.events.push(...mockEvents)
  }
}

export const recommendationAnalytics = new RecommendationAnalytics()
