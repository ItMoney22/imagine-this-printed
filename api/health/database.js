import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

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
  } finally {
    await prisma.$disconnect()
  }
}