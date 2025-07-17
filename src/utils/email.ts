interface BrevoEmailOptions {
  to: string
  subject: string
  htmlContent: string
  textContent?: string
}

const BREVO_API_KEY = process.env.BREVO_API_KEY
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'noreply@imaginethisprinted.com'
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Imagine This Printed'

export const sendEmail = async (options: BrevoEmailOptions): Promise<boolean> => {
  if (!BREVO_API_KEY) {
    console.error('BREVO_API_KEY is not set')
    return false
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
      console.error('Brevo API error:', errorData)
      return false
    }

    console.log('Email sent successfully to:', options.to)
    return true
  } catch (error) {
    console.error('Email sending failed:', error)
    return false
  }
}

export const sendEmailVerification = async (email: string, token: string): Promise<boolean> => {
  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const verificationUrl = `${appUrl}/verify-email?token=${token}`
  
  return sendEmail({
    to: email,
    subject: 'Verify your email address',
    htmlContent: `
      <h2>Welcome to Imagine This Printed!</h2>
      <p>Please click the link below to verify your email address:</p>
      <a href="${verificationUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Email</a>
      <p>If you didn't create an account, please ignore this email.</p>
      <p>This link will expire in 1 hour.</p>
    `
  })
}

export const sendPasswordResetEmail = async (email: string, token: string): Promise<boolean> => {
  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const resetUrl = `${appUrl}/reset-password?token=${token}`
  
  return sendEmail({
    to: email,
    subject: 'Reset your password',
    htmlContent: `
      <h2>Password Reset Request</h2>
      <p>Click the link below to reset your password:</p>
      <a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a>
      <p>If you didn't request a password reset, please ignore this email.</p>
      <p>This link will expire in 1 hour.</p>
    `
  })
}

export const sendWelcomeEmail = async (email: string, firstName?: string): Promise<boolean> => {
  const name = firstName || 'User'
  
  return sendEmail({
    to: email,
    subject: 'Welcome to Imagine This Printed!',
    htmlContent: `
      <h2>Welcome to Imagine This Printed, ${name}!</h2>
      <p>Thank you for joining our community of 3D printing enthusiasts!</p>
      <p>Here's what you can do next:</p>
      <ul>
        <li>Complete your profile</li>
        <li>Browse our product catalog</li>
        <li>Start creating and ordering custom prints</li>
      </ul>
      <p>If you have any questions, feel free to reach out to our support team.</p>
      <p>Happy printing!</p>
    `
  })
}