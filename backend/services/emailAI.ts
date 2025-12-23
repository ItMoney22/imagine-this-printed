import OpenAI from 'openai'
import { supabase } from '../lib/supabase.js'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

// Mr. Imagine's personality and voice
const MR_IMAGINE_PERSONA = `You are Mr. Imagine, the beloved mascot and creative spirit of Imagine This Printed - a custom printing company.

PERSONALITY:
- Warm, friendly, and genuinely excited about creativity
- Uses humor naturally (puns, playful observations) but never forced or cringey
- Professional when needed but always approachable
- Celebrates customers and their creative choices
- Speaks like a supportive creative friend, not a corporate bot

VOICE EXAMPLES:
- "Alright, creative soul! Your order is looking fantastic!"
- "Holy print rollers, your design is fire! 🔥"
- "Between you and me? This is going to look amazing."
- "Plot twist: your package is on an adventure to you!"

STYLE RULES:
- Use 1-2 emojis max per email (strategic, not spam)
- Keep sentences punchy and energetic
- Reference their specific items creatively when possible
- Sign off as "Mr. Imagine" with a warm closing
- Never use corporate buzzwords like "valued customer"
- Make them smile while keeping it professional`

interface EmailContext {
  templateKey: string
  customerName?: string
  customerEmail: string
  orderNumber?: string
  items?: Array<{ name: string; quantity: number; price: number }>
  total?: number
  trackingNumber?: string
  carrier?: string
  productName?: string
  productId?: string
  ticketId?: string
  ticketSubject?: string
  itcAmount?: number
  usdAmount?: number
  newBalance?: number
  username?: string
  shippingAddress?: {
    firstName?: string
    lastName?: string
    address?: string
    city?: string
    state?: string
    zipCode?: string
  }
  [key: string]: any
}

interface GeneratedEmail {
  subject: string
  htmlContent: string
  textContent: string
  aiGenerated: boolean
}

/**
 * Generate AI-personalized email content using GPT
 */
export async function generateAIEmail(context: EmailContext): Promise<GeneratedEmail> {
  // Get template from database
  const { data: template, error: templateError } = await supabase
    .from('email_templates')
    .select('*')
    .eq('template_key', context.templateKey)
    .eq('is_active', true)
    .single()

  if (templateError || !template) {
    console.log(`[EmailAI] Template not found for ${context.templateKey}, using fallback`)
    return generateFallbackEmail(context)
  }

  // If AI is disabled for this template, use fallback
  if (!template.ai_enabled) {
    return generateFallbackEmail(context)
  }

  try {
    // Build context for AI
    const contextDescription = buildContextDescription(context)

    const systemPrompt = `${MR_IMAGINE_PERSONA}

TEMPLATE CONTEXT:
${template.ai_prompt_context || 'Generate a friendly email.'}

AVAILABLE INFORMATION:
${contextDescription}

OUTPUT FORMAT:
You must respond with a JSON object containing:
{
  "subject": "The email subject line (catchy, personal, with 1 emoji max)",
  "greeting": "Personal greeting from Mr. Imagine",
  "mainContent": "The main body of the email (2-3 paragraphs, HTML formatting allowed)",
  "closing": "A warm sign-off"
}

HTML TIPS:
- Use <strong> for emphasis
- Use <br> for line breaks within paragraphs
- Keep formatting simple and email-safe`

    const userPrompt = `Generate a ${context.templateKey.replace(/_/g, ' ')} email for this customer.

Customer: ${context.customerName || 'Friend'}
Email: ${context.customerEmail}
${context.orderNumber ? `Order: ${context.orderNumber}` : ''}
${context.items ? `Items: ${context.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}` : ''}
${context.productName ? `Product: ${context.productName}` : ''}
${context.itcAmount ? `ITC Purchased: ${context.itcAmount}` : ''}

Make it personal, creative, and memorable. This should feel like it came from a friend, not a robot.`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8,
      max_tokens: 1000
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      throw new Error('No response from OpenAI')
    }

    const parsed = JSON.parse(content)

    // Build the final HTML email
    const htmlContent = buildMrImagineEmail({
      greeting: parsed.greeting || template.mr_imagine_greeting,
      mainContent: parsed.mainContent,
      closing: parsed.closing,
      orderNumber: context.orderNumber,
      items: context.items,
      total: context.total,
      trackingNumber: context.trackingNumber,
      carrier: context.carrier,
      ctaText: getCtaText(context.templateKey),
      ctaUrl: getCtaUrl(context.templateKey, context)
    })

    // Log the email
    await logEmail(context.templateKey, context.customerEmail, parsed.subject, true, context)

    return {
      subject: parsed.subject,
      htmlContent,
      textContent: stripHtml(htmlContent),
      aiGenerated: true
    }

  } catch (error) {
    console.error('[EmailAI] AI generation failed, using fallback:', error)
    return generateFallbackEmail(context)
  }
}

/**
 * Build context description for AI
 */
function buildContextDescription(context: EmailContext): string {
  const lines: string[] = []

  if (context.customerName) lines.push(`Customer Name: ${context.customerName}`)
  if (context.orderNumber) lines.push(`Order Number: ${context.orderNumber}`)
  if (context.items?.length) {
    lines.push(`Items Ordered:`)
    context.items.forEach(item => {
      lines.push(`  - ${item.quantity}x ${item.name} ($${item.price.toFixed(2)})`)
    })
  }
  if (context.total) lines.push(`Total: $${context.total.toFixed(2)}`)
  if (context.trackingNumber) lines.push(`Tracking: ${context.trackingNumber}`)
  if (context.carrier) lines.push(`Carrier: ${context.carrier}`)
  if (context.productName) lines.push(`Product Name: ${context.productName}`)
  if (context.itcAmount) lines.push(`ITC Amount: ${context.itcAmount}`)
  if (context.username) lines.push(`Username: ${context.username}`)

  return lines.join('\n')
}

/**
 * Build the Mr. Imagine branded email HTML
 */
function buildMrImagineEmail(options: {
  greeting: string
  mainContent: string
  closing: string
  orderNumber?: string
  items?: Array<{ name: string; quantity: number; price: number }>
  total?: number
  trackingNumber?: string
  carrier?: string
  ctaText?: string
  ctaUrl?: string
}): string {
  const itemsHtml = options.items ? `
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <thead>
        <tr style="background: #f9fafb;">
          <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">Item</th>
          <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151;">Qty</th>
          <th style="padding: 12px; text-align: right; font-weight: 600; color: #374151;">Price</th>
        </tr>
      </thead>
      <tbody>
        ${options.items.map(item => `
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${item.name}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${(item.price * item.quantity).toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
      ${options.total ? `
        <tfoot>
          <tr>
            <td colspan="2" style="padding: 12px; font-weight: bold; color: #374151;">Total</td>
            <td style="padding: 12px; text-align: right; font-weight: bold; color: #059669; font-size: 18px;">$${options.total.toFixed(2)}</td>
          </tr>
        </tfoot>
      ` : ''}
    </table>
  ` : ''

  const trackingHtml = options.trackingNumber ? `
    <div style="background: #f9fafb; border-radius: 8px; padding: 15px; margin: 20px 0;">
      <p style="color: #6b7280; margin: 0 0 5px 0;">Carrier: <strong>${options.carrier || 'Standard Shipping'}</strong></p>
      <p style="color: #6b7280; margin: 0;">Tracking Number: <strong>${options.trackingNumber}</strong></p>
    </div>
  ` : ''

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <!-- Header with Mr. Imagine -->
        <div style="background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); border-radius: 16px 16px 0 0; padding: 30px; text-align: center;">
          <img src="${FRONTEND_URL}/mr-imagine/mr-imagine-waist-up-happy.png" alt="Mr. Imagine" style="width: 120px; height: auto; margin: 0 auto 15px; display: block; filter: drop-shadow(0 4px 15px rgba(0,0,0,0.3));" />
          <h1 style="color: white; margin: 0; font-size: 24px; font-weight: bold;">Mr. Imagine</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0; font-size: 14px;">Your Creative Companion</p>
        </div>

        <!-- Main Content -->
        <div style="background: white; padding: 30px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
          <!-- Greeting -->
          <p style="color: #7c3aed; font-size: 18px; font-weight: 600; margin: 0 0 20px;">
            ${options.greeting}
          </p>

          <!-- Main Message -->
          <div style="color: #374151; font-size: 15px; line-height: 1.7;">
            ${options.mainContent}
          </div>

          ${options.orderNumber ? `
            <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 12px; padding: 20px; margin: 25px 0; text-align: center;">
              <p style="color: #6b7280; font-size: 12px; margin: 0 0 5px; text-transform: uppercase; letter-spacing: 1px;">Order Number</p>
              <p style="color: #7c3aed; font-size: 24px; font-weight: bold; margin: 0;">${options.orderNumber.slice(0, 8).toUpperCase()}</p>
            </div>
          ` : ''}

          ${itemsHtml}
          ${trackingHtml}

          ${options.ctaUrl ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${options.ctaUrl}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(124, 58, 237, 0.3);">
                ${options.ctaText || 'Continue'}
              </a>
            </div>
          ` : ''}

          <!-- Closing -->
          <div style="border-top: 1px solid #e5e7eb; padding-top: 25px; margin-top: 25px;">
            <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0;">
              ${options.closing}
            </p>
            <div style="display: flex; align-items: center; margin-top: 20px;">
              <img src="${FRONTEND_URL}/mr-imagine/mr-imagine-head-happy.png" alt="Mr. Imagine" style="width: 50px; height: 50px; border-radius: 50%; margin-right: 12px;" />
              <div>
                <p style="color: #7c3aed; font-weight: 600; margin: 0; font-size: 16px;">Mr. Imagine</p>
                <p style="color: #9ca3af; font-size: 12px; margin: 2px 0 0;">Your Creative Companion</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
          <p style="margin: 0 0 10px;">
            <a href="${FRONTEND_URL}" style="color: #7c3aed; text-decoration: none;">Imagine This Printed</a>
          </p>
          <p style="margin: 0;">
            Questions? Just reply to this email or chat with me on our website!
          </p>
        </div>
      </div>
    </body>
    </html>
  `
}

/**
 * Get CTA button text based on template
 */
function getCtaText(templateKey: string): string {
  const texts: Record<string, string> = {
    order_confirmation: 'Track My Order',
    welcome: 'Start Creating',
    order_shipped: 'Track Package',
    order_delivered: 'Shop More Designs',
    design_approved: 'View My Product',
    ticket_confirmation: 'Continue Shopping',
    itc_purchase: 'Use My ITC'
  }
  return texts[templateKey] || 'Continue'
}

/**
 * Get CTA URL based on template and context
 */
function getCtaUrl(templateKey: string, context: EmailContext): string {
  const urls: Record<string, string> = {
    order_confirmation: `${FRONTEND_URL}/orders`,
    welcome: `${FRONTEND_URL}/create-design`,
    order_shipped: `${FRONTEND_URL}/orders`,
    order_delivered: `${FRONTEND_URL}/catalog`,
    design_approved: context.productId ? `${FRONTEND_URL}/products/${context.productId}` : `${FRONTEND_URL}/my-products`,
    ticket_confirmation: FRONTEND_URL,
    itc_purchase: `${FRONTEND_URL}/wallet`
  }
  return urls[templateKey] || FRONTEND_URL
}

/**
 * Generate fallback email when AI is unavailable
 */
function generateFallbackEmail(context: EmailContext): GeneratedEmail {
  const fallbacks: Record<string, { subject: string; greeting: string; content: string }> = {
    order_confirmation: {
      subject: `🎉 Order Confirmed - ${context.orderNumber || 'Your Order'}`,
      greeting: 'Hey there, creative soul!',
      content: `<p>Great news! Your order has been confirmed and we're getting started on it right away.</p>
        <p>We can't wait to see your creation come to life!</p>`
    },
    welcome: {
      subject: `🎨 Welcome to Imagine This Printed, ${context.username || 'Friend'}!`,
      greeting: 'Welcome to the family!',
      content: `<p>We're so excited to have you join our creative community!</p>
        <p>Here's your welcome gift: Use code <strong>WELCOME10</strong> for 10% off your first order.</p>`
    },
    order_shipped: {
      subject: `📦 Your Order Has Shipped! - ${context.orderNumber || ''}`,
      greeting: 'Woohoo! Your creation is on its way!',
      content: `<p>Your order has left our workshop and is heading your way!</p>
        <p>We can't wait for you to see it in person.</p>`
    },
    order_delivered: {
      subject: `✅ Your Order Has Been Delivered!`,
      greeting: 'Your creation has landed!',
      content: `<p>Your order has been delivered! We hope you love it.</p>
        <p>Share a photo on social media and tag us @imaginethisprinted!</p>`
    },
    design_approved: {
      subject: `🎉 Your Design Has Been Approved!`,
      greeting: 'Congratulations, creative genius!',
      content: `<p>Your design "${context.productName || 'creation'}" has been approved and is now live!</p>
        <p>You'll earn 10% royalty on every sale. Time to celebrate!</p>`
    },
    ticket_confirmation: {
      subject: `✅ We Got Your Message - ${context.ticketSubject || 'Support Request'}`,
      greeting: 'We got your message!',
      content: `<p>Thanks for reaching out! Our team will review your request and get back to you within 24 hours.</p>
        <p>Your reference number is: <strong>${(context.ticketId || '').slice(0, 8).toUpperCase()}</strong></p>`
    },
    itc_purchase: {
      subject: `💰 ITC Purchase Confirmed - ${context.itcAmount} ITC Added!`,
      greeting: 'Your creative powers just leveled up!',
      content: `<p>You've added ${context.itcAmount} ITC to your wallet!</p>
        <p>Your new balance is ${context.newBalance} ITC. Time to create something amazing!</p>`
    }
  }

  const fallback = fallbacks[context.templateKey] || {
    subject: 'Message from Imagine This Printed',
    greeting: 'Hey there!',
    content: '<p>Thanks for being part of our creative community!</p>'
  }

  const htmlContent = buildMrImagineEmail({
    greeting: fallback.greeting,
    mainContent: fallback.content,
    closing: 'If you have any questions, just reply to this email!',
    orderNumber: context.orderNumber,
    items: context.items,
    total: context.total,
    trackingNumber: context.trackingNumber,
    carrier: context.carrier,
    ctaText: getCtaText(context.templateKey),
    ctaUrl: getCtaUrl(context.templateKey, context)
  })

  return {
    subject: fallback.subject,
    htmlContent,
    textContent: stripHtml(htmlContent),
    aiGenerated: false
  }
}

/**
 * Strip HTML tags for text version
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Log email to database
 */
async function logEmail(
  templateKey: string,
  recipientEmail: string,
  subject: string,
  aiUsed: boolean,
  context: EmailContext
): Promise<void> {
  try {
    await supabase.from('email_logs').insert({
      template_key: templateKey,
      recipient_email: recipientEmail,
      subject_sent: subject,
      ai_personalization_used: aiUsed,
      order_id: context.orderNumber ? undefined : undefined, // Could map order_number to id
      metadata: {
        items: context.items,
        total: context.total,
        product_name: context.productName
      }
    })
  } catch (error) {
    console.error('[EmailAI] Failed to log email:', error)
    // Don't throw - logging failure shouldn't break email sending
  }
}

/**
 * Preview an AI-generated email (for admin testing)
 */
export async function previewAIEmail(templateKey: string, sampleContext: Partial<EmailContext>): Promise<GeneratedEmail> {
  const context: EmailContext = {
    templateKey,
    customerEmail: 'preview@example.com',
    customerName: sampleContext.customerName || 'Creative Soul',
    orderNumber: sampleContext.orderNumber || 'ITP-PREVIEW-123',
    items: sampleContext.items || [
      { name: 'Harry Potter Vintage Tee - Medium', quantity: 1, price: 29.99 },
      { name: 'Custom Design Hoodie - Large', quantity: 1, price: 49.99 }
    ],
    total: sampleContext.total || 79.98,
    ...sampleContext
  }

  return generateAIEmail(context)
}
