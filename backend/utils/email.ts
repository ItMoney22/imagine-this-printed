interface BrevoEmailOptions {
  to: string
  subject: string
  htmlContent: string
  textContent?: string
}

interface SendEmailResult {
  success: boolean
  messageId?: string
}

const BREVO_API_KEY = process.env.BREVO_API_KEY
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'wecare@imaginethisprinted.com'
// Mr. Imagine is the sender for all customer-facing emails
const BREVO_SENDER_NAME = 'Mr. Imagine from Imagine This Printed'
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

// Flag to enable/disable AI personalization (can be toggled via env)
const AI_EMAIL_ENABLED = process.env.AI_EMAIL_ENABLED !== 'false'

/**
 * Send email via Brevo API
 * Returns success boolean for backward compatibility
 * Use sendEmailWithTracking for full response including messageId
 */
export const sendEmail = async (options: BrevoEmailOptions): Promise<boolean> => {
  const result = await sendEmailWithTracking(options)
  return result.success
}

/**
 * Send email via Brevo API with full tracking response
 * Returns messageId for webhook tracking
 */
export const sendEmailWithTracking = async (options: BrevoEmailOptions): Promise<SendEmailResult> => {
  if (!BREVO_API_KEY) {
    console.error('[Email] BREVO_API_KEY is not set')
    // Log the email instead for development
    console.log('[Email] Would send to:', options.to)
    console.log('[Email] Subject:', options.subject)
    return { success: true }
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: BREVO_SENDER_NAME,
          email: BREVO_SENDER_EMAIL
        },
        to: [
          {
            email: options.to,
            name: options.to
          }
        ],
        subject: options.subject,
        htmlContent: options.htmlContent,
        textContent: options.textContent || options.htmlContent.replace(/<[^>]*>/g, '')
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('[Email] Brevo API error:', errorData)
      return { success: false }
    }

    const data = await response.json() as { messageId?: string }
    const messageId = data.messageId

    console.log('[Email] ✅ Email sent successfully to:', options.to, 'messageId:', messageId)
    return { success: true, messageId }
  } catch (error) {
    console.error('[Email] ❌ Email sending failed:', error)
    return { success: false }
  }
}

/**
 * Send approval notification email to product creator
 */
export const sendProductApprovalEmail = async (
  email: string,
  productName: string,
  productId: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `🎉 Your Design "${productName}" Has Been Approved!`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">Congratulations! 🎨</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px;">
          <h2 style="color: #374151; margin-top: 0;">Your design has been approved!</h2>
          <p style="color: #6b7280; font-size: 16px; line-height: 1.6;">
            Great news! Your product <strong>"${productName}"</strong> has been reviewed and approved by our team.
            It's now live on the marketplace and ready to earn you royalties!
          </p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">💰 Start Earning 10% on Every Sale!</h3>
          <p style="color: #6b7280; font-size: 15px; line-height: 1.6;">
            To receive your royalty payments, you'll need to set up your wallet:
          </p>
          <ol style="color: #6b7280; font-size: 15px; line-height: 1.8;">
            <li>Go to your <a href="${FRONTEND_URL}/wallet" style="color: #7c3aed; text-decoration: underline;">Wallet Settings</a></li>
            <li>Add your payment details (PayPal or bank account)</li>
            <li>Verify your identity</li>
            <li>Watch your earnings grow!</li>
          </ol>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/products/${productId}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            View Your Product
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Share your creation with friends and family to maximize your earnings!<br>
            Every sale earns you 10% royalty automatically.
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send rejection notification email to product creator
 */
export const sendProductRejectionEmail = async (
  email: string,
  productName: string,
  reason: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `Update on Your Design "${productName}"`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #374151; margin: 0;">Design Update</h1>
        </div>

        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h2 style="color: #991b1b; margin-top: 0;">We couldn't approve your design</h2>
          <p style="color: #6b7280; font-size: 16px; line-height: 1.6;">
            Thank you for submitting <strong>"${productName}"</strong>. Unfortunately, we weren't able to approve it at this time.
          </p>

          <div style="background: #fff; border-radius: 8px; padding: 15px; margin-top: 15px;">
            <p style="color: #374151; font-weight: 600; margin: 0 0 5px 0;">Reason:</p>
            <p style="color: #6b7280; margin: 0;">${reason}</p>
          </div>
        </div>

        <div style="background: #f9fafb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">What can you do?</h3>
          <ul style="color: #6b7280; font-size: 15px; line-height: 1.8;">
            <li>Review the feedback above</li>
            <li>Make adjustments to your design</li>
            <li>Submit a new design when ready</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/create" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Create a New Design
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Questions? Reply to this email and we'll be happy to help!
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send notification email to support team when a new ticket is created
 */
export const sendNewSupportTicketEmail = async (
  ticketId: string,
  subject: string,
  description: string,
  priority: string,
  category: string,
  userEmail?: string
): Promise<boolean> => {
  const supportEmail = process.env.SUPPORT_EMAIL || 'wecare@imaginethisprinted.com'

  const priorityColors: Record<string, string> = {
    urgent: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#22c55e'
  }

  return sendEmail({
    to: supportEmail,
    subject: `🎫 New Support Ticket [${priority.toUpperCase()}]: ${subject}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">New Support Ticket 🎫</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
            <span style="font-size: 14px; color: #6b7280;">Ticket ID: <strong>${ticketId.slice(0, 8)}</strong></span>
            <span style="background: ${priorityColors[priority] || '#6b7280'}; color: white; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: bold; text-transform: uppercase;">${priority}</span>
          </div>
          <h2 style="color: #374151; margin: 0 0 10px 0;">${subject}</h2>
          <p style="color: #6b7280; font-size: 14px; margin: 0;">Category: ${category.replace('_', ' ')}</p>
          ${userEmail ? `<p style="color: #6b7280; font-size: 14px; margin: 5px 0 0 0;">From: ${userEmail}</p>` : ''}
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">Description</h3>
          <p style="color: #6b7280; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${description}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/admin/dashboard?tab=support" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            View in Admin Dashboard
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            This ticket was created via Mr. Imagine chat assistant.<br>
            Please respond promptly to maintain customer satisfaction.
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send confirmation email to user when their ticket is created
 */
export const sendTicketConfirmationEmail = async (
  email: string,
  ticketId: string,
  subject: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `✅ Your Support Request Has Been Received - ${subject}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">We Got Your Request! ✅</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">Reference Number</p>
          <p style="color: #7c3aed; font-size: 24px; font-weight: bold; margin: 0;">${ticketId.slice(0, 8).toUpperCase()}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">What happens next?</h3>
          <ul style="color: #6b7280; font-size: 15px; line-height: 1.8;">
            <li>Our support team will review your request</li>
            <li>You'll receive a response within 24 hours</li>
            <li>We'll email you with updates</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Continue Shopping
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Thank you for reaching out to us!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send notification to customer when an agent replies to their ticket
 */
export const sendTicketReplyEmail = async (
  email: string,
  ticketId: string,
  subject: string,
  agentMessage: string,
  agentName?: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `📬 New Reply on Your Support Request - ${subject}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">New Reply From Support 📬</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 20px; margin-bottom: 20px;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 5px 0;">Reference Number</p>
          <p style="color: #7c3aed; font-size: 18px; font-weight: bold; margin: 0;">${ticketId.slice(0, 8).toUpperCase()}</p>
          <p style="color: #374151; font-size: 16px; margin: 10px 0 0 0;">${subject}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; margin-bottom: 15px;">
            <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px;">
              <span style="color: white; font-weight: bold;">${(agentName || 'Support')[0].toUpperCase()}</span>
            </div>
            <div>
              <p style="margin: 0; color: #374151; font-weight: 600;">${agentName || 'Support Team'}</p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">Support Agent</p>
            </div>
          </div>
          <p style="color: #6b7280; font-size: 15px; line-height: 1.6; white-space: pre-wrap; margin: 0;">${agentMessage}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Reply to Support
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            You can reply directly to this email or use the chat widget on our website.<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send escalation notification to support team when a customer needs immediate help
 */
export const sendTicketEscalationEmail = async (
  ticketId: string,
  subject: string,
  customerEmail: string,
  waitTime?: string
): Promise<boolean> => {
  const supportEmail = process.env.SUPPORT_EMAIL || 'wecare@imaginethisprinted.com'

  return sendEmail({
    to: supportEmail,
    subject: `🚨 [URGENT] Customer Waiting for Live Chat - ${subject}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ef4444; margin: 0;">🚨 Urgent: Agent Needed!</h1>
        </div>

        <div style="background: #fef2f2; border: 2px solid #fecaca; border-radius: 16px; padding: 30px; margin-bottom: 20px;">
          <p style="color: #991b1b; font-size: 18px; font-weight: bold; margin: 0 0 15px 0;">
            A customer is waiting for live chat support
          </p>
          <div style="background: #fff; border-radius: 8px; padding: 15px;">
            <p style="color: #6b7280; margin: 0 0 8px 0;"><strong>Ticket:</strong> ${ticketId.slice(0, 8).toUpperCase()}</p>
            <p style="color: #6b7280; margin: 0 0 8px 0;"><strong>Subject:</strong> ${subject}</p>
            <p style="color: #6b7280; margin: 0 0 8px 0;"><strong>Customer:</strong> ${customerEmail}</p>
            ${waitTime ? `<p style="color: #ef4444; margin: 0; font-weight: bold;"><strong>Wait Time:</strong> ${waitTime}</p>` : ''}
          </div>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/admin/dashboard?tab=support" style="display: inline-block; background: #ef4444; color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Go Online & Help Customer
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Please respond as soon as possible to maintain customer satisfaction.
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send notification to support team when a ticket is resolved
 */
export const sendTicketResolvedEmail = async (
  email: string,
  ticketId: string,
  subject: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `✅ Your Support Request Has Been Resolved - ${subject}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #059669; margin: 0;">Issue Resolved! ✅</h1>
        </div>

        <div style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #065f46; font-size: 14px; margin: 0 0 10px 0;">Reference Number</p>
          <p style="color: #047857; font-size: 24px; font-weight: bold; margin: 0;">${ticketId.slice(0, 8).toUpperCase()}</p>
          <p style="color: #065f46; font-size: 16px; margin: 10px 0 0 0;">${subject}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">Your ticket has been closed</h3>
          <p style="color: #6b7280; font-size: 15px; line-height: 1.6;">
            We're glad we could help! If you have any more questions or if the issue persists,
            feel free to reach out to us again through the chat widget on our website.
          </p>
        </div>

        <div style="background: #f9fafb; border-radius: 16px; padding: 20px; margin-bottom: 20px; text-align: center;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">How was your experience?</p>
          <div style="display: flex; justify-content: center; gap: 10px;">
            <span style="font-size: 24px; cursor: pointer;">😊</span>
            <span style="font-size: 24px; cursor: pointer;">😐</span>
            <span style="font-size: 24px; cursor: pointer;">😔</span>
          </div>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Continue Shopping
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Thank you for choosing Imagine This Printed!<br>
            We're always here to help.
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send payout notification email to creator
 */
export const sendPayoutEmail = async (
  email: string,
  amount: number,
  method: string
): Promise<boolean> => {
  const formattedAmount = (amount / 100).toFixed(2)

  return sendEmail({
    to: email,
    subject: `💸 Your $${formattedAmount} Payout is on the Way!`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #059669; margin: 0;">Payment Sent! 💸</h1>
        </div>

        <div style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #065f46; font-size: 14px; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 1px;">Payout Amount</p>
          <p style="color: #047857; font-size: 48px; font-weight: bold; margin: 0;">$${formattedAmount}</p>
          <p style="color: #065f46; font-size: 14px; margin: 10px 0 0 0;">via ${method}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">What to expect</h3>
          <ul style="color: #6b7280; font-size: 15px; line-height: 1.8;">
            <li>Funds typically arrive within 1-3 business days</li>
            <li>Check your ${method} account for the deposit</li>
            <li>Keep creating to earn more royalties!</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/my-products" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            View My Products
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Thank you for being a creator at Imagine This Printed!<br>
            Your creativity is what makes our marketplace special.
          </p>
        </div>
      </div>
    `
  })
}

// ===============================
// ORDER STATUS EMAILS (AI-Powered with Mr. Imagine personality)
// ===============================

interface OrderItem {
  name: string
  quantity: number
  price: number
}

// Try to import AI email service (may fail if not available)
let generateAIEmail: any = null
try {
  // Dynamic import to avoid breaking if AI service has issues
  import('../services/emailAI.js').then(module => {
    generateAIEmail = module.generateAIEmail
    console.log('[Email] AI email service loaded successfully')
  }).catch(err => {
    console.log('[Email] AI email service not available, using fallback templates')
  })
} catch {
  console.log('[Email] AI email service not available')
}

/**
 * Send order confirmation email to customer
 * Uses AI personalization when available, with Mr. Imagine personality
 */
export const sendOrderConfirmationEmail = async (
  email: string,
  orderId: string,
  items: OrderItem[],
  total: number,
  customerName?: string
): Promise<boolean> => {
  // Try AI-powered email first
  if (AI_EMAIL_ENABLED && generateAIEmail) {
    try {
      const aiEmail = await generateAIEmail({
        templateKey: 'order_confirmation',
        customerEmail: email,
        customerName: customerName || 'Creative Friend',
        orderNumber: orderId,
        items,
        total
      })

      return sendEmail({
        to: email,
        subject: aiEmail.subject,
        htmlContent: aiEmail.htmlContent,
        textContent: aiEmail.textContent
      })
    } catch (error) {
      console.error('[Email] AI generation failed, using fallback:', error)
      // Fall through to static template
    }
  }

  // Fallback to static template with Mr. Imagine branding
  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${item.name}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${(item.price * item.quantity).toFixed(2)}</td>
    </tr>
  `).join('')

  return sendEmail({
    to: email,
    subject: `🎉 Order Confirmed - ${orderId.slice(0, 8).toUpperCase()}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <!-- Mr. Imagine Header -->
        <div style="background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); border-radius: 16px 16px 0 0; padding: 25px; text-align: center;">
          <img src="${FRONTEND_URL}/mr-imagine/mr-imagine-waist-up-happy.png" alt="Mr. Imagine" style="width: 100px; height: auto; margin: 0 auto 12px; display: block;" />
          <h1 style="color: white; margin: 0; font-size: 22px;">Order Confirmed! 🎉</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0; font-size: 13px;">From your friend, Mr. Imagine</p>
        </div>

        <div style="background: white; padding: 25px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
          <p style="color: #7c3aed; font-size: 16px; font-weight: 600; margin: 0 0 15px;">
            Hey there, creative soul! 👋
          </p>

          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
            Your order just made my day! We're already getting excited to bring your vision to life.
            Here's what you've got cooking:
          </p>

          <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 12px; padding: 15px; margin-bottom: 20px; text-align: center;">
            <p style="color: #6b7280; font-size: 12px; margin: 0 0 5px; text-transform: uppercase; letter-spacing: 1px;">Order Number</p>
            <p style="color: #7c3aed; font-size: 22px; font-weight: bold; margin: 0;">${orderId.slice(0, 8).toUpperCase()}</p>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <thead>
              <tr style="background: #f9fafb;">
                <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">Item</th>
                <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151;">Qty</th>
                <th style="padding: 12px; text-align: right; font-weight: 600; color: #374151;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="padding: 12px; font-weight: bold; color: #374151;">Total</td>
                <td style="padding: 12px; text-align: right; font-weight: bold; color: #059669; font-size: 18px;">$${total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          <div style="background: #f9fafb; border-radius: 12px; padding: 15px; margin-bottom: 20px;">
            <h4 style="color: #374151; margin: 0 0 10px 0;">What's happening next?</h4>
            <ul style="color: #6b7280; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
              <li>We're prepping your order for printing (the fun part!)</li>
              <li>You'll get an email the moment it ships</li>
              <li>Track it anytime - I'll keep you posted!</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 25px 0;">
            <a href="${FRONTEND_URL}/orders" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 15px rgba(124, 58, 237, 0.3);">
              Track My Order
            </a>
          </div>

          <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 20px;">
            <p style="color: #6b7280; font-size: 14px; margin: 0;">
              Questions? Just reply to this email - I'm always here to help!
            </p>
            <p style="color: #7c3aed; font-weight: 600; margin: 12px 0 0; font-size: 15px;">
              — Mr. Imagine 🎨
            </p>
          </div>
        </div>

        <div style="text-align: center; padding: 15px; color: #9ca3af; font-size: 11px;">
          <a href="${FRONTEND_URL}" style="color: #7c3aed; text-decoration: none;">Imagine This Printed</a>
        </div>
      </div>
    `
  })
}

/**
 * Send shipping notification email to customer
 */
export const sendOrderShippedEmail = async (
  email: string,
  orderId: string,
  trackingNumber?: string,
  carrier?: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `📦 Your Order Has Shipped! - ${orderId}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">Your Order is On Its Way! 📦</h1>
        </div>

        <div style="background: linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #3730a3; font-size: 14px; margin: 0 0 10px 0;">Order Number</p>
          <p style="color: #4f46e5; font-size: 24px; font-weight: bold; margin: 0;">${orderId.slice(0, 8).toUpperCase()}</p>
        </div>

        ${trackingNumber ? `
        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">Tracking Information</h3>
          <div style="background: #f9fafb; border-radius: 8px; padding: 15px;">
            <p style="color: #6b7280; margin: 0 0 5px 0;">Carrier: <strong>${carrier || 'Standard Shipping'}</strong></p>
            <p style="color: #6b7280; margin: 0;">Tracking Number: <strong>${trackingNumber}</strong></p>
          </div>
        </div>
        ` : ''}

        <div style="background: #f9fafb; border-radius: 16px; padding: 20px; margin-bottom: 20px;">
          <h4 style="color: #374151; margin: 0 0 10px 0;">Estimated Delivery</h4>
          <p style="color: #6b7280; font-size: 14px; margin: 0;">
            Your package should arrive within 3-7 business days. We'll send you an update when it's delivered!
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/orders" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Track Your Order
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Can't wait to hear what you think!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send delivery confirmation email to customer
 */
export const sendOrderDeliveredEmail = async (
  email: string,
  orderId: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `✅ Your Order Has Been Delivered! - ${orderId}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #059669; margin: 0;">Delivered! ✅</h1>
        </div>

        <div style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #065f46; font-size: 14px; margin: 0 0 10px 0;">Order Number</p>
          <p style="color: #047857; font-size: 24px; font-weight: bold; margin: 0;">${orderId.slice(0, 8).toUpperCase()}</p>
          <p style="color: #065f46; font-size: 16px; margin: 15px 0 0 0;">Your order has been delivered!</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #374151; margin-top: 0;">Love your new prints?</h3>
          <p style="color: #6b7280; font-size: 15px; line-height: 1.6;">
            We'd love to see how you're using them! Share a photo on social media and tag us @imaginethisprinted
          </p>
          <div style="margin-top: 15px;">
            <span style="font-size: 24px; cursor: pointer; margin: 0 5px;">😊</span>
            <span style="font-size: 24px; cursor: pointer; margin: 0 5px;">😍</span>
            <span style="font-size: 24px; cursor: pointer; margin: 0 5px;">🎉</span>
          </div>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/catalog" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Shop More Designs
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Questions about your order? Just reply to this email!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

// ===============================
// WELCOME EMAIL
// ===============================

/**
 * Send welcome email to new users - Uses AI-powered Mr. Imagine personalization
 */
export const sendWelcomeEmail = async (
  email: string,
  username: string
): Promise<boolean> => {
  // Try AI-powered email first
  if (AI_EMAIL_ENABLED && generateAIEmail) {
    try {
      const aiEmail = await generateAIEmail({
        templateKey: 'welcome',
        customerEmail: email,
        customerName: username,
        username: username
      })

      return sendEmail({
        to: email,
        subject: aiEmail.subject,
        htmlContent: aiEmail.htmlContent,
        textContent: aiEmail.textContent
      })
    } catch (error) {
      console.error('[Email] AI welcome email failed, using fallback:', error)
    }
  }

  // Fallback to static template with Mr. Imagine branding
  return sendEmail({
    to: email,
    subject: `🎨 Welcome to Imagine This Printed, ${username}!`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <!-- Header with Mr. Imagine -->
        <div style="background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); border-radius: 16px 16px 0 0; padding: 30px; text-align: center;">
          <img src="${FRONTEND_URL}/mr-imagine/mr-imagine-waist-up-happy.png" alt="Mr. Imagine" style="width: 120px; height: auto; margin: 0 auto 15px; display: block;" />
          <h1 style="color: white; margin: 0; font-size: 24px; font-weight: bold;">Mr. Imagine</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0; font-size: 14px;">Your Creative Companion</p>
        </div>

        <div style="background: white; padding: 30px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
          <p style="color: #7c3aed; font-size: 18px; font-weight: 600; margin: 0 0 20px;">
            Welcome to the family, ${username}! 🎉
          </p>

          <p style="color: #374151; font-size: 15px; line-height: 1.7;">
            I'm Mr. Imagine, your creative companion here at Imagine This Printed!
            We're so excited to have you join our community of creative souls.
          </p>

          <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin: 20px 0;">
            <h3 style="color: #374151; margin: 0 0 15px 0;">Here's what you can do:</h3>
            <ul style="color: #6b7280; font-size: 15px; line-height: 2; margin: 0; padding-left: 20px;">
              <li>🛒 <strong>Shop</strong> - Browse thousands of unique designs</li>
              <li>🎨 <strong>Create</strong> - Design your own custom products</li>
              <li>💰 <strong>Earn</strong> - Submit designs and earn 10% royalties</li>
              <li>🎁 <strong>Points</strong> - Earn points on every purchase</li>
            </ul>
          </div>

          <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center;">
            <p style="color: #7c3aed; font-size: 18px; font-weight: bold; margin: 0 0 5px 0;">🎁 Welcome Gift!</p>
            <p style="color: #6b7280; font-size: 14px; margin: 0;">
              Use code <strong style="color: #7c3aed;">WELCOME10</strong> for 10% off your first order!
            </p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/catalog" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
              Start Exploring
            </a>
          </div>

          <!-- Closing with Mr. Imagine signature -->
          <div style="border-top: 1px solid #e5e7eb; padding-top: 25px; margin-top: 25px;">
            <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0;">
              Can't wait to see what you create! If you have any questions, just reply to this email or chat with me on our website.
            </p>
            <div style="margin-top: 20px;">
              <img src="${FRONTEND_URL}/mr-imagine/mr-imagine-head-happy.png" alt="Mr. Imagine" style="width: 50px; height: 50px; border-radius: 50%; vertical-align: middle; margin-right: 12px;" />
              <span style="color: #7c3aed; font-weight: 600; font-size: 16px;">Mr. Imagine</span>
              <span style="color: #9ca3af; font-size: 12px; margin-left: 5px;">Your Creative Companion</span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
          <a href="${FRONTEND_URL}" style="color: #7c3aed; text-decoration: none;">Imagine This Printed</a>
        </div>
      </div>
    `
  })
}

// ===============================
// CUSTOM JOB REQUEST EMAILS
// ===============================

/**
 * Send confirmation when a custom job is submitted
 */
export const sendCustomJobSubmittedEmail = async (
  email: string,
  jobId: string,
  title: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `📋 Custom Job Request Received - ${title}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">Request Received! 📋</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">Request ID</p>
          <p style="color: #7c3aed; font-size: 24px; font-weight: bold; margin: 0;">${jobId.slice(0, 8).toUpperCase()}</p>
          <p style="color: #374151; font-size: 16px; margin: 15px 0 0 0;">${title}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">What happens next?</h3>
          <ol style="color: #6b7280; font-size: 15px; line-height: 1.8;">
            <li>Our team will review your request within 24-48 hours</li>
            <li>We'll send you a quote with pricing and timeline</li>
            <li>Once approved, we'll start working on your custom project</li>
            <li>You'll receive updates as we progress</li>
          </ol>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Continue Shopping
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Have questions? Reply to this email anytime!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send notification when a custom job is approved
 */
export const sendCustomJobApprovedEmail = async (
  email: string,
  jobId: string,
  title: string,
  estimatedCost: number
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `✅ Custom Job Approved - ${title}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #059669; margin: 0;">Your Request is Approved! ✅</h1>
        </div>

        <div style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #065f46; font-size: 14px; margin: 0 0 10px 0;">Request ID</p>
          <p style="color: #047857; font-size: 24px; font-weight: bold; margin: 0;">${jobId.slice(0, 8).toUpperCase()}</p>
          <p style="color: #065f46; font-size: 16px; margin: 15px 0 0 0;">${title}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">Project Details</h3>
          <div style="background: #f9fafb; border-radius: 8px; padding: 15px; text-align: center;">
            <p style="color: #6b7280; margin: 0 0 5px 0;">Estimated Cost</p>
            <p style="color: #059669; font-size: 32px; font-weight: bold; margin: 0;">$${estimatedCost.toFixed(2)}</p>
          </div>
          <p style="color: #6b7280; font-size: 14px; text-align: center; margin: 15px 0 0 0;">
            Our team has started working on your custom project!
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/contact" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Contact Us With Questions
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            We'll keep you updated on the progress!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send notification when a custom job is completed
 */
export const sendCustomJobCompletedEmail = async (
  email: string,
  jobId: string,
  title: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `🎉 Your Custom Project is Ready! - ${title}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">Your Project is Complete! 🎉</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">Request ID</p>
          <p style="color: #7c3aed; font-size: 24px; font-weight: bold; margin: 0;">${jobId.slice(0, 8).toUpperCase()}</p>
          <p style="color: #374151; font-size: 16px; margin: 15px 0 0 0;">${title}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #374151; margin-top: 0;">Great news!</h3>
          <p style="color: #6b7280; font-size: 15px; line-height: 1.6;">
            Your custom project has been completed and is ready for shipping or pickup!
            We can't wait for you to see the final result.
          </p>
        </div>

        <div style="background: #f9fafb; border-radius: 16px; padding: 20px; margin-bottom: 20px; text-align: center;">
          <p style="color: #6b7280; font-size: 14px; margin: 0;">
            Our team will reach out shortly with delivery details.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/contact" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Contact Us
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Thank you for trusting us with your custom project!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}
