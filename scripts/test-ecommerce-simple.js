#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testEcommerceFlow() {
  console.log('🔄 Testing simplified e-commerce flow...');
  
  try {
    // Clean up existing test data
    const testUsers = await prisma.userProfile.findMany({
      where: {
        email: { in: ['test1@imaginethisprinted.com', 'test2@imaginethisprinted.com'] }
      }
    });
    
    const testUserIds = testUsers.map(u => u.id);
    
    await prisma.orderItem.deleteMany({
      where: {
        order: {
          userId: { in: testUserIds }
        }
      }
    });
    
    await prisma.order.deleteMany({
      where: {
        userId: { in: testUserIds }
      }
    });
    
    await prisma.product.deleteMany({
      where: {
        name: { startsWith: 'Test Product' }
      }
    });
    
    // Get test users
    const [vendor, customer] = await Promise.all([
      prisma.userProfile.findUnique({
        where: { email: 'test1@imaginethisprinted.com' }
      }),
      prisma.userProfile.findUnique({
        where: { email: 'test2@imaginethisprinted.com' },
        include: { wallet: true }
      })
    ]);
    
    if (!vendor || !customer) {
      console.error('❌ Test users not found');
      return;
    }
    
    console.log(`✅ Vendor: ${vendor.firstName} ${vendor.lastName}`);
    console.log(`✅ Customer: ${customer.firstName} ${customer.lastName} (Points: ${customer.wallet.pointsBalance})`);
    
    // Step 1: Create a test product
    console.log('\n📦 Step 1: Creating test product...');
    const product = await prisma.product.create({
      data: {
        name: 'Test Product - Custom Mug',
        description: 'A test product for e-commerce validation - custom printed mug',
        category: 'drinkware',
        subcategory: 'mugs',
        price: 19.99,
        costPrice: 8.50,
        vendorId: vendor.id,
        status: 'active',
        visibility: 'public',
        tags: ['test', 'drinkware', 'mug'],
        inStock: true,
        stockQuantity: 100,
        approved: true
      }
    });
    
    console.log(`✅ Created product: ${product.name} ($${product.price})`);
    
    // Step 2: Simulate adding to cart
    console.log('\n🛒 Step 2: Adding to cart (simulated)...');
    const cartItems = [
      {
        productId: product.id,
        quantity: 2,
        unitPrice: product.price,
        customization: 'Custom text: "World\'s Best Dad"'
      }
    ];
    
    const cartTotal = cartItems.reduce((sum, item) => sum + (item.quantity * Number(item.unitPrice)), 0);
    console.log(`   - Added ${cartItems[0].quantity}x ${product.name}`);
    console.log(`   - Customization: ${cartItems[0].customization}`);
    console.log(`   - Cart total: $${cartTotal.toFixed(2)}`);
    
    // Step 3: Create order
    console.log('\n💳 Step 3: Creating order...');
    const order = await prisma.order.create({
      data: {
        userId: customer.id,
        orderNumber: `TEST-${Date.now()}`,
        status: 'pending',
        total: cartTotal,
        subtotal: cartTotal,
        taxAmount: 0,
        shippingAmount: 0,
        currency: 'USD',
        paymentMethod: 'stripe',
        paymentStatus: 'pending',
        shippingAddress: {
          name: `${customer.firstName} ${customer.lastName}`,
          street: '123 Test Street',
          city: 'Test City',
          state: 'CA',
          zipCode: '12345',
          country: 'US'
        },
        billingAddress: {
          name: `${customer.firstName} ${customer.lastName}`,
          street: '123 Test Street',
          city: 'Test City', 
          state: 'CA',
          zipCode: '12345',
          country: 'US'
        }
      }
    });
    
    console.log(`✅ Order created: ${order.id}`);
    
    // Step 4: Add order items
    console.log('\n📋 Step 4: Adding order items...');
    for (const item of cartItems) {
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: item.productId,
          productName: product.name,
          vendorId: vendor.id,
          quantity: item.quantity,
          price: item.unitPrice,
          total: item.quantity * Number(item.unitPrice),
          personalization: { customization: item.customization }
        }
      });
    }
    
    console.log(`✅ Added ${cartItems.length} order items`);
    
    // Step 5: Process payment (mock)
    console.log('\n💰 Step 5: Processing payment...');
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'confirmed',
        paymentStatus: 'paid',
        paymentIntentId: `pi_test_${Date.now()}`
      }
    });
    
    // Update order items status
    await prisma.orderItem.updateMany({
      where: { orderId: order.id },
      data: { fulfillmentStatus: 'processing' }
    });
    
    console.log('✅ Payment processed successfully');
    
    // Step 6: Award loyalty points
    console.log('\n🎁 Step 6: Awarding loyalty points...');
    const pointsEarned = Math.floor(cartTotal); // 1 point per dollar
    
    await prisma.pointsTransaction.create({
      data: {
        userId: customer.id,
        type: 'earned',
        amount: pointsEarned,
        balanceAfter: customer.wallet.pointsBalance + pointsEarned,
        reason: 'Purchase reward points',
        source: 'purchase',
        referenceId: order.id
      }
    });
    
    await prisma.userWallet.update({
      where: { userId: customer.id },
      data: {
        pointsBalance: { increment: pointsEarned },
        lifetimePointsEarned: { increment: pointsEarned },
        lastPointsActivity: new Date()
      }
    });
    
    console.log(`✅ Awarded ${pointsEarned} points to customer`);
    
    // Step 7: Verify final state
    console.log('\n📊 Step 7: Verifying final state...');
    const finalOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        items: {
          include: {
            product: { select: { name: true, price: true } }
          }
        },
        user: {
          include: { wallet: true }
        }
      }
    });
    
    const pointsTransactions = await prisma.pointsTransaction.findMany({
      where: { referenceId: order.id }
    });
    
    console.log('\n🎉 E-commerce Flow Complete!');
    console.log('=====================================');
    console.log(`Order ID: ${finalOrder.id}`);
    console.log(`Status: ${finalOrder.status} | Payment: ${finalOrder.paymentStatus}`);
    console.log(`Total: $${finalOrder.total}`);
    console.log(`Items: ${finalOrder.items.length}`);
    finalOrder.items.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.product.name} (${item.quantity}x $${item.price})`);
    });
    console.log(`Customer Points: ${finalOrder.user.wallet.pointsBalance} (+${pointsEarned})`);
    console.log(`Transactions: ${pointsTransactions.length}`);
    console.log('Cart Status: ✅ Cleared (simulated)');
    
    // Test cart clearing simulation
    console.log('\n🧹 Cart cleared after successful purchase');
    
    console.log('\n✅ E-commerce flow test PASSED!');
    
  } catch (error) {
    console.error('❌ E-commerce flow test FAILED:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testEcommerceFlow().catch(console.error);