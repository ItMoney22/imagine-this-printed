import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { checkBucketAccess } from '../services/google-cloud-storage.js'
import { getWorkerHeartbeat } from '../services/order-monitor.js'

const router = Router()
const prisma = new PrismaClient()

// Worker heartbeat (the background worker stamps audit_logs hourly from the
// monitor loop; stale > 2.5h ⇒ the worker process is down)
router.get('/worker', async (_req: Request, res: Response) => {
  try {
    const heartbeat = await getWorkerHeartbeat()
    res.status(heartbeat.ok ? 200 : 503).json({
      status: heartbeat.ok ? 'alive' : 'stale',
      last_seen: heartbeat.last_seen,
      message: heartbeat.ok
        ? 'Worker heartbeat is current'
        : heartbeat.last_seen
          ? `No heartbeat since ${heartbeat.last_seen} — worker may be down`
          : 'No heartbeat recorded yet'
    })
  } catch (error) {
    res.status(500).json({ status: 'error', message: String(error) })
  }
})

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

// Email health check (Resend transactional)
router.get('/email', async (req: Request, res: Response): Promise<any> => {
  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromAddress =
      process.env.EMAIL_FROM ||
      `Imagine This Printed <${process.env.BREVO_SENDER_EMAIL || 'wecare@imaginethisprinted.com'}>`;
    const toAddress = process.env.BREVO_SENDER_EMAIL || 'wecare@imaginethisprinted.com';

    if (!resendApiKey) {
      // Degrade gracefully: report which fallback key exists
      const hasBrevo = !!process.env.BREVO_API_KEY;
      return res.status(500).json({
        ok: false,
        error: 'RESEND_API_KEY not configured',
        brevoFallbackAvailable: hasBrevo
      });
    }

    console.log('[health:email] Testing Resend API with key:', tail(resendApiKey));

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toAddress],
        subject: 'ITP Email Health OK',
        html: '<p>Email service is operational. This is an automated health check.</p>',
      }),
    });

    const result: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('[health:email] Resend API error:', result);
      return res.status(500).json({
        ok: false,
        error: 'Resend API call failed',
        details: result,
        apiKeyTail: tail(resendApiKey)
      });
    }

    console.log('[health:email] ✅ Test email sent successfully, id:', result.id);

    return res.status(200).json({
      ok: true,
      messageId: result.id,
      sender: fromAddress,
      apiKeyTail: tail(resendApiKey)
    });
  } catch (error: any) {
    console.error('[health:email] Exception:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Email health check failed',
      apiKeyTail: tail(process.env.RESEND_API_KEY)
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

// Google Cloud Storage health check
router.get('/gcs', async (req: Request, res: Response): Promise<any> => {
  try {
    const bucketName = process.env.GCS_BUCKET_NAME
    const projectId = process.env.GCS_PROJECT_ID
    const hasCredentials = !!process.env.GCS_CREDENTIALS

    if (!bucketName || !projectId || !hasCredentials) {
      return res.status(500).json({
        status: 'error',
        message: 'GCS configuration incomplete',
        details: {
          bucketName: !!bucketName,
          projectId: !!projectId,
          credentials: hasCredentials
        }
      })
    }

    // Check bucket access
    const accessible = await checkBucketAccess()

    if (accessible) {
      return res.json({
        status: 'ok',
        message: 'Google Cloud Storage is configured and accessible',
        bucket: bucketName,
        projectId
      })
    } else {
      return res.status(500).json({
        status: 'error',
        message: 'GCS bucket not accessible',
        bucket: bucketName
      })
    }
  } catch (error: any) {
    console.error('[health/gcs] Error:', error)
    return res.status(500).json({
      status: 'error',
      message: 'GCS health check failed',
      error: error.message
    })
  }
})

// General health check
router.get('/', async (req: Request, res: Response) => {
  res.status(200).json({ ok: true })
})

export default router
