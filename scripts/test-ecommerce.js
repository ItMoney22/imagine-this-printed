#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createTestProduct() {
  console.log('🔄 Creating test product...');
  
  try {
    // Clean up existing test products
    await prisma.product.deleteMany({
      where: {
        name: {
          startsWith: 'Test Product'
        }
      }
    });
    
    const testUser = await prisma.userProfile.findUnique({
      where: { email: 'test1@imaginethisprinted.com' }
    });
    
    if (!testUser) {
      console.error('❌ Test user not found');
      return null;
    }
    
    const product = await prisma.product.create({
      data: {
        name: 'Test Product - Custom T-Shirt',
        description: 'A test product for QA validation',
        category: 'clothing',
        subcategory: 't-shirts',
        price: 25.99,
        costPrice: 12.50,
        vendorId: testUser.id,
        status: 'active',
        visibility: 'public',
        tags: ['test', 'clothing', 't-shirt'],
        specifications: {
          material: '100% Cotton',
          sizes: ['S', 'M', 'L', 'XL'],
          colors: ['Black', 'White', 'Blue']
        },
        metaTitle: 'Test Custom T-Shirt',
        metaDescription: 'Test product for e-commerce validation',
        variations: {
          create: [
            {
              name: 'Size',
              type: 'select',
              required: true,
              sortOrder: 1,
              options: {
                create: [
                  { value: 'S', label: 'Small', priceModifier: 0, sortOrder: 1 },
                  { value: 'M', label: 'Medium', priceModifier: 0, sortOrder: 2 },
                  { value: 'L', label: 'Large', priceModifier: 0, sortOrder: 3 },
                  { value: 'XL', label: 'Extra Large', priceModifier: 2.00, sortOrder: 4 }
                ]
              }
            },
            {
              name: 'Color',
              type: 'select',
              required: true,
              sortOrder: 2,
              options: {
                create: [
                  { value: 'black', label: 'Black', priceModifier: 0, sortOrder: 1 },
                  { value: 'white', label: 'White', priceModifier: 0, sortOrder: 2 },
                  { value: 'blue', label: 'Blue', priceModifier: 1.50, sortOrder: 3 }
                ]
              }
            }
          ]
        }
      },
      include: {
        variations: {
          include: {
            options: true
          }
        }
      }
    });
    
    console.log(`✅ Created test product: ${product.name} (ID: ${product.id})`);
    return product;
    
  } catch (error) {
    console.error('❌ Error creating test product:', error);
    return null;
  }
}

async function testPurchaseFlow() {
  console.log('🔄 Testing purchase flow...');
  
  try {
    const product = await createTestProduct();
    if (!product) return;
    
    const customer = await prisma.userProfile.findUnique({
      where: { email: 'test2@imaginethisprinted.com' },
      include: { wallet: true }
    });
    
    if (!customer) {
      console.error('❌ Customer not found');
      return;
    }
    
    console.log(`✅ Customer: ${customer.firstName} (Points: ${customer.wallet.pointsBalance})`);
    
    // Step 1: Add to cart (simulate)
    console.log('🛒 Step 1: Adding item to cart...');
    const cartItem = {
      productId: product.id,
      quantity: 2,
      selectedOptions: {
        size: 'L',
        color: 'blue'
      },
      unitPrice: product.price + 1.50, // Blue color modifier
      totalPrice: (product.price + 1.50) * 2
    };
    
    console.log(`   - Product: ${product.name}`);
    console.log(`   - Quantity: ${cartItem.quantity}`);
    console.log(`   - Options: Size ${cartItem.selectedOptions.size}, Color ${cartItem.selectedOptions.color}`);
    console.log(`   - Unit Price: $${cartItem.unitPrice}`);
    console.log(`   - Total: $${cartItem.totalPrice}`);
    
    // Step 2: Create order
    console.log('💳 Step 2: Creating order...');
    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        status: 'pending',
        totalAmount: cartItem.totalPrice,
        subtotal: cartItem.totalPrice,
        taxAmount: 0,
        shippingAmount: 0,
        currency: 'USD',
        paymentMethod: 'stripe',
        paymentStatus: 'pending',
        shippingAddress: {
          street: '123 Test St',
          city: 'Test City',
          state: 'CA',
          zipCode: '12345',
          country: 'US'
        },
        billingAddress: {
          street: '123 Test St',
          city: 'Test City',
          state: 'CA',
          zipCode: '12345',
          country: 'US'
        },
        items: {
          create: [
            {
              productId: product.id,
              vendorId: product.vendorId,
              quantity: cartItem.quantity,
              unitPrice: cartItem.unitPrice,
              totalPrice: cartItem.totalPrice,
              selectedOptions: cartItem.selectedOptions,
              status: 'pending'
            }
          ]
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });
    
    console.log(`✅ Order created: ${order.id}`);
    console.log(`   - Status: ${order.status}`);
    console.log(`   - Total: $${order.totalAmount}`);
    console.log(`   - Items: ${order.items.length}`);
    
    // Step 3: Process payment (mock)
    console.log('💰 Step 3: Processing payment...');
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'paid',
        paymentStatus: 'completed',
        paidAt: new Date(),
        stripePaymentIntentId: 'pi_test_12345'
      }
    });
    
    // Step 4: Update order items
    await prisma.orderItem.updateMany({
      where: { orderId: order.id },
      data: {
        status: 'processing'
      }
    });
    
    console.log('✅ Payment processed successfully');
    
    // Step 5: Award points
    console.log('🎁 Step 4: Awarding loyalty points...');
    const pointsEarned = Math.floor(cartItem.totalPrice); // 1 point per dollar
    
    await prisma.pointsTransaction.create({
      data: {
        userId: customer.id,
        type: 'earned',
        amount: pointsEarned,
        balanceAfter: customer.wallet.pointsBalance + pointsEarned,
        reason: 'Purchase reward',
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
    
    // Verify final state
    const finalOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        items: true,
        customer: {
          include: { wallet: true }
        }
      }
    });
    
    const transactions = await prisma.pointsTransaction.findMany({
      where: { referenceId: order.id }
    });
    
    console.log('\n📊 Final Order State:');
    console.log(`   - Order ID: ${finalOrder.id}`);
    console.log(`   - Status: ${finalOrder.status}`);
    console.log(`   - Payment Status: ${finalOrder.paymentStatus}`);
    console.log(`   - Customer Points: ${finalOrder.customer.wallet.pointsBalance}`);
    console.log(`   - Transactions: ${transactions.length}`);
    
    // Test cart clearing (would happen in frontend)
    console.log('🧹 Step 5: Cart cleared (simulated)');
    
    console.log('🎉 E-commerce flow test completed successfully!');
    
    return order;
    
  } catch (error) {
    console.error('❌ Purchase flow test failed:', error);
  }
}

// Run the test
async function main() {
  await testPurchaseFlow();
  await prisma.$disconnect();
}

main().catch(console.error);