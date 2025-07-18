import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createSimpleUser() {
  const email = 'demo@imaginethisprinted.com';
  const password = 'demo123';
  
  console.log('Creating simple demo user...');
  
  try {
    // Delete if exists
    await prisma.userProfile.delete({
      where: { email }
    }).catch(() => {}); // Ignore if not found
    
    const passwordHash = await bcrypt.hash(password, 12);
    const username = 'demo_user';
    
    const user = await prisma.userProfile.create({
      data: {
        email,
        passwordHash,
        username,
        firstName: 'Demo',
        lastName: 'User',
        emailVerified: true,
        profileCompleted: false,
        wallet: {
          create: {
            pointsBalance: 1000,
            itcBalance: 10.00,
            lifetimePointsEarned: 1000
          }
        }
      },
      include: { wallet: true }
    });
    
    console.log('✅ Created demo user:', user.email);
    console.log('   Email:', email);
    console.log('   Password:', password);
    console.log('   Points:', user.wallet.pointsBalance);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  await prisma.$disconnect();
}

createSimpleUser();