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

    const { tableName } = req.query

    if (!tableName) {
      return res.status(400).json({ error: 'Table name required' })
    }

    // Get table data - limiting to first 100 rows for performance
    const data = await prisma.$queryRawUnsafe(`SELECT * FROM ${tableName} LIMIT 100`)
    
    // Get column information
    const columnInfo = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = '${tableName}' 
      ORDER BY ordinal_position
    `)
    
    const columns = columnInfo.map((col) => col.column_name)

    res.status(200).json({
      data: data || [],
      columns: columns || []
    })
  } catch (error) {
    console.error('Error loading table data:', error)
    res.status(500).json({ error: 'Internal server error' })
  } finally {
    await prisma.$disconnect()
  }
}