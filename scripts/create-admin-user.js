import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createAdminUser() {
  try {
    // Check if admin user already exists
    const existingUser = await prisma.userProfile.findUnique({
      where: { email: 'info@davidtrinidad.com' }
    });

    if (existingUser) {
      console.log('Admin user already exists. Updating role to admin...');
      
      // Update existing user to admin
      const updatedUser = await prisma.userProfile.update({
        where: { email: 'info@davidtrinidad.com' },
        data: { 
          role: 'admin',
          emailVerified: true,
          profileCompleted: true
        }
      });
      
      console.log('Admin user role updated successfully:', updatedUser.email);
      return updatedUser;
    }

    // Create new admin user
    const hashedPassword = await bcrypt.hash('AdminPassword123!', 12);
    const username = 'admin';
    
    const adminUser = await prisma.userProfile.create({
      data: {
        email: 'info@davidtrinidad.com',
        passwordHash: hashedPassword,
        username,
        displayName: 'Admin User',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin',
        emailVerified: true,
        profileCompleted: true,
        preferences: {},
        metadata: {},
        wallet: {
          create: {
            pointsBalance: 0,
            itcBalance: 0,
            lifetimePointsEarned: 0,
            lifetimeItcEarned: 0,
            walletStatus: 'active'
          }
        }
      },
      include: {
        wallet: true
      }
    });

    console.log('Admin user created successfully:');
    console.log('Email:', adminUser.email);
    console.log('Role:', adminUser.role);
    console.log('Username:', adminUser.username);
    console.log('Password: AdminPassword123!');
    console.log('Please change the password after first login.');

    return adminUser;
  } catch (error) {
    console.error('Error creating admin user:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the function
createAdminUser()
  .then(() => {
    console.log('Admin user creation completed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to create admin user:', error);
    process.exit(1);
  });