#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanTestData() {
  console.log('🧹 Cleaning test data...');
  
  try {
    // Clean up test messages
    console.log('🗑️  Removing test messages...');
    const deletedMessages = await prisma.message.deleteMany({
      where: {
        OR: [
          { subject: { contains: 'Test Message' } },
          { content: { contains: 'This is a test message' } },
          { content: { contains: 'test message' } }
        ]
      }
    });
    console.log(`   ✅ Deleted ${deletedMessages.count} test messages`);
    
    // Clean up test orders and order items
    console.log('🗑️  Removing test orders...');
    const testUsers = await prisma.userProfile.findMany({
      where: {
        email: { contains: 'test' }
      }
    });
    
    const testUserIds = testUsers.map(u => u.id);
    
    // Delete order items first (due to foreign key constraints)
    const deletedOrderItems = await prisma.orderItem.deleteMany({
      where: {
        order: {
          userId: { in: testUserIds }
        }
      }
    });
    console.log(`   ✅ Deleted ${deletedOrderItems.count} test order items`);
    
    // Delete orders
    const deletedOrders = await prisma.order.deleteMany({
      where: {
        OR: [
          { userId: { in: testUserIds } },
          { orderNumber: { startsWith: 'TEST-' } }
        ]
      }
    });
    console.log(`   ✅ Deleted ${deletedOrders.count} test orders`);
    
    // Clean up test products
    console.log('🗑️  Removing test products...');
    const deletedProducts = await prisma.product.deleteMany({
      where: {
        OR: [
          { name: { startsWith: 'Test Product' } },
          { description: { contains: 'test product' } },
          { tags: { has: 'test' } }
        ]
      }
    });
    console.log(`   ✅ Deleted ${deletedProducts.count} test products`);
    
    // Clean up test points transactions
    console.log('🗑️  Removing test points transactions...');
    const deletedTransactions = await prisma.pointsTransaction.deleteMany({
      where: {
        OR: [
          { userId: { in: testUserIds } },
          { reason: { contains: 'test' } },
          { source: { contains: 'test' } }
        ]
      }
    });
    console.log(`   ✅ Deleted ${deletedTransactions.count} test transactions`);
    
    // Option to remove test users (commented out for safety)
    console.log('⚠️   Test users preserved (remove manually if needed):');
    testUsers.forEach(user => {
      console.log(`   - ${user.email} (${user.firstName} ${user.lastName})`);
    });
    
    // Verify critical routes/tables still exist and have proper data
    console.log('\n📊 Verifying database integrity...');
    
    const userCount = await prisma.userProfile.count();
    const productCount = await prisma.product.count();
    const orderCount = await prisma.order.count();
    
    console.log(`   - Users: ${userCount}`);
    console.log(`   - Products: ${productCount}`);
    console.log(`   - Orders: ${orderCount}`);
    
    // Check for any development/test flags still enabled
    console.log('\n🔍 Checking for development flags...');
    
    const devUsers = await prisma.userProfile.findMany({
      where: {
        OR: [
          { email: { contains: 'test' } },
          { email: { contains: 'dev' } },
          { email: { contains: 'localhost' } }
        ]
      },
      select: {
        email: true,
        role: true
      }
    });
    
    if (devUsers.length > 0) {
      console.log('   ⚠️  Found development/test users:');
      devUsers.forEach(user => {
        console.log(`     - ${user.email} (${user.role})`);
      });
    } else {
      console.log('   ✅ No development users found');
    }
    
    console.log('\n🎉 Test data cleanup completed!');
    console.log('💡 Ready for production deployment');
    
  } catch (error) {
    console.error('❌ Error cleaning test data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Helper function to remove test users (use with caution)
async function removeTestUsers() {
  console.log('🚨 REMOVING TEST USERS - This is irreversible!');
  
  const testUserEmails = [
    'test1@imaginethisprinted.com',
    'test2@imaginethisprinted.com'
  ];
  
  for (const email of testUserEmails) {
    try {
      const user = await prisma.userProfile.findUnique({
        where: { email }
      });
      
      if (user) {
        // Delete user wallet first
        await prisma.userWallet.delete({
          where: { userId: user.id }
        });
        
        // Delete user
        await prisma.userProfile.delete({
          where: { id: user.id }
        });
        
        console.log(`   ✅ Deleted test user: ${email}`);
      }
    } catch (error) {
      console.error(`   ❌ Error deleting ${email}:`, error.message);
    }
  }
}

// Run cleanup
if (process.argv.includes('--remove-users')) {
  removeTestUsers().then(() => cleanTestData());
} else {
  cleanTestData();
}