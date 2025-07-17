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

    const {
      username,
      displayName,
      bio,
      location,
      website,
      socialLinks,
      avatarUrl,
      isPublic,
      showOrderHistory,
      showDesigns,
      showModels
    } = req.body

    // Validate required fields
    if (!username || !displayName) {
      return res.status(400).json({ error: 'Username and display name are required' })
    }

    // Convert component format to database format
    const profileData = {
      username,
      displayName,
      bio: bio || '',
      phone: location || '',
      companyName: website || '',
      preferences: socialLinks || {},
      avatarUrl: avatarUrl || null,
      profileCompleted: true
    }

    // Check if profile exists
    const existingProfile = await prisma.userProfile.findUnique({
      where: { id: userPayload.id },
      select: { id: true }
    })

    if (existingProfile) {
      // Update existing profile
      await prisma.userProfile.update({
        where: { id: userPayload.id },
        data: profileData
      })
    } else {
      // Get current user data to create profile
      const currentUser = await prisma.userProfile.findUnique({
        where: { id: userPayload.id }
      })

      if (!currentUser) {
        return res.status(404).json({ error: 'User not found' })
      }

      // Insert new profile (this should rarely happen as profiles are created during signup)
      await prisma.userProfile.create({
        data: {
          ...profileData,
          id: userPayload.id,
          email: currentUser.email,
          role: 'customer',
          emailVerified: currentUser.emailVerified,
          passwordHash: currentUser.passwordHash
        }
      })
    }

    res.status(200).json({ message: 'Profile updated successfully' })
  } catch (error) {
    console.error('Error updating profile:', error)
    res.status(500).json({ error: 'Internal server error' })
  } finally {
    await prisma.$disconnect()
  }
}