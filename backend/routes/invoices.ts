import { Router, Request, Response } from 'express'
import Stripe from 'stripe'
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia'
})

// Founder earnings percentage
const FOUNDER_PERCENTAGE = 35

interface LineItem {
  description: string
  amount_cents: number
  quantity: number
}

interface CreateInvoiceBody {
  client_email: string
  client_name?: string
  line_items: LineItem[]
  memo?: string
  due_days?: number
  order_id?: string
  founder_id?: string // Only for admin creating on behalf of founder
  invoice_type?: 'admin' | 'founder' // 'admin' = no founder split (100% to business)
}

// GET /api/invoices - List invoices for current user
router.get('/', requireAuth, requireRole(['founder', 'admin']), async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const userRole = req.user?.role

    let query = supabase
      .from('founder_invoices')
      .select('*')
      .order('created_at', { ascending: false })

    // Founders only see their own invoices
    if (userRole === 'founder') {
      query = query.eq('founder_id', userId)
    }
    // Admins see all invoices

    const { data: invoices, error } = await query

    if (error) {
      req.log?.error({ err: error }, 'Failed to fetch invoices')
      return res.status(500).json({ error: 'Failed to fetch invoices' })
    }

    return res.json({ ok: true, invoices })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error fetching invoices')
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/invoices/:id - Get single invoice
router.get('/:id', requireAuth, requireRole(['founder', 'admin']), async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const userRole = req.user?.role
    const { id } = req.params

    let query = supabase
      .from('founder_invoices')
      .select('*')
      .eq('id', id)
      .single()

    const { data: invoice, error } = await query

    if (error || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' })
    }

    // Founders can only view their own invoices
    if (userRole === 'founder' && invoice.founder_id !== userId) {
      return res.status(403).json({ error: 'Access denied' })
    }

    return res.json({ ok: true, invoice })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error fetching invoice')
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/invoices - Create a new invoice
router.post('/', requireAuth, requireRole(['founder', 'admin']), async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const userRole = req.user?.role
    const body: CreateInvoiceBody = req.body

    // Validate required fields
    if (!body.client_email) {
      return res.status(400).json({ error: 'Client email is required' })
    }
    if (!body.line_items || body.line_items.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' })
    }

    // Determine if this is an admin-only invoice (no founder split)
    const isAdminInvoice = body.invoice_type === 'admin' && userRole === 'admin'

    // Determine founder_id (null for admin invoices)
    let founderId: string | null = null
    if (!isAdminInvoice) {
      founderId = userId!
      if (userRole === 'admin' && body.founder_id) {
        founderId = body.founder_id
      }
    }

    // Calculate totals
    const subtotalCents = body.line_items.reduce(
      (sum, item) => sum + (item.amount_cents * item.quantity),
      0
    )

    // For admin invoices: 100% to business, no founder split
    // For founder invoices: 35% founder / 65% platform
    const founderEarningsCents = isAdminInvoice ? 0 : Math.floor(subtotalCents * (FOUNDER_PERCENTAGE / 100))
    const platformFeeCents = subtotalCents - founderEarningsCents

    // Calculate due date
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + (body.due_days || 14))

    // Create or get Stripe customer
    let stripeCustomer: Stripe.Customer
    const existingCustomers = await stripe.customers.list({
      email: body.client_email,
      limit: 1
    })

    if (existingCustomers.data.length > 0) {
      stripeCustomer = existingCustomers.data[0]
    } else {
      stripeCustomer = await stripe.customers.create({
        email: body.client_email,
        name: body.client_name || undefined,
        metadata: {
          source: 'founder_invoice',
          created_by: userId!
        }
      })
    }

    // Create Stripe invoice
    const stripeInvoice = await stripe.invoices.create({
      customer: stripeCustomer.id,
      collection_method: 'send_invoice',
      days_until_due: body.due_days || 14,
      description: body.memo || undefined,
      metadata: {
        invoice_type: isAdminInvoice ? 'admin' : 'founder',
        founder_id: founderId || '',
        created_by: userId!,
        order_id: body.order_id || ''
      }
    })

    // Add line items to Stripe invoice
    for (const item of body.line_items) {
      await stripe.invoiceItems.create({
        customer: stripeCustomer.id,
        invoice: stripeInvoice.id,
        description: item.description,
        quantity: item.quantity,
        unit_amount: item.amount_cents,
        currency: 'usd'
      })
    }

    // Finalize the invoice (makes it ready to send)
    const finalizedInvoice = await stripe.invoices.finalizeInvoice(stripeInvoice.id)

    // Create database record
    const { data: dbInvoice, error: dbError } = await supabase
      .from('founder_invoices')
      .insert({
        created_by_user_id: userId,
        created_by_role: userRole,
        invoice_type: isAdminInvoice ? 'admin' : 'founder',
        founder_id: founderId, // null for admin invoices
        client_email: body.client_email,
        client_name: body.client_name || null,
        order_id: body.order_id || null,
        stripe_invoice_id: finalizedInvoice.id,
        stripe_invoice_url: finalizedInvoice.invoice_pdf,
        stripe_hosted_invoice_url: finalizedInvoice.hosted_invoice_url,
        subtotal_cents: subtotalCents,
        platform_fee_cents: platformFeeCents,
        founder_earnings_cents: founderEarningsCents,
        founder_percentage: isAdminInvoice ? 0 : FOUNDER_PERCENTAGE,
        platform_percentage: isAdminInvoice ? 100 : (100 - FOUNDER_PERCENTAGE),
        line_items: body.line_items,
        memo: body.memo || null,
        due_date: dueDate.toISOString().split('T')[0],
        status: 'draft'
      })
      .select()
      .single()

    if (dbError) {
      req.log?.error({ err: dbError }, 'Failed to create invoice record')
      // Try to void the Stripe invoice if DB fails
      await stripe.invoices.voidInvoice(finalizedInvoice.id).catch(() => {})
      return res.status(500).json({ error: 'Failed to create invoice' })
    }

    req.log?.info({
      invoiceId: dbInvoice.id,
      stripeInvoiceId: finalizedInvoice.id,
      invoiceType: isAdminInvoice ? 'admin' : 'founder',
      founderId,
      subtotal: subtotalCents / 100
    }, 'Invoice created successfully')

    return res.json({
      ok: true,
      invoice: dbInvoice,
      stripe_invoice_url: finalizedInvoice.hosted_invoice_url
    })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error creating invoice')
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/invoices/:id/send - Send invoice to client
router.post('/:id/send', requireAuth, requireRole(['founder', 'admin']), async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const userRole = req.user?.role
    const { id } = req.params

    // Get invoice
    const { data: invoice, error: fetchError } = await supabase
      .from('founder_invoices')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' })
    }

    // Authorization check
    if (userRole === 'founder' && invoice.founder_id !== userId) {
      return res.status(403).json({ error: 'Access denied' })
    }

    if (invoice.status !== 'draft') {
      return res.status(400).json({ error: `Cannot send invoice with status: ${invoice.status}` })
    }

    // Send via Stripe
    const sentInvoice = await stripe.invoices.sendInvoice(invoice.stripe_invoice_id)

    // Update database
    const { error: updateError } = await supabase
      .from('founder_invoices')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) {
      req.log?.error({ err: updateError }, 'Failed to update invoice status')
    }

    req.log?.info({
      invoiceId: id,
      stripeInvoiceId: invoice.stripe_invoice_id,
      clientEmail: invoice.client_email
    }, 'Invoice sent successfully')

    return res.json({
      ok: true,
      message: `Invoice sent to ${invoice.client_email}`,
      hosted_invoice_url: sentInvoice.hosted_invoice_url
    })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error sending invoice')
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/invoices/:id/void - Void an invoice
router.post('/:id/void', requireAuth, requireRole(['founder', 'admin']), async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const userRole = req.user?.role
    const { id } = req.params

    // Get invoice
    const { data: invoice, error: fetchError } = await supabase
      .from('founder_invoices')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' })
    }

    // Authorization check
    if (userRole === 'founder' && invoice.founder_id !== userId) {
      return res.status(403).json({ error: 'Access denied' })
    }

    if (invoice.status === 'paid' || invoice.status === 'void') {
      return res.status(400).json({ error: `Cannot void invoice with status: ${invoice.status}` })
    }

    // Void via Stripe
    await stripe.invoices.voidInvoice(invoice.stripe_invoice_id)

    // Update database
    const { error: updateError } = await supabase
      .from('founder_invoices')
      .update({
        status: 'void',
        voided_at: new Date().toISOString()
      })
      .eq('id', id)

    if (updateError) {
      req.log?.error({ err: updateError }, 'Failed to update invoice status')
    }

    req.log?.info({
      invoiceId: id,
      stripeInvoiceId: invoice.stripe_invoice_id
    }, 'Invoice voided successfully')

    return res.json({ ok: true, message: 'Invoice voided' })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error voiding invoice')
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/invoices/stats - Get invoice statistics
router.get('/stats/summary', requireAuth, requireRole(['founder', 'admin']), async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const userRole = req.user?.role

    let query = supabase
      .from('founder_invoices')
      .select('status, subtotal_cents, founder_earnings_cents')

    if (userRole === 'founder') {
      query = query.eq('founder_id', userId)
    }

    const { data: invoices, error } = await query

    if (error) {
      req.log?.error({ err: error }, 'Failed to fetch invoice stats')
      return res.status(500).json({ error: 'Failed to fetch statistics' })
    }

    const stats = {
      total_invoices: invoices?.length || 0,
      draft: 0,
      sent: 0,
      paid: 0,
      overdue: 0,
      void: 0,
      total_billed_cents: 0,
      total_collected_cents: 0,
      total_earnings_cents: 0,
      pending_earnings_cents: 0
    }

    for (const inv of invoices || []) {
      stats[inv.status as keyof typeof stats]++
      stats.total_billed_cents += inv.subtotal_cents

      if (inv.status === 'paid') {
        stats.total_collected_cents += inv.subtotal_cents
        stats.total_earnings_cents += inv.founder_earnings_cents
      } else if (inv.status === 'sent') {
        stats.pending_earnings_cents += inv.founder_earnings_cents
      }
    }

    return res.json({
      ok: true,
      stats: {
        ...stats,
        total_billed: stats.total_billed_cents / 100,
        total_collected: stats.total_collected_cents / 100,
        total_earnings: stats.total_earnings_cents / 100,
        pending_earnings: stats.pending_earnings_cents / 100
      }
    })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error fetching invoice stats')
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/invoices/founders - List founders (admin only, for dropdown)
router.get('/founders/list', requireAuth, requireRole(['admin']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { data: founders, error } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, username')
      .eq('role', 'founder')
      .order('email')

    if (error) {
      req.log?.error({ err: error }, 'Failed to fetch founders')
      return res.status(500).json({ error: 'Failed to fetch founders' })
    }

    return res.json({
      ok: true,
      founders: founders?.map(f => ({
        id: f.user_id,
        email: f.email,
        name: `${f.first_name || ''} ${f.last_name || ''}`.trim() || f.username || f.email
      }))
    })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error fetching founders')
    return res.status(500).json({ error: error.message })
  }
})

export default router
