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

    // Check if user is admin
    const user = await prisma.userProfile.findUnique({
      where: { id: userPayload.id },
      select: { role: true }
    })

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    // Get all table names and counts
    const tableQueries = [
      { name: 'user_profiles', query: 'SELECT COUNT(*) FROM user_profiles' },
      { name: 'user_wallets', query: 'SELECT COUNT(*) FROM user_wallets' },
      { name: 'products', query: 'SELECT COUNT(*) FROM products' },
      { name: 'orders', query: 'SELECT COUNT(*) FROM orders' },
      { name: 'order_items', query: 'SELECT COUNT(*) FROM order_items' },
      { name: 'points_transactions', query: 'SELECT COUNT(*) FROM points_transactions' },
      { name: 'itc_transactions', query: 'SELECT COUNT(*) FROM itc_transactions' },
      { name: 'referral_codes', query: 'SELECT COUNT(*) FROM referral_codes' },
      { name: 'referral_transactions', query: 'SELECT COUNT(*) FROM referral_transactions' },
      { name: 'messages', query: 'SELECT COUNT(*) FROM messages' },
      { name: 'vendor_payouts', query: 'SELECT COUNT(*) FROM vendor_payouts' },
      { name: 'founder_earnings', query: 'SELECT COUNT(*) FROM founder_earnings' },
      { name: 'kiosks', query: 'SELECT COUNT(*) FROM kiosks' },
      { name: 'cost_variables', query: 'SELECT COUNT(*) FROM cost_variables' },
      { name: 'product_cost_breakdowns', query: 'SELECT COUNT(*) FROM product_cost_breakdowns' },
      { name: 'product_variations', query: 'SELECT COUNT(*) FROM product_variations' },
      { name: 'variation_options', query: 'SELECT COUNT(*) FROM variation_options' }
    ]

    const tableResults = await Promise.all(
      tableQueries.map(async (table) => {
        try {
          const result = await prisma.$queryRawUnsafe(table.query)
          return {
            name: table.name,
            count: Number((result)[0]?.count || 0),
            columns: []
          }
        } catch (error) {
          return {
            name: table.name,
            count: 0,
            columns: []
          }
        }
      })
    )

    res.status(200).json({ tables: tableResults })
  } catch (error) {
    console.error('Error loading tables:', error)
    res.status(500).json({ error: 'Internal server error' })
  } finally {
    await prisma.$disconnect()
  }
}