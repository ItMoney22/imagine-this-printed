export interface VendorAnalyticsEvent {
  id: string
  vendorId: string
  eventType: 'page_view' | 'product_view' | 'contact_click' | 'add_to_cart' | 'quote_request' | 'social_click'
  timestamp: string
  sessionId: string
  userId?: string
  userAgent: string
  ipAddress: string
  referrer?: string
  page: string
  metadata?: {
    productId?: string
    productName?: string
    socialPlatform?: string
    contactMethod?: string
    [key: string]: any
  }
}

export interface VendorAnalyticsMetrics {
  vendorId: string
  period: 'day' | 'week' | 'month' | 'quarter' | 'year'
  startDate: string
  endDate: string
  totalPageViews: number
  uniqueVisitors: number
  totalProductViews: number
  contactClicks: number
  addToCarts: number
  quoteRequests: number
  conversionRate: number
  averageSessionDuration: number
  bounceRate: number
  topPages: Array<{
    page: string
    views: number
    uniqueViews: number
  }>
  topProducts: Array<{
    productId: string
    productName: string
    views: number
    addToCarts: number
    quoteRequests: number
  }>
  trafficSources: Array<{
    source: string
    visitors: number
    percentage: number
  }>
  deviceTypes: Array<{
    type: 'desktop' | 'mobile' | 'tablet'
    visitors: number
    percentage: number
  }>
  geographicData: Array<{
    country: string
    state?: string
    city?: string
    visitors: number
  }>
  timeSeriesData: Array<{
    date: string
    pageViews: number
    uniqueVisitors: number
    contactClicks: number
  }>
}

export interface VendorPerformanceReport {
  vendorId: string
  companyName: string
  reportPeriod: string
  summary: {
    totalViews: number
    totalUniqueVisitors: number
    totalLeads: number
    totalQuotes: number
    conversionRate: number
    growthRate: number
  }
  highlights: string[]
  recommendations: string[]
  competitorComparison?: {
    industryAverage: {
      conversionRate: number
      averageViews: number
      bounceRate: number
    }
    yourPerformance: {
      conversionRate: number
      averageViews: number
      bounceRate: number
    }
  }
}

export class VendorAnalyticsTracker {
  private events: VendorAnalyticsEvent[] = []
  private sessionId: string
  private vendorId: string

  constructor(vendorId: string) {
    this.vendorId = vendorId
    this.sessionId = this.generateSessionId()
    this.initializeMockData()
  }

  // Track page view
  trackPageView(page: string, userId?: string, referrer?: string): void {
    this.trackEvent('page_view', page, userId, { referrer })
  }

  // Track product view
  trackProductView(productId: string, productName: string, userId?: string): void {
    this.trackEvent('product_view', '/product', userId, { productId, productName })
  }

  // Track contact interactions
  trackContactClick(contactMethod: 'phone' | 'email' | 'form' | 'chat', userId?: string): void {
    this.trackEvent('contact_click', '/contact', userId, { contactMethod })
  }

  // Track add to cart
  trackAddToCart(productId: string, productName: string, userId?: string): void {
    this.trackEvent('add_to_cart', '/product', userId, { productId, productName })
  }

  // Track quote requests
  trackQuoteRequest(productId?: string, productName?: string, userId?: string): void {
    this.trackEvent('quote_request', '/quote', userId, { productId, productName })
  }

  // Track social media clicks
  trackSocialClick(platform: string, userId?: string): void {
    this.trackEvent('social_click', '/contact', userId, { socialPlatform: platform })
  }

  // Get analytics metrics for a period
  async getMetrics(
    period: 'day' | 'week' | 'month' | 'quarter' | 'year',
    startDate?: string,
    endDate?: string
  ): Promise<VendorAnalyticsMetrics> {
    const end = endDate ? new Date(endDate) : new Date()
    const start = startDate ? new Date(startDate) : this.calculateStartDate(period, end)

    const filteredEvents = this.events.filter(event => {
      const eventDate = new Date(event.timestamp)
      return eventDate >= start && eventDate <= end && event.vendorId === this.vendorId
    })

    return this.calculateMetrics(filteredEvents, period, start.toISOString(), end.toISOString())
  }

  // Generate performance report
  async generatePerformanceReport(period: string): Promise<VendorPerformanceReport> {
    const metrics = await this.getMetrics('month')
    const previousMetrics = await this.getMetrics('month', 
      this.calculateStartDate('month', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).toISOString()
    )

    const growthRate = previousMetrics.totalPageViews > 0 
      ? ((metrics.totalPageViews - previousMetrics.totalPageViews) / previousMetrics.totalPageViews) * 100 
      : 0

    const highlights = this.generateHighlights(metrics, growthRate)
    const recommendations = this.generateRecommendations(metrics)

    return {
      vendorId: this.vendorId,
      companyName: 'Premium Apparel Co.', // Would fetch from vendor data
      reportPeriod: period,
      summary: {
        totalViews: metrics.totalPageViews,
        totalUniqueVisitors: metrics.uniqueVisitors,
        totalLeads: metrics.contactClicks,
        totalQuotes: metrics.quoteRequests,
        conversionRate: metrics.conversionRate,
        growthRate
      },
      highlights,
      recommendations,
      competitorComparison: {
        industryAverage: {
          conversionRate: 2.4,
          averageViews: 1250,
          bounceRate: 58.2
        },
        yourPerformance: {
          conversionRate: metrics.conversionRate,
          averageViews: metrics.totalPageViews,
          bounceRate: metrics.bounceRate
        }
      }
    }
  }

  // Export analytics data
  exportData(format: 'csv' | 'json' | 'pdf', _period: string): string {
    const data = this.events.filter(event => event.vendorId === this.vendorId)
    
    switch (format) {
      case 'csv':
        return this.exportToCSV(data)
      case 'json':
        return JSON.stringify(data, null, 2)
      case 'pdf':
        return this.generatePDFReport(data)
      default:
        throw new Error('Unsupported export format')
    }
  }

  // Get real-time dashboard data
  async getRealTimeDashboard(): Promise<{
    currentVisitors: number
    todaysViews: number
    todaysUniqueVisitors: number
    todaysLeads: number
    recentEvents: VendorAnalyticsEvent[]
    topPagesNow: Array<{ page: string; activeUsers: number }>
  }> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const todaysEvents = this.events.filter(event => {
      const eventDate = new Date(event.timestamp)
      return eventDate >= today && event.vendorId === this.vendorId
    })

    const recentEvents = todaysEvents
      .filter(event => new Date(event.timestamp) > new Date(Date.now() - 5 * 60 * 1000)) // Last 5 minutes
      .slice(-10)

    return {
      currentVisitors: Math.floor(Math.random() * 15) + 1, // Mock real-time data
      todaysViews: todaysEvents.filter(e => e.eventType === 'page_view').length,
      todaysUniqueVisitors: new Set(todaysEvents.map(e => e.sessionId)).size,
      todaysLeads: todaysEvents.filter(e => e.eventType === 'contact_click').length,
      recentEvents,
      topPagesNow: [
        { page: '/products', activeUsers: 5 },
        { page: '/about', activeUsers: 3 },
        { page: '/contact', activeUsers: 2 }
      ]
    }
  }

  // A/B test tracking
  trackABTest(testId: string, variant: string, eventType: string, metadata?: any): void {
    this.trackEvent(eventType as any, '/ab-test', undefined, {
      ...metadata,
      testId,
      variant
    })
  }

  // Conversion funnel tracking
  async getConversionFunnel(): Promise<Array<{
    step: string
    users: number
    conversionRate: number
    dropoffRate: number
  }>> {
    const steps = [
      { name: 'Storefront Visit', events: ['page_view'] },
      { name: 'Product View', events: ['product_view'] },
      { name: 'Contact/Interest', events: ['contact_click', 'quote_request'] },
      { name: 'Add to Cart', events: ['add_to_cart'] }
    ]

    const funnel = []
    let previousUsers = 0

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const users = new Set(
        this.events
          .filter(event => step.events.includes(event.eventType) && event.vendorId === this.vendorId)
          .map(event => event.sessionId)
      ).size

      const conversionRate = i === 0 ? 100 : previousUsers > 0 ? (users / previousUsers) * 100 : 0
      const dropoffRate = i === 0 ? 0 : 100 - conversionRate

      funnel.push({
        step: step.name,
        users,
        conversionRate,
        dropoffRate
      })

      previousUsers = users
    }

    return funnel
  }

  // Private helper methods
  private trackEvent(
    eventType: VendorAnalyticsEvent['eventType'],
    page: string,
    userId?: string,
    metadata?: any
  ): void {
    const event: VendorAnalyticsEvent = {
      id: this.generateEventId(),
      vendorId: this.vendorId,
      eventType,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      userId,
      userAgent: navigator.userAgent,
      ipAddress: '192.168.1.1', // Mock IP
      referrer: document.referrer || undefined,
      page,
      metadata
    }

    this.events.push(event)
    this.sendToAnalyticsService(event)
  }

  private calculateMetrics(
    events: VendorAnalyticsEvent[],
    period: string,
    startDate: string,
    endDate: string
  ): VendorAnalyticsMetrics {
    const pageViews = events.filter(e => e.eventType === 'page_view')
    const productViews = events.filter(e => e.eventType === 'product_view')
    const contactClicks = events.filter(e => e.eventType === 'contact_click')
    const addToCarts = events.filter(e => e.eventType === 'add_to_cart')
    const quoteRequests = events.filter(e => e.eventType === 'quote_request')

    const uniqueVisitors = new Set(pageViews.map(e => e.sessionId)).size
    const totalPageViews = pageViews.length
    const conversionRate = uniqueVisitors > 0 ? ((contactClicks.length + quoteRequests.length) / uniqueVisitors) * 100 : 0

    // Calculate top pages
    const pageCount = new Map<string, number>()
    pageViews.forEach(event => {
      pageCount.set(event.page, (pageCount.get(event.page) || 0) + 1)
    })

    const topPages = Array.from(pageCount.entries())
      .map(([page, views]) => ({
        page,
        views,
        uniqueViews: new Set(pageViews.filter(e => e.page === page).map(e => e.sessionId)).size
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10)

    // Calculate top products
    const productCount = new Map<string, { views: number, addToCarts: number, quotes: number }>()
    productViews.forEach(event => {
      const productId = event.metadata?.productId || 'unknown'
      if (!productCount.has(productId)) {
        productCount.set(productId, { views: 0, addToCarts: 0, quotes: 0 })
      }
      productCount.get(productId)!.views++
    })

    addToCarts.forEach(event => {
      const productId = event.metadata?.productId || 'unknown'
      if (productCount.has(productId)) {
        productCount.get(productId)!.addToCarts++
      }
    })

    quoteRequests.forEach(event => {
      const productId = event.metadata?.productId || 'unknown'
      if (productCount.has(productId)) {
        productCount.get(productId)!.quotes++
      }
    })

    const topProducts = Array.from(productCount.entries())
      .map(([productId, stats]) => ({
        productId,
        productName: `Product ${productId}`, // Would fetch from product data
        views: stats.views,
        addToCarts: stats.addToCarts,
        quoteRequests: stats.quotes
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10)

    // Generate time series data
    const timeSeriesData = this.generateTimeSeriesData(events, period, startDate, endDate)

    return {
      vendorId: this.vendorId,
      period: period as any,
      startDate,
      endDate,
      totalPageViews,
      uniqueVisitors,
      totalProductViews: productViews.length,
      contactClicks: contactClicks.length,
      addToCarts: addToCarts.length,
      quoteRequests: quoteRequests.length,
      conversionRate,
      averageSessionDuration: 245, // Mock data
      bounceRate: 42.5, // Mock data
      topPages,
      topProducts,
      trafficSources: [
        { source: 'Direct', visitors: Math.floor(uniqueVisitors * 0.4), percentage: 40 },
        { source: 'Google', visitors: Math.floor(uniqueVisitors * 0.3), percentage: 30 },
        { source: 'Social Media', visitors: Math.floor(uniqueVisitors * 0.2), percentage: 20 },
        { source: 'Referral', visitors: Math.floor(uniqueVisitors * 0.1), percentage: 10 }
      ],
      deviceTypes: [
        { type: 'desktop', visitors: Math.floor(uniqueVisitors * 0.6), percentage: 60 },
        { type: 'mobile', visitors: Math.floor(uniqueVisitors * 0.35), percentage: 35 },
        { type: 'tablet', visitors: Math.floor(uniqueVisitors * 0.05), percentage: 5 }
      ],
      geographicData: [
        { country: 'United States', state: 'California', city: 'Los Angeles', visitors: Math.floor(uniqueVisitors * 0.3) },
        { country: 'United States', state: 'New York', city: 'New York', visitors: Math.floor(uniqueVisitors * 0.2) },
        { country: 'Canada', city: 'Toronto', visitors: Math.floor(uniqueVisitors * 0.1) }
      ],
      timeSeriesData
    }
  }

  private generateTimeSeriesData(
    _events: VendorAnalyticsEvent[],
    _period: string,
    startDate: string,
    endDate: string
  ): Array<{ date: string, pageViews: number, uniqueVisitors: number, contactClicks: number }> {
    // Mock time series data generation
    const data = []
    const start = new Date(startDate)
    const end = new Date(endDate)
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))

    for (let i = 0; i < daysDiff; i++) {
      const date = new Date(start)
      date.setDate(date.getDate() + i)
      
      data.push({
        date: date.toISOString().split('T')[0],
        pageViews: Math.floor(Math.random() * 50) + 10,
        uniqueVisitors: Math.floor(Math.random() * 30) + 5,
        contactClicks: Math.floor(Math.random() * 10)
      })
    }

    return data
  }

  private generateHighlights(metrics: VendorAnalyticsMetrics, growthRate: number): string[] {
    const highlights = []

    if (growthRate > 10) {
      highlights.push(`📈 Page views increased by ${growthRate.toFixed(1)}% compared to last month`)
    }

    if (metrics.conversionRate > 3) {
      highlights.push(`🎯 Excellent conversion rate of ${metrics.conversionRate.toFixed(1)}% (above industry average)`)
    }

    if (metrics.topProducts.length > 0) {
      highlights.push(`⭐ ${metrics.topProducts[0].productName} is your most popular product with ${metrics.topProducts[0].views} views`)
    }

    if (metrics.uniqueVisitors > 100) {
      highlights.push(`👥 Reached ${metrics.uniqueVisitors} unique visitors this month`)
    }

    return highlights.length > 0 ? highlights : ['📊 Your storefront is performing well! Keep up the great work.']
  }

  private generateRecommendations(metrics: VendorAnalyticsMetrics): string[] {
    const recommendations = []

    if (metrics.conversionRate < 2) {
      recommendations.push('💡 Consider adding more contact options or call-to-action buttons to improve conversion rate')
    }

    if (metrics.bounceRate > 60) {
      recommendations.push('🎨 High bounce rate detected. Consider improving page loading speed and content quality')
    }

    if (metrics.totalProductViews < metrics.totalPageViews * 0.3) {
      recommendations.push('📦 Feature more products on your homepage to increase product discovery')
    }

    if (metrics.contactClicks < 10) {
      recommendations.push('📞 Make your contact information more prominent to encourage customer inquiries')
    }

    return recommendations.length > 0 ? recommendations : ['✅ Your storefront is performing well across all key metrics!']
  }

  private exportToCSV(events: VendorAnalyticsEvent[]): string {
    const headers = ['ID', 'Event Type', 'Timestamp', 'Page', 'User ID', 'Session ID', 'Referrer']
    const rows = events.map(event => [
      event.id,
      event.eventType,
      event.timestamp,
      event.page,
      event.userId || '',
      event.sessionId,
      event.referrer || ''
    ])

    return [headers, ...rows].map(row => row.join(',')).join('\n')
  }

  private generatePDFReport(_events: VendorAnalyticsEvent[]): string {
    // Mock PDF generation - in real app, would use a PDF library
    return 'PDF report generated (mock implementation)'
  }

  private calculateStartDate(period: string, endDate: Date): Date {
    const start = new Date(endDate)
    
    switch (period) {
      case 'day':
        start.setDate(start.getDate() - 1)
        break
      case 'week':
        start.setDate(start.getDate() - 7)
        break
      case 'month':
        start.setMonth(start.getMonth() - 1)
        break
      case 'quarter':
        start.setMonth(start.getMonth() - 3)
        break
      case 'year':
        start.setFullYear(start.getFullYear() - 1)
        break
    }
    
    return start
  }

  private generateEventId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  }

  private sendToAnalyticsService(event: VendorAnalyticsEvent): void {
    // Mock analytics service call
    console.log('Analytics Event:', event)
    
    // In real implementation, would send to:
    // - Google Analytics
    // - Custom analytics service
    // - Database for storage
  }

  private initializeMockData(): void {
    // Add some mock historical events for demo
    const mockEvents: VendorAnalyticsEvent[] = []
    const now = Date.now()
    
    for (let i = 0; i < 100; i++) {
      const timestamp = new Date(now - Math.random() * 30 * 24 * 60 * 60 * 1000) // Last 30 days
      
      mockEvents.push({
        id: `mock_event_${i}`,
        vendorId: this.vendorId,
        eventType: 'page_view',
        timestamp: timestamp.toISOString(),
        sessionId: `session_${Math.floor(i / 3)}`,
        userAgent: 'MockUserAgent',
        ipAddress: '192.168.1.1',
        page: ['/products', '/about', '/contact', '/product/1'][Math.floor(Math.random() * 4)]
      })
    }

    this.events.push(...mockEvents)
  }
}

// Vendor analytics dashboard utilities
export class VendorAnalyticsDashboard {
  static formatMetric(value: number, type: 'number' | 'percentage' | 'currency' | 'time'): string {
    switch (type) {
      case 'number':
        return value.toLocaleString()
      case 'percentage':
        return `${value.toFixed(1)}%`
      case 'currency':
        return `$${value.toFixed(2)}`
      case 'time':
        return `${Math.floor(value / 60)}:${(value % 60).toString().padStart(2, '0')}`
      default:
        return value.toString()
    }
  }

  static getMetricTrend(current: number, previous: number): {
    direction: 'up' | 'down' | 'flat'
    percentage: number
    isPositive: boolean
  } {
    if (previous === 0) {
      return { direction: current > 0 ? 'up' : 'flat', percentage: 0, isPositive: true }
    }

    const percentage = ((current - previous) / previous) * 100
    const direction = percentage > 1 ? 'up' : percentage < -1 ? 'down' : 'flat'
    const isPositive = percentage >= 0

    return { direction, percentage: Math.abs(percentage), isPositive }
  }

  static generateInsights(metrics: VendorAnalyticsMetrics): string[] {
    const insights = []

    // Traffic insights
    if (metrics.uniqueVisitors > 0) {
      const avgPageViewsPerVisitor = metrics.totalPageViews / metrics.uniqueVisitors
      if (avgPageViewsPerVisitor > 3) {
        insights.push(`Visitors are highly engaged, viewing ${avgPageViewsPerVisitor.toFixed(1)} pages on average`)
      }
    }

    // Product insights
    if (metrics.topProducts.length > 0) {
      const topProduct = metrics.topProducts[0]
      const productConversion = topProduct.views > 0 ? (topProduct.addToCarts / topProduct.views) * 100 : 0
      
      if (productConversion > 5) {
        insights.push(`${topProduct.productName} has strong appeal with ${productConversion.toFixed(1)}% add-to-cart rate`)
      }
    }

    // Traffic source insights
    const organicTraffic = metrics.trafficSources.find(s => s.source === 'Google')
    if (organicTraffic && organicTraffic.percentage > 40) {
      insights.push('Strong organic search presence - your SEO efforts are paying off')
    }

    return insights
  }
}

export const createVendorAnalyticsTracker = (vendorId: string) => new VendorAnalyticsTracker(vendorId)