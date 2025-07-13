export interface Product {
  id: string
  name: string
  description: string
  price: number
  images: string[]
  category: 'dtf-transfers' | 'shirts' | 'tumblers' | 'hoodies' | '3d-models'
  inStock: boolean
  vendorId?: string
  approved?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface CartItem {
  id: string
  product: Product
  quantity: number
  customDesign?: string
}

export interface User {
  id: string
  email: string
  role: 'customer' | 'founder' | 'vendor' | 'admin' | 'manager' | 'wholesale' | 'kiosk'
  firstName?: string
  lastName?: string
  points?: number
  itcBalance?: number
  stripeAccountId?: string
  createdAt?: string
  companyName?: string
  businessType?: string
  taxId?: string
  wholesaleStatus?: 'pending' | 'approved' | 'rejected'
  wholesaleTier?: 'bronze' | 'silver' | 'gold' | 'platinum'
  creditLimit?: number
  paymentTerms?: number // days
}

export interface Order {
  id: string
  userId: string
  items: CartItem[]
  total: number
  status: 'pending' | 'processing' | 'printed' | 'shipped' | 'delivered' | 'on_hold' | 'approved' | 'rejected'
  createdAt: string
  assignedTo?: string
  profitMargin?: number
  materialCost?: number
  isCustomOrder?: boolean
  approvedBy?: string
  shippingLabelUrl?: string
  trackingNumber?: string
  customerNotes?: string
  internalNotes?: string
  shippingAddress?: ShippingAddress
  estimatedDelivery?: string
}

export interface ThreeDModel {
  id: string
  title: string
  description: string
  fileUrl: string
  previewUrl?: string
  category: 'figurines' | 'tools' | 'decorative' | 'functional' | 'toys'
  uploadedBy: string
  approved: boolean
  votes: number
  points: number
  createdAt: string
  fileType: 'stl' | '3mf' | 'obj' | 'glb'
}

export interface VendorProduct {
  id: string
  vendorId: string
  title: string
  description: string
  price: number
  images: string[]
  category: string
  approved: boolean
  commissionRate: number
  createdAt: string
}

export interface PointsTransaction {
  id: string
  userId: string
  type: 'earned' | 'redeemed'
  amount: number
  reason: string
  relatedId?: string
  createdAt: string
}

export interface ITCTransactionOld {
  id: string
  userId: string
  type: 'purchase' | 'reward' | 'redemption'
  amount: number
  usdValue: number
  reason: string
  createdAt: string
}

export interface CustomOrder {
  id: string
  customerId: string
  title: string
  description: string
  estimatedPrice: number
  status: 'pending' | 'approved' | 'in_progress' | 'completed' | 'rejected'
  assignedTo?: string
  approvedBy?: string
  files: string[]
  createdAt: string
}

export interface Invoice {
  id: string
  orderId: string
  founderId: string
  amount: number
  profitShare: number
  status: 'pending' | 'paid'
  stripeInvoiceId?: string
  createdAt: string
}

export interface CustomerContact {
  id: string
  userId: string
  email: string
  name: string
  phone?: string
  company?: string
  tags: string[]
  notes: ContactNote[]
  totalSpent: number
  totalOrders: number
  lastOrderDate?: string
  registrationDate: string
  preferredProducts: string[]
}

export interface ContactNote {
  id: string
  content: string
  createdBy: string
  createdAt: string
  type: 'general' | 'order' | 'complaint' | 'follow_up'
}

export interface CustomJobRequest {
  id: string
  customerId: string
  title: string
  description: string
  requirements: string
  budget?: number
  deadline?: string
  files: string[]
  status: 'submitted' | 'under_review' | 'approved' | 'in_progress' | 'completed' | 'rejected'
  assignedTo?: string
  approvedBy?: string
  estimatedCost?: number
  finalCost?: number
  notes: string[]
  createdAt: string
  updatedAt: string
}

export interface AuditLog {
  id: string
  userId: string
  action: string
  entity: string
  entityId: string
  changes?: Record<string, any>
  ipAddress?: string
  userAgent?: string
  createdAt: string
}

export interface MarketingCampaign {
  id: string
  name: string
  type: 'google_ads' | 'facebook_ads' | 'email' | 'social'
  status: 'draft' | 'active' | 'paused' | 'completed'
  targetProducts: string[]
  generatedContent: {
    headline: string
    description: string
    imageUrl?: string
  }
  budget?: number
  startDate?: string
  endDate?: string
  metrics: {
    impressions: number
    clicks: number
    conversions: number
    spend: number
  }
  createdBy: string
  createdAt: string
}

export interface SystemMetrics {
  totalUsers: number
  totalOrders: number
  totalRevenue: number
  activeVendors: number
  pendingApprovals: number
  modelsUploaded: number
  pointsDistributed: number
  activeSessions: number
}

export interface ShippingAddress {
  name: string
  company?: string
  address1: string
  address2?: string
  city: string
  state: string
  zip: string
  country: string
  phone?: string
  email?: string
}

export interface ShippingLabel {
  id: string
  orderId: string
  labelUrl: string
  trackingNumber: string
  carrier: string
  service: string
  cost: number
  createdAt: string
  estimatedDelivery?: string
}

export interface ITCTransaction {
  id: string
  userId: string
  type: 'purchase' | 'reward' | 'redemption' | 'ai_generation' | 'referral'
  amount: number
  usdValue: number
  reason: string
  transactionHash?: string
  stripePaymentId?: string
  createdAt: string
}

export interface AIGenerationRequest {
  id: string
  userId: string
  prompt: string
  style: 'realistic' | 'cartoon' | 'vaporwave' | 'minimalist' | 'vintage'
  imageUrl?: string
  cost: number
  status: 'pending' | 'completed' | 'failed'
  createdAt: string
}

export interface ReferralCode {
  id: string
  userId: string
  code: string
  isActive: boolean
  createdAt: string
  totalUses: number
  totalEarnings: number
  description: string
}

export interface ReferralTransaction {
  id: string
  referralCodeId: string
  referrerId: string
  refereeId: string
  refereeEmail: string
  type: 'signup' | 'purchase'
  referrerReward: number
  refereeReward: number
  status: 'pending' | 'completed' | 'failed'
  createdAt: string
  completedAt?: string
  metadata?: Record<string, any>
}

export interface Leaderboard {
  id: string
  type: 'vendors' | 'designers' | 'referrers'
  period: 'daily' | 'weekly' | 'monthly' | 'all_time'
  entries: LeaderboardEntry[]
  lastUpdated: string
}

export interface LeaderboardEntry {
  userId: string
  userName: string
  avatar?: string
  score: number
  rank: number
  metadata?: Record<string, any>
}

export interface RecommendationContext {
  user?: User
  currentProduct?: Product
  cartItems?: CartItem[]
  page: 'home' | 'product' | 'cart' | 'checkout' | 'category'
  limit?: number
  excludeIds?: string[]
}

export interface WholesaleProduct {
  id: string
  name: string
  description: string
  retailPrice: number
  wholesalePricing: WholesalePricing[]
  images: string[]
  category: 'dtf-transfers' | 'shirts' | 'tumblers' | 'hoodies' | '3d-models'
  inStock: boolean
  vendorId?: string
  approved?: boolean
  minimumOrderQuantity: number
  leadTime: number // days
  specifications: ProductSpecification[]
  bulkDiscounts: BulkDiscount[]
  customizationOptions: CustomizationOption[]
  createdAt?: string
  updatedAt?: string
}

export interface WholesalePricing {
  tier: 'bronze' | 'silver' | 'gold' | 'platinum'
  price: number
  minimumQuantity: number
}

export interface ProductSpecification {
  name: string
  value: string
  type: 'text' | 'measurement' | 'material' | 'color'
}

export interface BulkDiscount {
  minimumQuantity: number
  discountPercentage: number
  description: string
}

export interface CustomizationOption {
  id: string
  name: string
  type: 'color' | 'size' | 'material' | 'text' | 'image'
  options: string[]
  additionalCost?: number
  required: boolean
}

export interface WholesaleOrder {
  id: string
  customerId: string
  items: WholesaleOrderItem[]
  subtotal: number
  discount: number
  tax: number
  shipping: number
  total: number
  status: 'pending' | 'approved' | 'processing' | 'shipped' | 'delivered' | 'rejected'
  paymentStatus: 'pending' | 'paid' | 'overdue'
  paymentTerms: number
  dueDate: string
  estimatedShipDate: string
  actualShipDate?: string
  trackingNumbers: string[]
  invoiceNumber?: string
  poNumber?: string
  notes: string
  createdAt: string
  updatedAt: string
  approvedBy?: string
  rejectionReason?: string
}

export interface WholesaleOrderItem {
  id: string
  productId: string
  product: WholesaleProduct
  quantity: number
  unitPrice: number
  totalPrice: number
  customizations: Record<string, string>
  specifications?: string
}

export interface WholesaleAccount {
  id: string
  userId: string
  companyName: string
  businessType: 'retailer' | 'distributor' | 'reseller' | 'manufacturer' | 'other'
  taxId: string
  businessLicense?: string
  address: BusinessAddress
  contactPerson: ContactPerson
  tier: 'bronze' | 'silver' | 'gold' | 'platinum'
  status: 'pending' | 'approved' | 'suspended' | 'rejected'
  creditLimit: number
  paymentTerms: number
  discountRate: number
  totalOrders: number
  totalSpent: number
  averageOrderValue: number
  lastOrderDate?: string
  registrationDate: string
  approvedDate?: string
  approvedBy?: string
  notes: string[]
  documents: AccountDocument[]
}

export interface BusinessAddress {
  company: string
  address1: string
  address2?: string
  city: string
  state: string
  zip: string
  country: string
  phone: string
  email: string
}

export interface ContactPerson {
  firstName: string
  lastName: string
  title: string
  email: string
  phone: string
  mobile?: string
}

export interface AccountDocument {
  id: string
  type: 'business_license' | 'tax_certificate' | 'reseller_permit' | 'contract' | 'other'
  name: string
  url: string
  uploadedAt: string
  verified: boolean
}

export interface WholesaleVendor {
  id: string
  userId: string
  companyName: string
  businessDescription: string
  logo?: string
  coverImage?: string
  address: BusinessAddress
  contactInfo: ContactPerson
  categories: string[]
  productCount: number
  minimumOrderValue: number
  leadTime: number
  shippingMethods: ShippingMethod[]
  paymentMethods: string[]
  certifications: string[]
  rating: number
  reviewCount: number
  isVerified: boolean
  isFeatured: boolean
  status: 'active' | 'pending' | 'suspended'
  joinedDate: string
  lastActive: string
}

export interface ShippingMethod {
  name: string
  description: string
  estimatedDays: number
  cost: number
  freeShippingThreshold?: number
}

export interface VendorStorefrontTheme {
  primaryColor: string
  secondaryColor: string
  backgroundColor: string
  headerStyle: 'minimal' | 'bold' | 'classic'
  layout: 'grid' | 'list' | 'masonry'
  showPricing: boolean
  showReviews: boolean
  customCSS?: string
}

export interface VendorStorefrontConfig {
  id: string
  vendorId: string
  isPublic: boolean
  customDomain?: string
  customUrl: string
  seoTitle: string
  seoDescription: string
  theme: VendorStorefrontTheme
  featuredProducts: string[]
  categories: string[]
  socialLinks: {
    website?: string
    facebook?: string
    instagram?: string
    twitter?: string
    linkedin?: string
  }
  contactInfo: {
    showPhone: boolean
    showEmail: boolean
    showAddress: boolean
    customMessage?: string
  }
  analytics: {
    googleAnalyticsId?: string
    facebookPixelId?: string
  }
  lastUpdated: string
}

export interface UserProfile {
  id: string
  userId: string
  username: string
  displayName: string
  bio?: string
  profileImage?: string
  location?: string
  website?: string
  socialLinks: {
    twitter?: string
    instagram?: string
    linkedin?: string
  }
  isPublic: boolean
  showOrderHistory: boolean
  showDesigns: boolean
  showModels: boolean
  joinedDate: string
  totalOrders: number
  totalSpent: number
  favoriteCategories: string[]
  badges: ProfileBadge[]
}

export interface ProfileBadge {
  id: string
  name: string
  description: string
  icon: string
  unlockedAt: string
}

export interface Message {
  id: string
  conversationId: string
  senderId: string
  recipientId: string
  content: string
  messageType: 'text' | 'image' | 'file' | 'product_inquiry' | 'order_update'
  attachments?: MessageAttachment[]
  metadata?: {
    productId?: string
    orderId?: string
    [key: string]: any
  }
  isRead: boolean
  createdAt: string
  updatedAt?: string
}

export interface MessageAttachment {
  id: string
  type: 'image' | 'file' | 'document'
  name: string
  url: string
  size: number
  mimeType: string
}

export interface Conversation {
  id: string
  participants: string[]
  participantDetails: Array<{
    userId: string
    name: string
    email: string
    role: string
    profileImage?: string
  }>
  lastMessage?: Message
  unreadCount: number
  isArchived: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface VendorPayout {
  id: string
  vendorId: string
  orderId: string
  saleAmount: number
  platformFeeRate: number
  platformFee: number
  stripeFeeRate: number
  stripeFee: number
  payoutAmount: number
  status: 'pending' | 'processing' | 'paid' | 'failed'
  stripeTransferId?: string
  processedAt?: string
  createdAt: string
  metadata?: {
    productIds: string[]
    customerEmail: string
  }
}

export interface FounderEarnings {
  id: string
  orderId: string
  founderId: string
  saleAmount: number
  costOfGoods: number
  stripeFee: number
  grossProfit: number
  founderPercentage: number
  founderEarnings: number
  status: 'pending' | 'calculated' | 'paid'
  calculatedAt: string
  paidAt?: string
  notes?: string
}

export interface PlatformSettings {
  id: string
  platformFeePercentage: number
  stripeFeePercentage: number
  founderEarningsPercentage: number
  minimumPayoutAmount: number
  payoutSchedule: 'daily' | 'weekly' | 'monthly'
  autoPayoutEnabled: boolean
  lastUpdated: string
  updatedBy: string
}

export interface AdminEarningsOverview {
  totalRevenue: number
  totalPlatformFees: number
  totalVendorPayouts: number
  totalFounderEarnings: number
  pendingPayouts: number
  period: string
  breakdown: {
    vendorSales: number
    inHouseSales: number
    subscriptionRevenue: number
    otherRevenue: number
  }
}

export interface MessageNotification {
  id: string
  userId: string
  messageId: string
  conversationId: string
  type: 'new_message' | 'message_read' | 'conversation_archived'
  isRead: boolean
  createdAt: string
}

export interface CostVariables {
  id: string
  managerId: string
  locationId?: string
  filamentPricePerGram: number
  electricityCostPerHour: number
  averagePackagingCost: number
  monthlyRent: number
  overheadPercentage: number
  defaultMarginPercentage: number
  laborRatePerHour: number
  lastUpdated: string
  createdAt: string
}

export interface ProductCostBreakdown {
  id: string
  productId: string
  managerId: string
  printTimeHours: number
  materialUsageGrams: number
  materialCost: number
  electricityCost: number
  laborCost: number
  packagingCost: number
  overheadCost: number
  totalCost: number
  suggestedMargin: number
  suggestedPrice: number
  finalPrice?: number
  notes?: string
  lastUpdated: string
  createdAt: string
}

export interface GPTCostQuery {
  id: string
  userId: string
  query: string
  response: string
  context?: {
    costVariables?: CostVariables
    productData?: any
  }
  timestamp: string
}

export interface CostAnalytics {
  period: string
  totalProducts: number
  averageCost: number
  averageMargin: number
  profitableProducts: number
  lowMarginProducts: Array<{
    productId: string
    productName: string
    currentMargin: number
    suggestedMargin: number
  }>
  costTrends: Array<{
    date: string
    averageCost: number
    averageMargin: number
  }>
}

export interface Kiosk {
  id: string
  name: string
  vendorId: string
  kioskUserId: string
  location: string
  isActive: boolean
  commissionRate?: number
  partnerCommissionRate?: number
  accessUrl: string
  createdAt: string
  lastActivity?: string
  totalSales: number
  totalOrders: number
  settings: KioskSettings
}

export interface KioskSettings {
  allowCash: boolean
  allowStripeTerminal: boolean
  allowITCWallet: boolean
  requireCustomerInfo: boolean
  touchOptimized: boolean
  kioskMode: boolean
  autoLoginEnabled: boolean
  sessionTimeout: number // minutes
  primaryColor: string
  logoUrl?: string
  welcomeMessage: string
}

export interface KioskOrder {
  id: string
  kioskId: string
  vendorId: string
  customerId?: string
  items: CartItem[]
  total: number
  paymentMethod: 'card' | 'cash' | 'itc_wallet'
  paymentStatus: 'pending' | 'completed' | 'failed' | 'refunded'
  stripeTerminalPaymentId?: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  receiptEmail?: string
  notes?: string
  commission: {
    vendorAmount: number
    platformFee: number
    partnerCommission?: number
  }
  createdAt: string
  completedAt?: string
}

export interface KioskSession {
  id: string
  kioskId: string
  startedAt: string
  endedAt?: string
  totalSales: number
  totalOrders: number
  paymentBreakdown: {
    card: number
    cash: number
    itcWallet: number
  }
  isActive: boolean
}

export interface KioskAnalytics {
  kioskId: string
  period: string
  totalSales: number
  totalOrders: number
  averageOrderValue: number
  paymentMethodBreakdown: {
    card: { count: number; amount: number }
    cash: { count: number; amount: number }
    itcWallet: { count: number; amount: number }
  }
  hourlyBreakdown: Array<{
    hour: number
    sales: number
    orders: number
  }>
  topProducts: Array<{
    productId: string
    productName: string
    quantity: number
    revenue: number
  }>
  commission: {
    vendorEarnings: number
    platformFees: number
    partnerCommission: number
  }
}

export interface StripeTerminalPayment {
  id: string
  amount: number
  currency: string
  status: 'pending' | 'succeeded' | 'failed' | 'canceled'
  paymentMethodId?: string
  terminalId?: string
  receiptUrl?: string
  metadata?: Record<string, any>
}

export interface SocialPost {
  id: string
  platform: 'tiktok' | 'instagram' | 'youtube' | 'twitter'
  url: string
  embedCode?: string
  thumbnailUrl?: string
  title?: string
  description?: string
  author: {
    username: string
    displayName?: string
    profileImage?: string
  }
  submittedBy?: string
  submittedAt: string
  approvedBy?: string
  approvedAt?: string
  status: 'pending' | 'approved' | 'rejected' | 'featured'
  rejectionReason?: string
  tags: string[]
  productIds: string[]
  modelIds: string[]
  votes: number
  comments: SocialComment[]
  isFeatured: boolean
  featuredAt?: string
  viewCount: number
  engagement: {
    likes: number
    shares: number
    comments: number
  }
  metadata?: {
    originalPostId?: string
    duration?: number
    aspectRatio?: string
    [key: string]: any
  }
}

export interface SocialComment {
  id: string
  postId: string
  userId: string
  username: string
  content: string
  createdAt: string
  likes: number
  replies?: SocialComment[]
}

export interface SocialSubmission {
  id: string
  platform: 'tiktok' | 'instagram' | 'youtube' | 'twitter'
  url: string
  submittedBy: string
  submittedAt: string
  status: 'pending' | 'approved' | 'rejected'
  submitterHandle?: string
  featuredProducts: string[]
  description?: string
  notes?: string
  adminNotes?: string
  processedBy?: string
  processedAt?: string
}

export interface SocialAnalytics {
  period: string
  totalPosts: number
  totalViews: number
  totalEngagement: number
  platformBreakdown: {
    tiktok: { count: number; views: number; engagement: number }
    instagram: { count: number; views: number; engagement: number }
    youtube: { count: number; views: number; engagement: number }
    twitter: { count: number; views: number; engagement: number }
  }
  topPerformingPosts: Array<{
    postId: string
    title: string
    platform: string
    views: number
    engagement: number
  }>
  featuredProducts: Array<{
    productId: string
    productName: string
    mentionCount: number
    totalViews: number
  }>
  submissionTrends: Array<{
    date: string
    submissions: number
    approvals: number
  }>
}