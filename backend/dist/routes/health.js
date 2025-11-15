import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { checkBucketAccess } from '../services/google-cloud-storage.js';
const router = Router();
const prisma = new PrismaClient();
const tail = (s) => s ? `...${s.slice(-4)}` : 'none';
router.get('/database', async (req, res) => {
    try {
        const userCount = await prisma.userProfile.count();
        res.status(200).json({
            status: 'connected',
            message: `Database connected successfully (${userCount} users)`
        });
    }
    catch (error) {
        console.error('Database health check error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Database connection failed',
            error: String(error)
        });
    }
});
router.get('/email', async (req, res) => {
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
        const result = await response.json();
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
    }
    catch (error) {
        console.error('[health:email] Exception:', error);
        res.status(500).json({
            ok: false,
            error: error.message || 'Email health check failed',
            apiKeyTail: tail(process.env.BREVO_API_KEY)
        });
    }
});
router.get('/auth', async (req, res) => {
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
});
router.get('/gcs', async (req, res) => {
    try {
        const bucketName = process.env.GCS_BUCKET_NAME;
        const projectId = process.env.GCS_PROJECT_ID;
        const hasCredentials = !!process.env.GCS_CREDENTIALS;
        if (!bucketName || !projectId || !hasCredentials) {
            return res.status(500).json({
                status: 'error',
                message: 'GCS configuration incomplete',
                details: {
                    bucketName: !!bucketName,
                    projectId: !!projectId,
                    credentials: hasCredentials
                }
            });
        }
        const accessible = await checkBucketAccess();
        if (accessible) {
            return res.json({
                status: 'ok',
                message: 'Google Cloud Storage is configured and accessible',
                bucket: bucketName,
                projectId
            });
        }
        else {
            return res.status(500).json({
                status: 'error',
                message: 'GCS bucket not accessible',
                bucket: bucketName
            });
        }
    }
    catch (error) {
        console.error('[health/gcs] Error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'GCS health check failed',
            error: error.message
        });
    }
});
router.get('/', async (req, res) => {
    res.status(200).json({ ok: true });
});
export default router;
//# sourceMappingURL=health.js.map