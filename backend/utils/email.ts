interface BrevoEmailOptions {
  to: string
  subject: string
  htmlContent: string
  textContent?: string
}

const BREVO_API_KEY = process.env.BREVO_API_KEY
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'wecare@imaginethisprinted.com'
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Imagine This Printed'
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

export const sendEmail = async (options: BrevoEmailOptions): Promise<boolean> => {
  if (!BREVO_API_KEY) {
    console.error('[Email] BREVO_API_KEY is not set')
    // Log the email instead for development
    console.log('[Email] Would send to:', options.to)
    console.log('[Email] Subject:', options.subject)
    return true
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
      return false
    }

    console.log('[Email] ✅ Email sent successfully to:', options.to)
    return true
  } catch (error) {
    console.error('[Email] ❌ Email sending failed:', error)
    return false
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
