import OpenAI from 'openai'
import { apiFetch } from '@/lib/api'

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
})

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

export interface EscalationRequest {
  userName?: string
  userEmail?: string
  originalQuestion: string
  conversationLog: ChatMessage[]
  timestamp: Date
}

const SYSTEM_PROMPT = `You are a friendly customer support assistant for ImagineThisPrinted, a 3D printing marketplace platform. Your personality is warm, helpful, and enthusiastic.

PLATFORM KNOWLEDGE:
- ImagineThisPrinted connects customers with 3D printing vendors
- Users can upload 3D models, browse products, and place orders
- Platform features: Product Designer, Model Gallery, Vendor Directory, Wholesale Portal
- Payment system uses ITC tokens/points and Stripe integration
- Users have roles: Customer, Vendor, Founder, Manager, Admin

VENDOR SYSTEM:
- Vendors create storefronts and manage products
- Vendor approval process required
- Earnings through Stripe payouts
- Wholesale pricing available for bulk orders

FOUNDER ROLES:
- Special user type with platform ownership benefits
- Access to founder earnings dashboard
- Can manage platform-wide settings

TOKENS & POINTS:
- ITC (ImagineThisPrinted Coin) digital currency
- Users earn points through referrals and activities
- Points can be converted to ITC tokens
- Current rate: $0.10 USD per ITC

KEY FEATURES TO HELP WITH:
- Account creation and management
- Product design tools and 3D model uploads
- Order placement and checkout process
- Vendor onboarding and storefront setup
- Payment issues and wallet management
- Platform navigation and feature explanations

TONE & BEHAVIOR:
- Start with friendly greetings like "Hey! Need help with anything?"
- Be conversational and enthusiastic
- Provide step-by-step guidance when needed
- If you're unsure or the question is complex, offer to escalate to human support

ESCALATION TRIGGERS:
- Payment disputes or billing issues
- Technical problems you can't solve
- Account suspension/security issues
- Custom orders or special requests
- When user specifically asks for human help
- Any situation requiring account access or changes

When escalating, say something like: "Let me connect you with our human support team who can better assist with this. They'll reach out to you shortly!"

Keep responses concise but helpful. Always maintain a positive, solution-focused attitude.`

export class ChatbotService {
  private conversationHistory: ChatMessage[] = []

  constructor() {
    this.addMessage({
      id: 'welcome',
      role: 'assistant',
      content: "Hey! 👋 Need help with anything? I'm here to assist with orders, design tools, vendor questions, or anything else about ImagineThisPrinted!",
      timestamp: new Date()
    })
  }

  addMessage(message: ChatMessage) {
    this.conversationHistory.push(message)
  }

  getConversationHistory(): ChatMessage[] {
    return this.conversationHistory
  }

  async sendMessage(userMessage: string, userName?: string): Promise<ChatMessage> {
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }

    this.addMessage(userMsg)

    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: SYSTEM_PROMPT }
      ]

      this.conversationHistory.forEach(msg => {
        if (msg.role !== 'system') {
          messages.push({
            role: msg.role as 'user' | 'assistant',
            content: msg.content
          })
        }
      })

      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages,
        max_tokens: 300,
        temperature: 0.7,
        presence_penalty: 0.1,
        frequency_penalty: 0.1
      })

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: completion.choices[0].message.content || 'Sorry, I had trouble generating a response. Please try again!',
        timestamp: new Date()
      }

      this.addMessage(assistantMessage)
      return assistantMessage

    } catch (error) {
      console.error('Chatbot error:', error)
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm having some technical difficulties right now. Let me connect you with our human support team who can help you out! 🔧",
        timestamp: new Date()
      }
      
      this.addMessage(errorMessage)
      
      await this.escalateToHuman({
        userName,
        originalQuestion: userMessage,
        conversationLog: this.conversationHistory,
        timestamp: new Date()
      })
      
      return errorMessage
    }
  }

  shouldEscalate(message: string): boolean {
    const escalationKeywords = [
      'human', 'person', 'agent', 'representative',
      'billing', 'payment issue', 'refund', 'charge',
      'account locked', 'suspended', 'ban',
      'technical problem', 'bug', 'error',
      'custom order', 'special request',
      'speak to someone', 'talk to human'
    ]

    return escalationKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    )
  }

  async escalateToHuman(request: EscalationRequest): Promise<boolean> {
    try {
      const emailBody = this.formatEscalationEmail(request)

      await apiFetch('/api/send-support-email', {
        method: 'POST',
        body: JSON.stringify({
          to: import.meta.env.SUPPORT_EMAIL || 'support@imaginethisprinted.com',
          subject: `Customer Support Request - ${request.userName || 'Guest User'}`,
          body: emailBody,
          customerInfo: {
            name: request.userName,
            email: request.userEmail
          }
        })
      })

      return true
    } catch (error) {
      console.error('Failed to escalate to human support:', error)
      return false
    }
  }

  private formatEscalationEmail(request: EscalationRequest): string {
    const { userName, userEmail, originalQuestion, conversationLog, timestamp } = request

    let email = `CUSTOMER SUPPORT REQUEST\n`
    email += `========================\n\n`
    email += `Customer: ${userName || 'Guest User'}\n`
    email += `Email: ${userEmail || 'Not provided'}\n`
    email += `Time: ${timestamp.toLocaleString()}\n\n`
    email += `ORIGINAL QUESTION:\n${originalQuestion}\n\n`
    email += `CONVERSATION LOG:\n`
    email += `==================\n`

    conversationLog.forEach(msg => {
      if (msg.role !== 'system') {
        email += `\n[${msg.role.toUpperCase()}] ${msg.timestamp.toLocaleTimeString()}\n`
        email += `${msg.content}\n`
      }
    })

    email += `\n\nPlease follow up with the customer as soon as possible.`
    
    return email
  }

  clearConversation(): void {
    this.conversationHistory = []
    this.addMessage({
      id: 'welcome-reset',
      role: 'assistant',
      content: "Hey! 👋 Need help with anything? I'm here to assist with orders, design tools, vendor questions, or anything else about ImagineThisPrinted!",
      timestamp: new Date()
    })
  }
}

export const chatbotService = new ChatbotService()