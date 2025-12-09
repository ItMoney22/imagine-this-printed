import { Router, Request, Response, NextFunction } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { sendEmail } from '../../utils/email.js'

const router = Router()

// Admin/Manager role check middleware
async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', req.user.sub)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    res.status(403).json({ error: 'Forbidden: Admin access required' })
    return
  }

  next()
}

/**
 * GET /api/admin/user-products/pending
 * Get all user-submitted products pending approval
 */
router.get('/pending', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select(`
        *,
        product_assets (id, url, kind, is_primary, display_order)
      `)
      .eq('metadata->>user_submitted', 'true')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[admin-approvals] ❌ Error fetching pending:', error)
      return res.status(500).json({ error: 'Failed to fetch pending products' })
    }

    // Get creator info for each product
    const productsWithCreators = await Promise.all(
      (products || []).map(async (product: any) => {
        const creatorId = product.metadata?.creator_id
        if (creatorId) {
          const { data: creator } = await supabase
            .from('user_profiles')
            .select('id, username, email')
            .eq('id', creatorId)
            .single()
          return { ...product, creator }
        }
        return product
      })
    )

    res.json({ products: productsWithCreators })
  } catch (error: any) {
    console.error('[admin-approvals] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/user-products/:id/approve
 * Approve a user-submitted product
 */
router.post('/:id/approve', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const adminId = req.user?.sub

    // Get product
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    if (!product.metadata?.user_submitted) {
      return res.status(400).json({ error: 'This is not a user-submitted product' })
    }

    // Update product status to active
    const { error: updateError } = await supabase
      .from('products')
      .update({
        status: 'active',
        metadata: {
          ...product.metadata,
          approved_at: new Date().toISOString(),
          approved_by: adminId,
        }
      })
      .eq('id', id)

    if (updateError) {
      console.error('[admin-approvals] ❌ Approval error:', updateError)
      return res.status(500).json({ error: 'Failed to approve product' })
    }

    // Get creator info
    const creatorId = product.metadata?.creator_id
    if (creatorId) {
      const { data: creator } = await supabase
        .from('user_profiles')
        .select('email, username')
        .eq('id', creatorId)
        .single()

      // Send approval email
      if (creator?.email) {
        try {
          await sendEmail({
            to: creator.email,
            subject: '🎉 Your Design Has Been Approved! - Imagine This Printed',
            htmlContent: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                  <img src="https://imaginethisprinted.com/logo-tech.png" alt="ITP" style="height: 50px;">
                </div>

                <h1 style="color: #9333EA; text-align: center;">Congratulations! 🎨</h1>

                <p>Hey ${creator.username || 'Creator'},</p>

                <p>Great news! Your design <strong>"${product.name}"</strong> has been approved and is now live on our marketplace!</p>

                <div style="background: linear-gradient(135deg, #9333EA 0%, #EC4899 100%); border-radius: 12px; padding: 20px; margin: 20px 0; color: white;">
                  <h3 style="margin: 0 0 10px 0;">💰 Start Earning!</h3>
                  <p style="margin: 0;">You'll earn <strong>10% royalty</strong> on every sale of your design!</p>
                </div>

                <h3>Next Steps:</h3>
                <ol>
                  <li><strong>Set up your wallet</strong> - Add your payout details to receive earnings</li>
                  <li><strong>Share your design</strong> - Get the word out to maximize sales</li>
                  <li><strong>Create more</strong> - The more designs, the more you can earn!</li>
                </ol>

                <div style="text-align: center; margin: 30px 0;">
                  <a href="https://imaginethisprinted.com/wallet"
                     style="display: inline-block; background: linear-gradient(135deg, #9333EA 0%, #EC4899 100%); color: white; text-decoration: none; padding: 15px 30px; border-radius: 25px; font-weight: bold;">
                    Set Up Your Wallet
                  </a>
                </div>

                <div style="text-align: center; margin: 20px 0;">
                  <a href="https://imaginethisprinted.com/products/${product.slug}"
                     style="color: #9333EA; text-decoration: none; font-weight: bold;">
                    View Your Live Product →
                  </a>
                </div>

                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

                <p style="color: #666; font-size: 14px; text-align: center;">
                  Keep creating amazing designs!<br>
                  - The ITP Team
                </p>
              </div>
            `,
          })
          console.log('[admin-approvals] ✅ Approval email sent to:', creator.email)
        } catch (emailErr: any) {
          console.error('[admin-approvals] ⚠️ Failed to send approval email:', emailErr.message)
        }
      }
    }

    console.log('[admin-approvals] ✅ Product approved:', id)

    res.json({ message: 'Product approved successfully', productId: id })
  } catch (error: any) {
    console.error('[admin-approvals] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/user-products/:id/reject
 * Reject a user-submitted product
 */
router.post('/:id/reject', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { reason } = req.body
    const adminId = req.user?.sub

    // Get product
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()

    if (productError || !product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    // Update product status to rejected
    const { error: updateError } = await supabase
      .from('products')
      .update({
        status: 'rejected',
        metadata: {
          ...product.metadata,
          rejected_at: new Date().toISOString(),
          rejected_by: adminId,
          rejection_reason: reason || 'Does not meet quality standards',
        }
      })
      .eq('id', id)

    if (updateError) {
      console.error('[admin-approvals] ❌ Rejection error:', updateError)
      return res.status(500).json({ error: 'Failed to reject product' })
    }

    // Get creator info and send rejection email
    const creatorId = product.metadata?.creator_id
    if (creatorId) {
      const { data: creator } = await supabase
        .from('user_profiles')
        .select('email, username')
        .eq('id', creatorId)
        .single()

      if (creator?.email) {
        try {
          await sendEmail({
            to: creator.email,
            subject: 'Design Update - Imagine This Printed',
            htmlContent: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="text-align: center; margin-bottom: 30px;">
                  <img src="https://imaginethisprinted.com/logo-tech.png" alt="ITP" style="height: 50px;">
                </div>

                <h1 style="color: #666; text-align: center;">Design Update</h1>

                <p>Hey ${creator.username || 'Creator'},</p>

                <p>Unfortunately, your design <strong>"${product.name}"</strong> wasn't approved for the marketplace at this time.</p>

                ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}

                <div style="background: #f9f9f9; border-radius: 12px; padding: 20px; margin: 20px 0;">
                  <h3 style="margin: 0 0 10px 0;">💡 Don't give up!</h3>
                  <p style="margin: 0;">You can always create a new design. Here are some tips:</p>
                  <ul>
                    <li>Use high-contrast colors for better print quality</li>
                    <li>Keep designs original and unique</li>
                    <li>Avoid copyrighted material</li>
                  </ul>
                </div>

                <div style="text-align: center; margin: 30px 0;">
                  <a href="https://imaginethisprinted.com/create-design"
                     style="display: inline-block; background: linear-gradient(135deg, #9333EA 0%, #EC4899 100%); color: white; text-decoration: none; padding: 15px 30px; border-radius: 25px; font-weight: bold;">
                    Create New Design
                  </a>
                </div>

                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

                <p style="color: #666; font-size: 14px; text-align: center;">
                  Keep creating!<br>
                  - The ITP Team
                </p>
              </div>
            `,
          })
          console.log('[admin-approvals] ✅ Rejection email sent to:', creator.email)
        } catch (emailErr: any) {
          console.error('[admin-approvals] ⚠️ Failed to send rejection email:', emailErr.message)
        }
      }
    }

    console.log('[admin-approvals] ✅ Product rejected:', id)

    res.json({ message: 'Product rejected', productId: id })
  } catch (error: any) {
    console.error('[admin-approvals] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/admin/user-products/creators
 * Get all creators with their products and earnings
 */
router.get('/creators', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    // Get all user-submitted products grouped by creator
    const { data: products } = await supabase
      .from('products')
      .select('id, name, price, status, metadata, created_at')
      .eq('metadata->>user_submitted', 'true')

    // Group by creator
    const creatorMap = new Map<string, any>()

    for (const product of products || []) {
      const creatorId = product.metadata?.creator_id
      if (creatorId) {
        if (!creatorMap.has(creatorId)) {
          creatorMap.set(creatorId, {
            creatorId,
            products: [],
            totalProducts: 0,
            approvedProducts: 0,
            pendingProducts: 0,
          })
        }

        const creator = creatorMap.get(creatorId)
        creator.products.push(product)
        creator.totalProducts++
        if (product.status === 'active') creator.approvedProducts++
        if (product.status === 'pending_approval') creator.pendingProducts++
      }
    }

    // Get creator profiles
    const creatorIds = Array.from(creatorMap.keys())
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, username, email')
      .in('id', creatorIds)

    // Get royalties for each creator
    const { data: royalties } = await supabase
      .from('creator_royalties')
      .select('*')
      .in('creator_id', creatorIds)

    // Combine data
    const creators = creatorIds.map(creatorId => {
      const data = creatorMap.get(creatorId)
      const profile = profiles?.find(p => p.id === creatorId)
      const creatorRoyalties = royalties?.filter(r => r.creator_id === creatorId) || []

      const totalEarnings = creatorRoyalties.reduce((sum, r) => sum + (r.amount_cents || 0), 0)
      const pendingEarnings = creatorRoyalties.filter(r => r.status === 'pending').reduce((sum, r) => sum + (r.amount_cents || 0), 0)
      const paidEarnings = creatorRoyalties.filter(r => r.status === 'paid').reduce((sum, r) => sum + (r.amount_cents || 0), 0)

      return {
        ...data,
        username: profile?.username,
        email: profile?.email,
        totalEarnings: totalEarnings / 100,
        pendingEarnings: pendingEarnings / 100,
        paidEarnings: paidEarnings / 100,
      }
    })

    res.json({ creators })
  } catch (error: any) {
    console.error('[admin-approvals] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/user-products/payout/:creatorId
 * Process payout for a creator
 */
router.post('/payout/:creatorId', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { creatorId } = req.params
    const { amount, method = 'manual' } = req.body
    const adminId = req.user?.sub

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount required' })
    }

    // Get pending royalties for this creator
    const { data: pendingRoyalties } = await supabase
      .from('creator_royalties')
      .select('*')
      .eq('creator_id', creatorId)
      .eq('status', 'pending')

    const totalPending = pendingRoyalties?.reduce((sum, r) => sum + (r.amount_cents || 0), 0) || 0

    if (amount * 100 > totalPending) {
      return res.status(400).json({ error: `Cannot pay more than pending amount ($${totalPending / 100})` })
    }

    // Mark royalties as paid (up to the amount)
    let remainingAmount = amount * 100
    const royaltiesToUpdate: string[] = []

    for (const royalty of pendingRoyalties || []) {
      if (remainingAmount >= royalty.amount_cents) {
        royaltiesToUpdate.push(royalty.id)
        remainingAmount -= royalty.amount_cents
      } else {
        break
      }
    }

    if (royaltiesToUpdate.length > 0) {
      await supabase
        .from('creator_royalties')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          paid_by: adminId,
          payout_method: method,
        })
        .in('id', royaltiesToUpdate)
    }

    // Get creator info for email
    const { data: creator } = await supabase
      .from('user_profiles')
      .select('email, username')
      .eq('id', creatorId)
      .single()

    // Send payout email
    if (creator?.email) {
      try {
        await sendEmail({
          to: creator.email,
          subject: '💰 Payment Sent! - Imagine This Printed',
          htmlContent: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="text-align: center; margin-bottom: 30px;">
                <img src="https://imaginethisprinted.com/logo-tech.png" alt="ITP" style="height: 50px;">
              </div>

              <h1 style="color: #9333EA; text-align: center;">Payment Sent! 💰</h1>

              <p>Hey ${creator.username || 'Creator'},</p>

              <p>We've just sent your creator earnings!</p>

              <div style="background: linear-gradient(135deg, #9333EA 0%, #EC4899 100%); border-radius: 12px; padding: 20px; margin: 20px 0; color: white; text-align: center;">
                <h2 style="margin: 0; font-size: 36px;">$${amount.toFixed(2)}</h2>
                <p style="margin: 5px 0 0 0; opacity: 0.9;">Payment via ${method}</p>
              </div>

              <p>Thank you for being part of the ITP creator community. Keep creating amazing designs!</p>

              <div style="text-align: center; margin: 30px 0;">
                <a href="https://imaginethisprinted.com/wallet"
                   style="display: inline-block; background: linear-gradient(135deg, #9333EA 0%, #EC4899 100%); color: white; text-decoration: none; padding: 15px 30px; border-radius: 25px; font-weight: bold;">
                  View Earnings Dashboard
                </a>
              </div>

              <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

              <p style="color: #666; font-size: 14px; text-align: center;">
                - The ITP Team
              </p>
            </div>
          `,
        })
        console.log('[admin-approvals] ✅ Payout email sent to:', creator.email)
      } catch (emailErr: any) {
        console.error('[admin-approvals] ⚠️ Failed to send payout email:', emailErr.message)
      }
    }

    console.log('[admin-approvals] ✅ Payout processed:', { creatorId, amount })

    res.json({
      message: 'Payout processed successfully',
      amount,
      royaltiesPaid: royaltiesToUpdate.length
    })
  } catch (error: any) {
    console.error('[admin-approvals] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
