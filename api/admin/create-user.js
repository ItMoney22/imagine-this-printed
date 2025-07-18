import { PrismaClient } from '@prisma/client'
import { verifyToken } from '../../src/utils/auth.js'
import { createUser } from '../../src/utils/auth.js'

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

    // Check if user is admin
    const user = await prisma.userProfile.findUnique({
      where: { id: userPayload.id },
      select: { role: true }
    })

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    const { name, email, password, role } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' })
    }

    // Create user
    const newUser = await createUser(email, password, {
      firstName: name.split(' ')[0],
      lastName: name.split(' ').slice(1).join(' ')
    })

    // Update user role if not customer
    if (role !== 'customer') {
      await prisma.userProfile.update({
        where: { email: email },
        data: { role: role }
      })
    }

    res.status(200).json({ message: 'User created successfully!' })
  } catch (error) {
    console.error('Error creating user:', error)
    res.status(500).json({ error: 'Failed to create user: ' + String(error) })
  } finally {
    await prisma.$disconnect()
  }
}