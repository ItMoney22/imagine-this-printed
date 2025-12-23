import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'
import { generateAIEmail, previewAIEmail } from '../../services/emailAI.js'
import { sendEmail } from '../../utils/email.js'

const router = Router()

// All routes require admin or manager role
router.use(requireAuth)
router.use(requireRole(['admin', 'manager']))

/**
 * GET /api/admin/email-templates
 * List all email templates
 */
router.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data: templates, error } = await supabase
      .from('email_templates')
      .select('*')
      .order('category', { ascending: true })
      .order('name', { ascending: true })

    if (error) {
      req.log?.error({ err: error }, 'Failed to fetch email templates')
      return res.status(500).json({ error: 'Failed to fetch templates' })
    }

    return res.json({ templates })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error fetching email templates')
    return res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/admin/email-templates/:key
 * Get a single email template by key
 */
router.get('/:key', async (req: Request, res: Response): Promise<any> => {
  try {
    const { key } = req.params

    const { data: template, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('template_key', key)
      .single()

    if (error || !template) {
      return res.status(404).json({ error: 'Template not found' })
    }

    return res.json({ template })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error fetching email template')
    return res.status(500).json({ error: error.message })
  }
})

/**
 * PATCH /api/admin/email-templates/:key
 * Update an email template
 */
router.patch('/:key', async (req: Request, res: Response): Promise<any> => {
  try {
    const { key } = req.params
    const {
      name,
      description,
      subject_template,
      html_template,
      ai_enabled,
      ai_prompt_context,
      ai_tone,
      mr_imagine_enabled,
      mr_imagine_greeting,
      is_active
    } = req.body

    const updateData: any = {
      updated_by: req.user?.sub,
      updated_at: new Date().toISOString()
    }

    // Only include fields that were provided
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (subject_template !== undefined) updateData.subject_template = subject_template
    if (html_template !== undefined) updateData.html_template = html_template
    if (ai_enabled !== undefined) updateData.ai_enabled = ai_enabled
    if (ai_prompt_context !== undefined) updateData.ai_prompt_context = ai_prompt_context
    if (ai_tone !== undefined) updateData.ai_tone = ai_tone
    if (mr_imagine_enabled !== undefined) updateData.mr_imagine_enabled = mr_imagine_enabled
    if (mr_imagine_greeting !== undefined) updateData.mr_imagine_greeting = mr_imagine_greeting
    if (is_active !== undefined) updateData.is_active = is_active

    const { data: template, error } = await supabase
      .from('email_templates')
      .update(updateData)
      .eq('template_key', key)
      .select()
      .single()

    if (error) {
      req.log?.error({ err: error }, 'Failed to update email template')
      return res.status(500).json({ error: 'Failed to update template' })
    }

    req.log?.info({ templateKey: key }, 'Email template updated')
    return res.json({ template, message: 'Template updated successfully' })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error updating email template')
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/email-templates/:key/preview
 * Preview an AI-generated email with sample data
 */
router.post('/:key/preview', async (req: Request, res: Response): Promise<any> => {
  try {
    const { key } = req.params
    const { sampleData } = req.body

    // Generate preview email
    const email = await previewAIEmail(key, sampleData || {})

    return res.json({
      subject: email.subject,
      htmlContent: email.htmlContent,
      textContent: email.textContent,
      aiGenerated: email.aiGenerated
    })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error generating email preview')
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/email-templates/:key/send-test
 * Send a test email to the admin
 */
router.post('/:key/send-test', async (req: Request, res: Response): Promise<any> => {
  try {
    const { key } = req.params
    const { testEmail, sampleData } = req.body

    if (!testEmail) {
      return res.status(400).json({ error: 'Test email address is required' })
    }

    // Generate the email
    const email = await previewAIEmail(key, sampleData || {})

    // Send it
    const success = await sendEmail({
      to: testEmail,
      subject: `[TEST] ${email.subject}`,
      htmlContent: email.htmlContent,
      textContent: email.textContent
    })

    if (!success) {
      return res.status(500).json({ error: 'Failed to send test email' })
    }

    req.log?.info({ templateKey: key, testEmail }, 'Test email sent')
    return res.json({ message: `Test email sent to ${testEmail}` })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error sending test email')
    return res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/admin/email-templates/logs
 * Get email send logs
 */
router.get('/logs/recent', async (req: Request, res: Response): Promise<any> => {
  try {
    const { limit = 50, offset = 0, templateKey } = req.query

    let query = supabase
      .from('email_logs')
      .select('*', { count: 'exact' })
      .order('sent_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (templateKey) {
      query = query.eq('template_key', templateKey)
    }

    const { data: logs, error, count } = await query

    if (error) {
      req.log?.error({ err: error }, 'Failed to fetch email logs')
      return res.status(500).json({ error: 'Failed to fetch logs' })
    }

    return res.json({ logs, total: count })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error fetching email logs')
    return res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/admin/email-templates/stats
 * Get email statistics
 */
router.get('/stats/overview', async (req: Request, res: Response): Promise<any> => {
  try {
    // Get counts by template
    const { data: templateStats, error: templateError } = await supabase
      .from('email_logs')
      .select('template_key, ai_personalization_used')

    if (templateError) {
      return res.status(500).json({ error: 'Failed to fetch stats' })
    }

    // Calculate stats
    const stats = {
      totalSent: templateStats?.length || 0,
      aiGenerated: templateStats?.filter(l => l.ai_personalization_used).length || 0,
      byTemplate: {} as Record<string, number>
    }

    templateStats?.forEach(log => {
      stats.byTemplate[log.template_key] = (stats.byTemplate[log.template_key] || 0) + 1
    })

    return res.json({ stats })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error fetching email stats')
    return res.status(500).json({ error: error.message })
  }
})

export default router
