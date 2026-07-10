import { Router, Request, Response, NextFunction } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { sendEmail } from '../../utils/email.js'
import { generateSeoPackForProduct } from '../../services/seo-pack.js'

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

    // Get creator info for all products in ONE batched query (was an N+1:
    // a separate user_profiles lookup per pending product).
    const creatorIds = [...new Set(
      (products || []).map((p: any) => p.metadata?.creator_id).filter(Boolean)
    )]
    let creatorMap = new Map<string, any>()
    if (creatorIds.length > 0) {
      const { data: creators } = await supabase
        .from('user_profiles')
        .select('id, username, email')
        .in('id', creatorIds)
      creatorMap = new Map((creators || []).map((c: any) => [c.id, c]))
    }
    const productsWithCreators = (products || []).map((product: any) => {
      const creatorId = product.metadata?.creator_id
      return creatorId ? { ...product, creator: creatorMap.get(creatorId) ?? null } : product
    })

    res.json({ products: productsWithCreators })
  } catch (error: any) {
    console.error('[admin-approvals] ❌ Error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/user-products/:id/approve
 * Approve a user-submitted product with color/size configuration
 */
router.post('/:id/approve', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params
    const { colors, sizes, price, name, finish, addons, colorMode, print_locations } = req.body
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

    // Generation-completeness gate: a design only goes 'active' (visible on the
    // products tab) once all its expected generations exist. Otherwise it lands
    // as 'incomplete' and stays off the storefront. (David: "before they hit the
    // products tab they need to have all generations done, or be marked incomplete.")
    const tmpl = String(product.metadata?.product_template || product.metadata?.category || '').toLowerCase()
    const kind = (tmpl.includes('metal') || tmpl.includes('wall')) ? 'metal'
      : (tmpl.includes('3d') || tmpl.includes('toy')) ? '3d' : 'apparel'
    const assets = (product.metadata?.assets && typeof product.metadata.assets === 'object') ? product.metadata.assets : {}
    const hasMockup = !!(product.metadata?.mockup_url || (Array.isArray(assets.mockups) && assets.mockups.length))
    // Direct-print products (Merch Studio publishes via POST
    // /api/storefront/products) arrive with print-ready 300-DPI files —
    // metadata.print_files — so the AI-generation artifacts (halftone) don't
    // exist and must not hold up approval.
    const isDirectPrint = !!product.metadata?.print_files?.front
    const missingGenerations: string[] = []
    if (!assets.clean && !(Array.isArray(product.images) && product.images.length)) missingGenerations.push('clean design')
    if (!hasMockup) missingGenerations.push('mockup')
    if (kind === 'apparel' && !isDirectPrint) {
      if (!assets.halftone) missingGenerations.push('halftone')
      if (!assets.dtf) missingGenerations.push('DTF print-ready')
    }
    // Admin can still push a product live despite missing gens via { force: true }.
    const generationStatus = (missingGenerations.length > 0 && !req.body?.force) ? 'incomplete' : 'active'

    // Produce a watermarked PUBLIC display variant of the clean art (the clean
    // original stays gated for paid digital delivery). Best-effort — never block
    // approval on watermarking.
    let displayUrl: string | undefined
    const cleanSource = assets.clean || (Array.isArray(product.images) ? product.images[0] : undefined)
    if (cleanSource) {
      try {
        const { watermarkUrlToGcs } = await import('../../services/watermark.js')
        displayUrl = await watermarkUrlToGcs(cleanSource, `watermarked/${id}-display-${Date.now()}.png`)
      } catch (e: any) {
        console.error('[admin-approvals] ⚠️ watermark failed (display falls back to clean art):', e?.message)
      }
    }

    // Build update object with colors, sizes, and price.
    // Liveness gate reconciliation (2026-07-10): the storefront catalog +
    // checkout require BOTH status='active' AND is_active=true (is_active
    // defaults true in the live DB, so status alone never gated anything).
    // Approval must therefore set both flags together.
    const updateData: any = {
      status: generationStatus,
      is_active: generationStatus === 'active',
      metadata: {
        ...product.metadata,
        approved_at: new Date().toISOString(),
        approved_by: adminId,
        missing_generations: missingGenerations,
        // Role-tagged assets: `display` is the watermarked public hero; `clean`
        // stays the un-watermarked deliverable for paid digital download.
        assets: {
          ...assets,
          ...(displayUrl ? { display: displayUrl } : {}),
        },
        // Product-type-specific config (metal finish, add-ons) lives in metadata.
        ...(finish ? { finish } : {}),
        ...(Array.isArray(addons) ? { addons } : {}),
        ...(colorMode ? { color_mode: colorMode } : {}),
      }
    }

    // Auto-enable a digital download product when the design carries
    // deliverables (clean / halftone / DTF). Priced in ITC at checkout; admin
    // can adjust digital_price later. Default $9.99 if unset.
    const hasDeliverables = !!(assets.clean || assets.halftone || assets.dtf)
    if (hasDeliverables) {
      updateData.product_type = 'both'
      if (!product.digital_price || Number(product.digital_price) <= 0) {
        updateData.digital_price = 9.99
      }
    }

    // Set the canonical `category` column so the storefront classifies the
    // product correctly. Metal/3D submissions came in with a null category and
    // were defaulting to T-Shirts everywhere (catalog filter, product card,
    // product page). Derived from `kind` (computed above from product_template).
    if (kind === 'metal') {
      updateData.category = 'metal-art'
    } else if (kind === '3d') {
      updateData.category = '3d-prints'
    } else if (!product.category) {
      updateData.category = 'shirts'
    }

    // products.print_locations CHECK (products_print_locations_valid) requires
    // >= 1 placement for any row with category 'shirts'. A shirt reaching approval
    // with an empty array — a legacy submission, or one whose category we just
    // defaulted to 'shirts' above — would make this UPDATE fail at the DB. So when
    // the product will be a shirt, guarantee a valid array: prefer admin-supplied
    // print_locations, else the product's existing ones, else front print.
    const finalCategory = updateData.category ?? product.category
    if (finalCategory === 'shirts') {
      const VALID_PRINT_LOCATIONS = ['front_image', 'back_image', 'pocket']
      const requested = Array.from(new Set(
        (Array.isArray(print_locations) ? print_locations : [])
          .filter((v: unknown): v is string => typeof v === 'string' && VALID_PRINT_LOCATIONS.includes(v))
      ))
      const existing = (Array.isArray(product.print_locations) ? product.print_locations : [])
        .filter((v: unknown): v is string => typeof v === 'string' && VALID_PRINT_LOCATIONS.includes(v))
      updateData.print_locations = requested.length ? requested : (existing.length ? existing : ['front_image'])
    }

    // Admin can tweak the AI-generated title at approval time.
    if (name && typeof name === 'string' && name.trim()) {
      updateData.name = name.trim()
    }

    // Add colors if provided
    if (colors && Array.isArray(colors) && colors.length > 0) {
      updateData.colors = colors
    }

    // Add sizes if provided
    if (sizes && Array.isArray(sizes) && sizes.length > 0) {
      updateData.sizes = sizes
    }

    // Update price if provided (in dollars — products.price column is dollars).
    // Defensive: if a caller mistakenly sends a giant integer (e.g., legacy clients
    // sending dollars * 100), normalize back to dollars by dividing by 100.
    if (price && typeof price === 'number' && price > 0) {
      const priceDollars = price > 1000 ? price / 100 : price
      updateData.price = priceDollars
    }

    // Update product status to active with configuration
    const { error: updateError } = await supabase
      .from('products')
      .update(updateData)
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
                  <img src="https://imaginethisprinted.com/mr-imagine/mr-imagine-waist-up.png" alt="Mr. Imagine" style="height: 60px;">
                </div>

                <h1 style="color: #9333EA; text-align: center;">Congratulations! 🎨</h1>

                <p>Hey ${creator.username || 'Creator'},</p>

                <p>Great news! Your design <strong>"${product.name}"</strong> has been approved and is now live on our marketplace!</p>

                <div style="background: linear-gradient(135deg, #9333EA 0%, #EC4899 100%); border-radius: 12px; padding: 20px; margin: 20px 0; color: white;">
                  <h3 style="margin: 0 0 10px 0;">💰 Start Earning!</h3>
                  <p style="margin: 0;">You'll earn <strong>15% royalty</strong> on every sale of your design!</p>
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
                  <a href="https://imaginethisprinted.com/product/${id}"
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

    console.log(`[admin-approvals] ✅ Product approved (status=${generationStatus}${missingGenerations.length ? `, missing: ${missingGenerations.join(', ')}` : ''}):`, id)

    // Fully approved and live → generate the SEO pack (meta title/description,
    // keywords, social hooks). Fire-and-forget: approval must not wait on the
    // model call; the hourly worker sweep is the catch-all if this fails.
    if (generationStatus === 'active') {
      void generateSeoPackForProduct(id).catch(err =>
        console.error('[admin-approvals] SEO pack generation failed:', err?.message || err))
    }

    res.json({
      message: generationStatus === 'active'
        ? 'Product approved and published'
        : `Saved as INCOMPLETE — missing: ${missingGenerations.join(', ')}. Generate these (or re-approve with force) before it goes live.`,
      productId: id,
      status: generationStatus,
      missingGenerations,
    })
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
        // is_active defaults true — clear it so a rejected product can never
        // satisfy the storefront's sellable gate.
        is_active: false,
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
                  <img src="https://imaginethisprinted.com/mr-imagine/mr-imagine-waist-up.png" alt="Mr. Imagine" style="height: 60px;">
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

    // Get royalties for each creator. The LIVE table is `user_product_royalties`
    // (keyed by user_id; status lifecycle pending -> credited as ITC is
    // auto-credited to the creator's wallet on each sale). The old code queried a
    // nonexistent `creator_royalties` table by creator_id with status 'paid', so
    // every creator's earnings always read $0.
    const { data: royalties } = await supabase
      .from('user_product_royalties')
      .select('*')
      .in('user_id', creatorIds)

    // Combine data
    const creators = creatorIds.map(creatorId => {
      const data = creatorMap.get(creatorId)
      const profile = profiles?.find(p => p.id === creatorId)
      const creatorRoyalties = royalties?.filter(r => r.user_id === creatorId) || []

      const totalEarnings = creatorRoyalties.reduce((sum, r) => sum + (r.amount_cents || 0), 0)
      const pendingEarnings = creatorRoyalties.filter(r => r.status === 'pending').reduce((sum, r) => sum + (r.amount_cents || 0), 0)
      const paidEarnings = creatorRoyalties.filter(r => r.status === 'credited').reduce((sum, r) => sum + (r.amount_cents || 0), 0)

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

    // NOTE (P4 audit): this endpoint is not wired to any UI and queries the
    // nonexistent `creator_royalties` table — so it always finds $0 pending and
    // rejects. It implements a MANUAL cash-payout / mark-'paid' flow that does
    // not match the live model: royalties live in `user_product_royalties` and
    // are AUTO-CREDITED as ITC on sale (status pending -> credited). Resolve as a
    // design decision (remove this endpoint, or rebuild it as a real cash-out
    // against user_product_royalties) before wiring any "pay creator" button.
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
                <img src="https://imaginethisprinted.com/mr-imagine/mr-imagine-waist-up.png" alt="Mr. Imagine" style="height: 60px;">
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
