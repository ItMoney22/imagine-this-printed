import express from 'express'
import cors from 'cors'
import type { CorsOptions } from 'cors'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'

// Import routes
import accountRoutes from './routes/account'
import healthRoutes from './routes/health'
import webhooksRoutes from './routes/webhooks'
import userRoutes from './routes/user'

// Import middleware
import { requireAuth } from './middleware/supabaseAuth'

// Load environment variables
dotenv.config()

const app = express()
const PORT = process.env.PORT || 4000
const prisma = new PrismaClient()

// Middleware
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

const corsOptions: CorsOptions = {
  origin: allowedOrigins.length > 0 ? allowedOrigins : [/^https:\/\/.*imaginethisprinted\.com$/],
  credentials: true,
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}

app.use(cors(corsOptions))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
  next()
})

// Routes
app.use('/api/auth', accountRoutes)
app.use('/api/account', accountRoutes)
app.use('/api/health', healthRoutes)
app.use('/api/webhooks', webhooksRoutes)
app.use('/api/users', userRoutes)

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
  console.error('Unhandled error:', err)
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  })
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...')
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...')
  await prisma.$disconnect()
  process.exit(0)
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📡 API available at http://localhost:${PORT}`)
  console.log(`🏥 Health check: http://localhost:${PORT}/api/health`)
})

export default app
