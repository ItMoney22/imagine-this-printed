import type { Message, Conversation, MessageAttachment, MessageNotification } from '../types'

export interface MessageData {
  content: string
  messageType: 'text' | 'image' | 'file' | 'product_inquiry' | 'order_update'
  attachments?: File[]
  metadata?: {
    productId?: string
    orderId?: string
    [key: string]: any
  }
}

export interface ConversationCreateData {
  participantId: string
  initialMessage?: MessageData
  context?: {
    type: 'product_inquiry' | 'order_support' | 'general'
    productId?: string
    orderId?: string
  }
}

export class MessagingService {
  // Create or get existing conversation
  async getOrCreateConversation(
    userId: string,
    participantId: string,
    context?: ConversationCreateData['context']
  ): Promise<Conversation> {
    try {
      // In real app, this would check PostgreSQL for existing conversation
      const conversationId = this.generateConversationId(userId, participantId)
      
      // Mock conversation data
      const conversation: Conversation = {
        id: conversationId,
        participants: [userId, participantId],
        participantDetails: await this.getParticipantDetails([userId, participantId]),
        unreadCount: 0,
        isArchived: false,
        tags: context ? [context.type] : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      return conversation
    } catch (error) {
      console.error('Error creating conversation:', error)
      throw new Error('Failed to create conversation')
    }
  }

  // Send a message
  async sendMessage(
    conversationId: string,
    senderId: string,
    messageData: MessageData
  ): Promise<Message> {
    try {
      // Upload attachments if any
      const attachments = messageData.attachments 
        ? await this.uploadAttachments(messageData.attachments)
        : undefined

      const message: Message = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        conversationId,
        senderId,
        recipientId: await this.getOtherParticipant(conversationId, senderId),
        content: messageData.content,
        messageType: messageData.messageType,
        attachments,
        metadata: messageData.metadata,
        isRead: false,
        createdAt: new Date().toISOString()
      }

      // In real app, this would save to PostgreSQL with Prisma
      await this.saveMessage(message)

      // Update conversation
      await this.updateConversationLastMessage(conversationId, message)

      // Send notification to recipient
      await this.sendNotification(message)

      return message
    } catch (error) {
      console.error('Error sending message:', error)
      throw new Error('Failed to send message')
    }
  }

  // Get messages for a conversation
  async getMessages(
    conversationId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Message[]> {
    try {
      // In real app, this would query PostgreSQL with Prisma
      // Mock messages for demo
      const mockMessages: Message[] = [
        {
          id: 'msg_1',
          conversationId,
          senderId: 'customer_1',
          recipientId: 'vendor_1',
          content: 'Hi! I\'m interested in your custom t-shirt design services. Can you help me create a logo design for my business?',
          messageType: 'text',
          isRead: true,
          createdAt: '2025-01-12T10:00:00Z'
        },
        {
          id: 'msg_2',
          conversationId,
          senderId: 'vendor_1',
          recipientId: 'customer_1',
          content: 'Hello! Absolutely, I\'d be happy to help you create a custom logo design. Could you tell me more about your business and what style you\'re looking for?',
          messageType: 'text',
          isRead: true,
          createdAt: '2025-01-12T10:05:00Z'
        },
        {
          id: 'msg_3',
          conversationId,
          senderId: 'customer_1',
          recipientId: 'vendor_1',
          content: 'I run a coffee shop called "Bean There, Done That" and I\'m looking for a modern, minimalist logo that would work well on t-shirts and merchandise.',
          messageType: 'text',
          isRead: false,
          createdAt: '2025-01-12T10:15:00Z'
        }
      ]

      return mockMessages.slice(offset, offset + limit)
    } catch (error) {
      console.error('Error fetching messages:', error)
      throw new Error('Failed to fetch messages')
    }
  }

  // Get conversations for a user
  async getConversations(
    _userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<Conversation[]> {
    try {
      // In real app, this would query PostgreSQL with Prisma
      // Mock conversations for demo
      const mockConversations: Conversation[] = [
        {
          id: 'conv_1',
          participants: ['customer_1', 'vendor_1'],
          participantDetails: [
            {
              userId: 'customer_1',
              name: 'John Doe',
              email: 'john@example.com',
              role: 'customer',
              profileImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face'
            },
            {
              userId: 'vendor_1',
              name: 'Custom Designs Co',
              email: 'info@customdesigns.com',
              role: 'vendor',
              profileImage: 'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=100&h=100&fit=crop'
            }
          ],
          lastMessage: {
            id: 'msg_3',
            conversationId: 'conv_1',
            senderId: 'customer_1',
            recipientId: 'vendor_1',
            content: 'I run a coffee shop called "Bean There, Done That" and I\'m looking for a modern, minimalist logo that would work well on t-shirts and merchandise.',
            messageType: 'text',
            isRead: false,
            createdAt: '2025-01-12T10:15:00Z'
          },
          unreadCount: 1,
          isArchived: false,
          tags: ['product_inquiry'],
          createdAt: '2025-01-12T10:00:00Z',
          updatedAt: '2025-01-12T10:15:00Z'
        }
      ]

      return mockConversations.slice(offset, offset + limit)
    } catch (error) {
      console.error('Error fetching conversations:', error)
      throw new Error('Failed to fetch conversations')
    }
  }

  // Mark messages as read
  async markAsRead(conversationId: string, _userId: string): Promise<void> {
    try {
      // In real app, this would update PostgreSQL with Prisma
      console.log(`Marking messages as read for conversation ${conversationId}`)
    } catch (error) {
      console.error('Error marking messages as read:', error)
      throw new Error('Failed to mark messages as read')
    }
  }

  // Archive conversation
  async archiveConversation(conversationId: string, _userId: string): Promise<void> {
    try {
      // In real app, this would update PostgreSQL with Prisma
      console.log(`Archiving conversation ${conversationId}`)
    } catch (error) {
      console.error('Error archiving conversation:', error)
      throw new Error('Failed to archive conversation')
    }
  }

  // Get unread message count
  async getUnreadCount(_userId: string): Promise<number> {
    try {
      // In real app, this would query PostgreSQL with Prisma
      return 3 // Mock unread count
    } catch (error) {
      console.error('Error getting unread count:', error)
      return 0
    }
  }

  // Search messages
  async searchMessages(
    _userId: string,
    query: string,
    limit: number = 20
  ): Promise<Message[]> {
    try {
      // In real app, this would use full-text search in PostgreSQL
      const conversations = await this.getConversations('demo-user')
      const allMessages: Message[] = []
      
      for (const conversation of conversations) {
        const messages = await this.getMessages(conversation.id)
        allMessages.push(...messages)
      }

      return allMessages
        .filter(message => 
          message.content.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, limit)
    } catch (error) {
      console.error('Error searching messages:', error)
      throw new Error('Failed to search messages')
    }
  }

  // Private helper methods
  private generateConversationId(userId1: string, userId2: string): string {
    // Create deterministic conversation ID based on participant IDs
    const sortedIds = [userId1, userId2].sort()
    return `conv_${sortedIds[0]}_${sortedIds[1]}`
  }

  private async getParticipantDetails(userIds: string[]): Promise<Conversation['participantDetails']> {
    // In real app, this would fetch from user table
    return [
      {
        userId: userIds[0],
        name: 'John Doe',
        email: 'john@example.com',
        role: 'customer',
        profileImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face'
      },
      {
        userId: userIds[1],
        name: 'Custom Designs Co',
        email: 'info@customdesigns.com',
        role: 'vendor',
        profileImage: 'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=100&h=100&fit=crop'
      }
    ]
  }

  private async uploadAttachments(files: File[]): Promise<MessageAttachment[]> {
    // In real app, this would upload to PostgreSQL with Prisma
    return files.map((file, index) => ({
      id: `att_${Date.now()}_${index}`,
      type: file.type.startsWith('image/') ? 'image' : 'file',
      name: file.name,
      url: URL.createObjectURL(file), // Mock URL
      size: file.size,
      mimeType: file.type
    }))
  }

  private async saveMessage(message: Message): Promise<void> {
    // In real app, this would save to PostgreSQL messages table
    console.log('Saving message:', message)
  }

  private async updateConversationLastMessage(
    conversationId: string,
    message: Message
  ): Promise<void> {
    // In real app, this would update the conversation's last_message
    console.log('Updating conversation last message:', conversationId, message.id)
  }

  private async getOtherParticipant(
    _conversationId: string,
    currentUserId: string
  ): Promise<string> {
    // In real app, this would query the conversation participants
    return currentUserId === 'customer_1' ? 'vendor_1' : 'customer_1'
  }

  private async sendNotification(message: Message): Promise<void> {
    try {
      const notification: MessageNotification = {
        id: `notif_${Date.now()}`,
        userId: message.recipientId,
        messageId: message.id,
        conversationId: message.conversationId,
        type: 'new_message',
        isRead: false,
        createdAt: new Date().toISOString()
      }

      // In real app, this would save to notifications table and/or send push notification
      console.log('Sending notification:', notification)
    } catch (error) {
      console.error('Error sending notification:', error)
    }
  }

  // Quick message templates for common scenarios
  getQuickReplyTemplates(context: 'product_inquiry' | 'order_support' | 'general'): string[] {
    const templates = {
      product_inquiry: [
        "Thank you for your interest! I'd be happy to help you with a custom design.",
        "Could you provide more details about what you're looking for?",
        "I can definitely help with that. What's your timeline and budget?",
        "Let me send you some examples of similar work I've done."
      ],
      order_support: [
        "I'm looking into your order status and will update you shortly.",
        "Your order is currently being processed and should ship within 2-3 business days.",
        "I apologize for any inconvenience. Let me resolve this for you right away.",
        "Thank you for bringing this to my attention. I'm investigating now."
      ],
      general: [
        "Thanks for reaching out!",
        "I'll get back to you with more information soon.",
        "Let me check on that for you.",
        "Is there anything else I can help you with?"
      ]
    }

    return templates[context] || templates.general
  }
}

export const messagingService = new MessagingService()