import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function resetAdminPassword() {
  const newPassword = 'admin123!' // Change this to desired password
  const adminEmail = 'info@davidtrinidad.com'
  
  try {
    console.log('🔐 Resetting admin password...')
    
    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 12)
    
    // Update the admin user
    await prisma.userProfile.update({
      where: { email: adminEmail },
      data: {
        passwordHash: hashedPassword,
        emailVerified: true,
        profileCompleted: true
      }
    })
    
    console.log('✅ Admin password reset successfully!')
    console.log(`📧 Email: ${adminEmail}`)
    console.log(`🔑 Password: ${newPassword}`)
    console.log('⚠️  Please change this password after logging in!')
    
  } catch (error) {
    console.error('❌ Error resetting password:', error)
  } finally {
    await prisma.$disconnect()
  }
}

resetAdminPassword()