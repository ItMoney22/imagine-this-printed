import express from 'express'
import cors from 'cors'
import type { CorsOptions } from 'cors'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import pino from 'pino'
import pinoHttp from 'pino-http'
import { nanoid } from 'nanoid'

// Import routes
import accountRoutes from './routes/account.js'
import healthRoutes from './routes/health.js'
import webhooksRoutes from './routes/webhooks.js'
import userRoutes from './routes/user.js'
import walletRoutes from './routes/wallet.js'
import stripeRoutes from './routes/stripe.js'
import ordersRouter from './routes/orders.js'
import aiProductsRouter from './routes/admin/ai-products.js'
import adminWalletRouter from './routes/admin/wallet.js'
import replicateCallbackRouter from './routes/ai/replicate-callback.js'
import mockupsRouter from './routes/mockups.js'
import designerRouter from './routes/designer.js'
import realisticMockupsRouter from './routes/realistic-mockups.js'
import voiceRouter from './routes/ai/voice.js'
import conciergeAvatarRouter from './routes/ai/concierge-avatar.js'
import transcribeRouter from './routes/ai/transcribe.js'
import chatRouter from './routes/ai/chat.js'
import voiceChatRouter from './routes/ai/voice-chat.js'
import mrImagineChatRouter from './routes/ai/mr-imagine-chat.js'
import imageToolsRouter from './routes/ai/image-tools.js'
import userProductsRouter from './routes/user-products.js'
import userProductApprovalsRouter from './routes/admin/user-product-approvals.js'
import adminSupportRouter from './routes/admin/support.js'
import publicSupportRouter from './routes/support.js'
import adminImaginationPricingRouter from './routes/admin/imagination-pricing.js'
import adminImaginationProductsRouter from './routes/admin/imagination-products.js'
import imaginationStationRouter from './routes/imagination-station.js'
import adminCouponsRouter from './routes/admin/coupons.js'
import adminGiftCardsRouter from './routes/admin/gift-cards.js'
import couponsRouter from './routes/coupons.js'
import giftCardsRouter from './routes/gift-cards.js'
import marketingRouter from './routes/marketing.js'
import socialRouter from './routes/social.js'

// Import middleware
import { requireAuth } from './middleware/supabaseAuth.js'

// Load environment variables
dotenv.config()

// Setup logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname'
    }
  } : undefined
})

// Environment sanity check (log on boot, mask secrets)
const tail = (s?: string) => s ? `...${s.slice(-4)}` : 'none';
logger.info({
  env: {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT || 4000,
    BREVO_API_KEY: !!process.env.BREVO_API_KEY,
    BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL,
    BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    FRONTEND_URL: process.env.FRONTEND_URL,
    DATABASE_URL: !!process.env.DATABASE_URL,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    JWT_SECRET: !!process.env.JWT_SECRET,
    REPLICATE_API_TOKEN: !!process.env.REPLICATE_API_TOKEN,
    REPLICATE_API_KEY: !!process.env.REPLICATE_API_KEY,
    REPLICATE_PRODUCT_MODEL_ID: process.env.REPLICATE_PRODUCT_MODEL_ID,
    REPLICATE_TRYON_MODEL_ID: process.env.REPLICATE_TRYON_MODEL_ID,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    GCS_PROJECT_ID: process.env.GCS_PROJECT_ID,
    GCS_BUCKET_NAME: process.env.GCS_BUCKET_NAME,
    GCS_CREDENTIALS: !!process.env.GCS_CREDENTIALS,
  }
}, 'Environment variables loaded')

const app = express()
const PORT = process.env.PORT || 4000
const prisma = new PrismaClient()

// Middleware
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

// In development, allow all localhost origins
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV

const corsOptions: CorsOptions = {
  origin: isDevelopment
    ? true // Allow all origins in development
    : allowedOrigins.length > 0
      ? allowedOrigins
      : [/^https:\/\/.*imaginethisprinted\.com$/],
  credentials: true,
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}

app.use(cors(corsOptions))

// Stripe webhook needs raw body, so we apply it before JSON parsing
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Request logging middleware with request IDs
app.use(pinoHttp({
  logger,
  genReqId: () => nanoid(10),
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error'
    if (res.statusCode >= 400) return 'warn'
    return 'info'
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`
  }
}))

// Routes
app.use('/api/auth', accountRoutes)
app.use('/api/account', accountRoutes)
app.use('/api/health', healthRoutes)
app.use('/api/webhooks', webhooksRoutes)
app.use('/api/users', userRoutes)
app.use('/api/profile', userRoutes)
app.use('/api/wallet', walletRoutes)
app.use('/api/stripe', stripeRoutes)
app.use('/api/orders', ordersRouter)
app.use('/api/admin/products/ai', aiProductsRouter)
app.use('/api/admin/wallet', adminWalletRouter)
app.use('/api/ai/replicate', replicateCallbackRouter)
app.use('/api/mockups', mockupsRouter)
app.use('/api/designer', designerRouter)
app.use('/api/realistic-mockups', realisticMockupsRouter)
app.use('/api/ai/voice', voiceRouter)
app.use('/api/ai/concierge', conciergeAvatarRouter)
app.use('/api/ai/transcribe', transcribeRouter)
app.use('/api/ai/chat', chatRouter)
app.use('/api/ai/voice-chat', voiceChatRouter)
app.use('/api/ai/mr-imagine', mrImagineChatRouter)
app.use('/api/ai', imageToolsRouter) // Image tools: upscale, remove-background, enhance
app.use('/api/user-products', userProductsRouter)
app.use('/api/admin/user-products', userProductApprovalsRouter)
app.use('/api/admin/support', adminSupportRouter)
app.use('/api/support', publicSupportRouter) // Public support ticket creation
app.use('/api/admin/imagination-pricing', adminImaginationPricingRouter)
app.use('/api/admin/imagination-products', adminImaginationProductsRouter)
app.use('/api/imagination-station', imaginationStationRouter)
app.use('/api/admin/coupons', adminCouponsRouter)
app.use('/api/admin/gift-cards', adminGiftCardsRouter)
app.use('/api/coupons', couponsRouter)
app.use('/api/gift-cards', giftCardsRouter)
app.use('/api/marketing', marketingRouter)
app.use('/api/social', socialRouter)

// Lightweight auth probe
app.get('/api/auth/me', requireAuth, (req, res) => {
  return res.json({ ok: true, user: req.user })
})

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    service: 'imagine-this-printed-api',
    status: 'ok'
  })
})

// Catch all for unmatched routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  })
})

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  req.log.error({ err }, 'Unhandled error')
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  })
})

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...')
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...')
  await prisma.$disconnect()
  process.exit(0)
})

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`)
  logger.info(`📡 API available at http://localhost:${PORT}`)
  logger.info(`🏥 Health check: http://localhost:${PORT}/api/health`)
})

export default app
