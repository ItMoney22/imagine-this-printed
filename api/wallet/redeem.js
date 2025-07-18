import { PrismaClient } from '@prisma/client'
import { verifyToken } from '../../src/utils/auth.js'

const prisma = new PrismaClient()

export default async function handler(req, res) {
  if (req.method !== 'POST') {
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

    const { amount, redeemType } = req.body
    const pointsAmount = parseInt(amount)

    // Exchange rates
    const pointsToUSD = 0.01 // 1 point = $0.01
    const usdToITC = 0.25 // $1 = 0.25 ITC

    // Get current wallet balance
    const walletData = await prisma.userWallet.findUnique({
      where: { userId: userPayload.id },
      select: {
        pointsBalance: true,
        itcBalance: true
      }
    })

    const currentPointsBalance = walletData?.pointsBalance || 0
    const currentItcBalance = Number(walletData?.itcBalance || 0)

    if (pointsAmount > currentPointsBalance) {
      return res.status(400).json({ error: 'Insufficient points balance' })
    }

    if (redeemType === 'itc') {
      const usdValue = pointsAmount * pointsToUSD
      const itcAmount = usdValue * usdToITC

      // Create redemption transaction
      await prisma.pointsTransaction.create({
        data: {
          userId: userPayload.id,
          type: 'redeemed',
          amount: -pointsAmount,
          balanceAfter: currentPointsBalance - pointsAmount,
          reason: `Redeemed for ${itcAmount.toFixed(2)} ITC tokens`
        }
      })

      // Add ITC to wallet
      await prisma.itcTransaction.create({
        data: {
          userId: userPayload.id,
          type: 'reward',
          amount: itcAmount,
          balanceAfter: currentItcBalance + itcAmount,
          usdValue: usdValue,
          reason: 'Points redemption'
        }
      })

      // Update wallet balances
      await prisma.userWallet.upsert({
        where: { userId: userPayload.id },
        update: {
          pointsBalance: currentPointsBalance - pointsAmount,
          itcBalance: currentItcBalance + itcAmount
        },
        create: {
          userId: userPayload.id,
          pointsBalance: currentPointsBalance - pointsAmount,
          itcBalance: currentItcBalance + itcAmount
        }
      })

      res.status(200).json({ 
        message: `Successfully redeemed ${pointsAmount} points for ${itcAmount.toFixed(2)} ITC tokens!`,
        itcAmount: itcAmount.toFixed(2)
      })
    } else {
      res.status(400).json({ error: 'Unsupported redemption type' })
    }
  } catch (error) {
    console.error('Redemption error:', error)
    res.status(500).json({ error: 'Redemption failed. Please try again.' })
  } finally {
    await prisma.$disconnect()
  }
}