import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'

const router = Router()
const prisma = new PrismaClient()

// Helper to mask secrets
const tail = (s?: string) => s ? `...${s.slice(-4)}` : 'none';

// Database health check
router.get('/database', async (req: Request, res: Response) => {
  try {
    // Test database connection by checking if we can query the user table
    const userCount = await prisma.userProfile.count()

    res.status(200).json({
      status: 'connected',
      message: `Database connected successfully (${userCount} users)`
    })
  } catch (error) {
    console.error('Database health check error:', error)
    res.status(500).json({
      status: 'error',
      message: 'Database connection failed',
      error: String(error)
    })
  }
})

// Email health check (Brevo transactional)
router.get('/email', async (req: Request, res: Response): Promise<any> => {
  try {
    const brevoApiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL || 'wecare@imaginethisprinted.com';

    if (!brevoApiKey) {
      return res.status(500).json({
        ok: false,
        error: 'BREVO_API_KEY not configured'
      });
    }

    console.log('[health:email] Testing Brevo API with key:', tail(brevoApiKey));
    console.log('[health:email] Sender email:', senderEmail);

    // Send test email via Brevo API
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': brevoApiKey,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: process.env.BREVO_SENDER_NAME || 'Imagine This Printed',
          email: senderEmail
        },
        to: [{ email: senderEmail }],
        subject: 'ITP Email Health OK',
        htmlContent: '<p>Email service is operational. This is an automated health check.</p>'
      })
    });

    const result: any = await response.json();

    if (!response.ok) {
      console.error('[health:email] Brevo API error:', result);
      return res.status(500).json({
        ok: false,
        error: 'Brevo API call failed',
        details: result,
        apiKeyTail: tail(brevoApiKey)
      });
    }

    console.log('[health:email] ✅ Test email sent successfully, messageId:', result.messageId);

    return res.status(200).json({
      ok: true,
      messageId: result.messageId,
      sender: senderEmail,
      apiKeyTail: tail(brevoApiKey)
    });
  } catch (error: any) {
    console.error('[health:email] Exception:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Email health check failed',
      apiKeyTail: tail(process.env.BREVO_API_KEY)
    });
  }
})

// Auth health check
router.get('/auth', async (req: Request, res: Response) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const frontendUrl = process.env.FRONTEND_URL;
  const anonKeyTail = tail(process.env.SUPABASE_ANON_KEY);

  res.status(200).json({
    ok: true,
    supabaseUrl,
    frontendUrl,
    anonKeyTail,
    callbackUrl: `${frontendUrl}/auth/callback`,
    siteUrl: process.env.APP_URL || frontendUrl
  });
})

// General health check
router.get('/', async (req: Request, res: Response) => {
  res.status(200).json({ ok: true })
})

export default router
