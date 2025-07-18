#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const testUsers = [
  {
    email: 'test1@imaginethisprinted.com',
    username: 'testuser1',
    firstName: 'Test',
    lastName: 'User One',
    password: 'TestPass123!'
  },
  {
    email: 'test2@imaginethisprinted.com', 
    username: 'testuser2',
    firstName: 'Test',
    lastName: 'User Two',
    password: 'TestPass123!'
  }
];

async function createTestUsers() {
  console.log('🔄 Creating test users...');
  
  try {
    // Clean up existing test users
    await prisma.userProfile.deleteMany({
      where: {
        email: {
          in: testUsers.map(u => u.email)
        }
      }
    });
    
    for (const testUser of testUsers) {
      const passwordHash = await bcrypt.hash(testUser.password, 12);
      
      const user = await prisma.userProfile.create({
        data: {
          email: testUser.email,
          username: testUser.username,
          firstName: testUser.firstName,
          lastName: testUser.lastName,
          passwordHash,
          emailVerified: true,
          profileCompleted: false,
          wallet: {
            create: {
              pointsBalance: 1000, // Sign-up bonus
              itcBalance: 10.00   // Welcome ITC
            }
          }
        },
        include: {
          wallet: true
        }
      });
      
      console.log(`✅ Created test user: ${user.email} (ID: ${user.id})`);
      console.log(`   - Points: ${user.wallet.pointsBalance}`);
      console.log(`   - ITC: ${user.wallet.itcBalance}`);
      console.log(`   - Profile completed: ${user.profileCompleted}`);
    }
    
    console.log('🎉 All test users created successfully!');
    
    // Verify no Supabase references exist
    const supabaseReferences = await prisma.$queryRaw`
      SELECT table_name, column_name 
      FROM information_schema.columns 
      WHERE column_name LIKE '%supabase%' OR column_name LIKE '%auth%'
      AND table_schema = 'public'
    `;
    
    if (supabaseReferences.length === 0) {
      console.log('✅ No Supabase references found in database schema');
    } else {
      console.warn('⚠️  Found potential Supabase references:', supabaseReferences);
    }
    
  } catch (error) {
    console.error('❌ Error creating test users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

async function testAuthentication() {
  console.log('🔄 Testing authentication system...');
  
  try {
    const testEmail = testUsers[0].email;
    const testPassword = testUsers[0].password;
    
    // Find user
    const user = await prisma.userProfile.findUnique({
      where: { email: testEmail },
      include: { wallet: true }
    });
    
    if (!user) {
      console.error('❌ Test user not found');
      return;
    }
    
    // Test password verification
    const isValid = await bcrypt.compare(testPassword, user.passwordHash);
    
    if (isValid) {
      console.log('✅ Password verification successful');
      console.log(`   - User: ${user.firstName} ${user.lastName}`);
      console.log(`   - Email verified: ${user.emailVerified}`);
      console.log(`   - Points balance: ${user.wallet.pointsBalance}`);
      console.log(`   - ITC balance: ${user.wallet.itcBalance}`);
    } else {
      console.error('❌ Password verification failed');
    }
    
  } catch (error) {
    console.error('❌ Authentication test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the tests
async function main() {
  await createTestUsers();
  await testAuthentication();
}

main().catch(console.error);