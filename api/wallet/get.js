import { PrismaClient } from '@prisma/client'
import { verifyToken } from '../../src/utils/auth.js'

const prisma = new PrismaClient()

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const token = authHeader.substring(7)
    const userPayload = verifyToken(token)
    if (!userPayload) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    // Load wallet balance with user isolation
    const walletData = await prisma.userWallet.findUnique({
      where: { userId: userPayload.id },
      select: {
        pointsBalance: true,
        itcBalance: true
      }
    })

    // Load points transaction history
    const pointsData = await prisma.pointsTransaction.findMany({
      where: { userId: userPayload.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    })

    // Load ITC transaction history  
    const itcData = await prisma.itcTransaction.findMany({
      where: { userId: userPayload.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    })

    res.status(200).json({
      pointsBalance: walletData?.pointsBalance || 0,
      itcBalance: Number(walletData?.itcBalance || 0),
      pointsHistory: pointsData || [],
      itcHistory: itcData || []
    })
  } catch (error) {
    console.error('Error loading wallet data:', error)
    res.status(500).json({ error: 'Failed to load wallet data: ' + error.message })
  } finally {
    await prisma.$disconnect()
  }
}