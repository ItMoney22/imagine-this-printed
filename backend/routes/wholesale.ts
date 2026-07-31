// Wholesale application, account lookup, and quick-reorder endpoints.
//
// WHY THIS EXISTS (Watchtower task 0af32316-5bf6-4df8-9f81-b842ed121c69):
// src/pages/WholesalePortal.tsx used to (a) drop every submitted application
// on the floor behind `alert('Application submitted!')`, (b) synthesize a
// fake 'ABC Retail Inc.' account + 3 fake orders for ANY user with the
// 'wholesale' role, and (c) leave the Quick Reorder button with no handler.
// This route makes all three real: applications persist to
// wholesale_applications and notify admins; the account lookup reads
// user_profiles + real `orders`; reorder replays the most recent real order.
//
// Tiered pricing itself lives in backend/services/order-pricing.ts
// (WHOLESALE_TIER_DISCOUNT_RATES) — that's the server-authoritative source
// checkout actually charges from, reused here only for display.

import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { sendNewWholesaleApplicationEmail } from '../utils/email.js'
import { WHOLESALE_TIER_DISCOUNT_RATES } from '../services/order-pricing.js'

const router = Router()

// Orders that don't represent a real completed purchase (e.g. an abandoned
// or cancelled checkout) shouldn't count toward wholesale order history.
const EXCLUDED_ORDER_STATUSES = ['cancelled']

// -----------------------------------------------------------------------
// POST /api/wholesale/apply — submit a wholesale application
// -----------------------------------------------------------------------
router.post('/apply', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user!.sub
    const {
      companyName,
      businessType,
      taxId,
      contactFirstName,
      contactLastName,
      contactPhone,
      address,
      message
    } = req.body || {}

    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      return res.status(400).json({ error: 'Company name is required' })
    }
    if (!businessType || typeof businessType !== 'string' || !businessType.trim()) {
      return res.status(400).json({ error: 'Business type is required' })
    }

    const contactEmail = req.user!.email
    if (!contactEmail) {
      return res.status(400).json({ error: 'No verified email on this account' })
    }

    const { data: application, error: insertError } = await supabase
      .from('wholesale_applications')
      .insert({
        user_id: userId,
        company_name: companyName.trim(),
        business_type: businessType.trim(),
        tax_id: taxId || null,
        contact_first_name: contactFirstName || null,
        contact_last_name: contactLastName || null,
        contact_email: contactEmail,
        contact_phone: contactPhone || null,
        address: address || {},
        message: message || null,
        status: 'pending'
      })
      .select()
      .single()

    if (insertError) {
      req.log?.error({ err: insertError, userId }, 'Failed to insert wholesale application')
      throw insertError
    }

    // Admin dashboard alert — best-effort, doesn't fail the submission.
    try {
      await supabase.from('admin_notifications').insert({
        type: 'wholesale_application',
        title: `New Wholesale Application: ${companyName.trim()}`,
        message: `Business type: ${businessType.trim()}\nContact: ${contactEmail}`,
        user_id: userId
      })
    } catch (notifyError) {
      req.log?.error({ err: notifyError }, 'Failed to write admin_notifications row for wholesale application')
    }

    // Admin email — same best-effort treatment as every other notification
    // path in backend/utils/email.ts (never blocks the user-facing response).
    try {
      await sendNewWholesaleApplicationEmail(application.id, companyName.trim(), businessType.trim(), contactEmail)
    } catch (emailError) {
      req.log?.error({ err: emailError }, 'Failed to send wholesale application admin email')
    }

    res.status(201).json({
      success: true,
      applicationId: application.id,
      message: 'Your application has been submitted. We will review it within 2-3 business days.'
    })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error submitting wholesale application')
    res.status(500).json({ error: 'Failed to submit application', details: error.message })
  }
})

// -----------------------------------------------------------------------
// GET /api/wholesale/account — real account status for the signed-in user
// -----------------------------------------------------------------------
router.get('/account', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user!.sub

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('role, company_name, business_type, tax_id, wholesale_status, wholesale_tier, credit_limit, payment_terms, first_name, last_name, email, phone')
      .eq('id', userId)
      .single()

    if (profileError) {
      req.log?.error({ err: profileError, userId }, 'Failed to load user_profiles for wholesale account lookup')
      throw profileError
    }

    const isApprovedWholesale = profile?.role === 'wholesale' && profile?.wholesale_status === 'approved'

    if (!isApprovedWholesale) {
      // Not (yet) an approved wholesale account — surface their most recent
      // application, if any, so the portal can show a real pending/rejected
      // state instead of always defaulting to the application form.
      const { data: latestApplication } = await supabase
        .from('wholesale_applications')
        .select('id, company_name, business_type, status, created_at, rejection_reason')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!latestApplication) {
        return res.json({ status: 'not_applied' })
      }
      return res.json({ status: latestApplication.status, application: latestApplication })
    }

    // Approved — pull real order history instead of the old hardcoded ones.
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, order_number, total, status, created_at')
      .eq('user_id', userId)
      .not('status', 'in', `(${EXCLUDED_ORDER_STATUSES.join(',')})`)
      .order('created_at', { ascending: false })

    if (ordersError) {
      req.log?.error({ err: ordersError, userId }, 'Failed to load orders for wholesale account')
      throw ordersError
    }

    const totalOrders = orders?.length || 0
    const totalSpent = (orders || []).reduce((sum, o) => sum + (Number(o.total) || 0), 0)
    const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0
    const lastOrderDate = orders?.[0]?.created_at || null
    const tier = (profile.wholesale_tier || 'bronze') as string
    const discountRate = WHOLESALE_TIER_DISCOUNT_RATES[tier] ?? WHOLESALE_TIER_DISCOUNT_RATES.bronze

    res.json({
      status: 'approved',
      account: {
        companyName: profile.company_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Your Company',
        businessType: profile.business_type || null,
        taxId: profile.tax_id || null,
        tier,
        discountRate,
        creditLimit: Number(profile.credit_limit) || 0,
        paymentTerms: profile.payment_terms || 30,
        totalOrders,
        totalSpent,
        averageOrderValue,
        lastOrderDate,
        contactEmail: profile.email,
        contactPhone: profile.phone || null,
        recentOrders: (orders || []).slice(0, 3).map(o => ({
          id: o.id,
          orderNumber: o.order_number,
          total: Number(o.total) || 0,
          status: o.status,
          date: o.created_at
        }))
      }
    })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error loading wholesale account')
    res.status(500).json({ error: 'Failed to load wholesale account', details: error.message })
  }
})

// -----------------------------------------------------------------------
// POST /api/wholesale/reorder — replay the caller's most recent real order
// -----------------------------------------------------------------------
router.post('/reorder', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user!.sub

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('role, wholesale_status')
      .eq('id', userId)
      .single()
    if (profileError) throw profileError
    if (profile?.role !== 'wholesale' || profile?.wholesale_status !== 'approved') {
      return res.status(403).json({ error: 'Wholesale account required' })
    }

    const { data: lastOrder, error: orderError } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', userId)
      .not('status', 'in', `(${EXCLUDED_ORDER_STATUSES.join(',')})`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (orderError) throw orderError
    if (!lastOrder) {
      return res.status(404).json({ error: 'No previous orders to reorder' })
    }

    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('product_id, quantity, variations')
      .eq('order_id', lastOrder.id)

    if (itemsError) throw itemsError

    const productIds = Array.from(new Set((orderItems || []).map(i => i.product_id).filter(Boolean)))
    const productMap = new Map<string, any>()
    if (productIds.length > 0) {
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('id, name, description, price, images, category, is_active, metadata, sizes, colors')
        .in('id', productIds)
      if (productsError) throw productsError
      for (const p of products || []) productMap.set(p.id, p)
    }

    const items = (orderItems || [])
      .filter(item => item.product_id && productMap.has(item.product_id))
      .map(item => {
        const p = productMap.get(item.product_id)
        return {
          product: {
            id: p.id,
            name: p.name,
            description: p.description || '',
            price: p.price || 0,
            images: p.images || [],
            category: p.category,
            inStock: p.is_active !== false,
            metadata: p.metadata || {},
            sizes: p.sizes || [],
            colors: p.colors || []
          },
          quantity: item.quantity || 1,
          selectedSize: item.variations?.size,
          selectedColor: item.variations?.color
        }
      })

    const skipped = (orderItems?.length || 0) - items.length

    res.json({ items, skipped })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error building wholesale reorder')
    res.status(500).json({ error: 'Failed to build reorder', details: error.message })
  }
})

export default router
