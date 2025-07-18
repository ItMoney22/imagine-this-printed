#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testMessaging() {
  console.log('🔄 Testing messaging system...');
  
  try {
    // Get our test users
    const users = await prisma.userProfile.findMany({
      where: {
        email: {
          in: ['test1@imaginethisprinted.com', 'test2@imaginethisprinted.com']
        }
      }
    });
    
    if (users.length < 2) {
      console.error('❌ Need at least 2 test users');
      return;
    }
    
    const [user1, user2] = users;
    const conversationId = `conv_${user1.id}_${user2.id}`;
    
    console.log(`✅ Found test users: ${user1.firstName} and ${user2.firstName}`);
    
    // Clean up existing messages
    await prisma.message.deleteMany({
      where: {
        conversationId: conversationId
      }
    });
    
    // Create test messages
    const messages = [
      {
        conversationId,
        senderId: user1.id,
        recipientId: user2.id,
        subject: 'Test Message 1',
        content: 'Hello! This is a test message from user 1.',
        messageType: 'text'
      },
      {
        conversationId,
        senderId: user2.id,
        recipientId: user1.id,
        subject: 'Re: Test Message 1',
        content: 'Hi there! This is a reply from user 2.',
        messageType: 'text'
      },
      {
        conversationId,
        senderId: user1.id,
        recipientId: user2.id,
        subject: 'Image Test',
        content: 'Here is an image attachment test.',
        messageType: 'image',
        attachments: [{ type: 'image', url: 'https://example.com/test.jpg' }]
      }
    ];
    
    // Insert messages
    for (const message of messages) {
      const created = await prisma.message.create({
        data: message,
        include: {
          sender: { select: { firstName: true, lastName: true } },
          recipient: { select: { firstName: true, lastName: true } }
        }
      });
      
      console.log(`✅ Created message: "${created.subject}" from ${created.sender?.firstName} to ${created.recipient?.firstName}`);
    }
    
    // Test message retrieval
    const conversation = await prisma.message.findMany({
      where: {
        conversationId: conversationId
      },
      include: {
        sender: { select: { firstName: true, lastName: true, email: true } },
        recipient: { select: { firstName: true, lastName: true, email: true } }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });
    
    console.log(`\n📋 Conversation between ${user1.firstName} and ${user2.firstName}:`);
    conversation.forEach((msg, index) => {
      console.log(`${index + 1}. [${msg.sender?.firstName}]: ${msg.content}`);
      console.log(`   Type: ${msg.messageType}, Read: ${msg.isRead}`);
    });
    
    // Test message persistence (simulate app refresh)
    console.log('\n🔄 Testing message persistence after refresh...');
    
    const persistedMessages = await prisma.message.count({
      where: {
        conversationId: conversationId
      }
    });
    
    if (persistedMessages === messages.length) {
      console.log('✅ All messages persisted correctly after refresh');
    } else {
      console.error(`❌ Message persistence failed: expected ${messages.length}, found ${persistedMessages}`);
    }
    
    // Test marking messages as read
    await prisma.message.updateMany({
      where: {
        conversationId: conversationId,
        recipientId: user1.id
      },
      data: {
        isRead: true,
        readAt: new Date()
      }
    });
    
    const readMessages = await prisma.message.findMany({
      where: {
        conversationId: conversationId,
        isRead: true
      }
    });
    
    console.log(`✅ Marked ${readMessages.length} messages as read`);
    
    console.log('🎉 Messaging system test completed successfully!');
    
  } catch (error) {
    console.error('❌ Messaging test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testMessaging().catch(console.error);