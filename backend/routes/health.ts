import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'

const router = Router()
const prisma = new PrismaClient()

// Database health check
router.get('/database', async (req: Request, res: Response) => {
  try {
    // Test database connection by checking if we can query the user table
    const userCount = await prisma.userProfile.count()
    
    res.status(200).json({
      status: 'connected',
      message: `Database connected successfully (${userCount} users)`
    })
  } catch (error) {
    console.error('Database health check error:', error)
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
      error: String(error)
    })
  }
})

// General health check
router.get('/', async (req: Request, res: Response) => {
  res.status(200).json({ ok: true })
})

export default router
