/**
 * User Royalty Service
 * Handles 10% ITC royalty payments for user-generated products
 */

import { supabase } from '../lib/supabase.js'

const ROYALTY_PERCENTAGE = 0.15 // 15% of sale price for creators
const ITC_CONVERSION_RATE = 1 // 1 cent = 1 ITC

export interface RoyaltyPayment {
  userId: string
  productId: string
  orderId: string
  salePriceCents: number
  royaltyAmountCents: number
  itcAmount: number
}

/**
 * Process royalty payment when a user-generated product is sold
 * Called from Stripe webhook when payment succeeds
 */
export async function processRoyaltyPayment(payment: RoyaltyPayment): Promise<void> {
  console.log('[royalties] 💰 Processing royalty payment:', {
    userId: payment.userId,
    productId: payment.productId,
    orderId: payment.orderId,
    royaltyAmount: payment.royaltyAmountCents,
    itcAmount: payment.itcAmount
  })

  try {
    // 1. Create royalty record
    const { data: royalty, error: royaltyError } = await supabase
      .from('user_product_royalties')
      .insert({
        user_id: payment.userId,
        product_id: payment.productId,
        order_id: payment.orderId,
        amount_cents: payment.royaltyAmountCents,
        itc_amount: payment.itcAmount,
        status: 'pending',
        metadata: {
          sale_price_cents: payment.salePriceCents,
          royalty_percentage: ROYALTY_PERCENTAGE,
        }
      })
      .select()
      .single()

    if (royaltyError) {
      console.error('[royalties] ❌ Error creating royalty record:', royaltyError)
      throw royaltyError
    }

    console.log('[royalties] ✅ Royalty record created:', royalty.id)

    // 2. Credit ITC to user's wallet
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', payment.userId)
      .single()

    if (walletError || !wallet) {
      console.error('[royalties] ❌ User wallet not found:', walletError)
      throw new Error('User wallet not found')
    }

    const newBalance = (wallet.itc_balance || 0) + payment.itcAmount

    const { error: updateError } = await supabase
      .from('user_wallets')
      .update({
        itc_balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', payment.userId)

    if (updateError) {
      console.error('[royalties] ❌ Error updating wallet:', updateError)
      throw updateError
    }

    console.log('[royalties] ✅ ITC credited to wallet:', {
      userId: payment.userId,
      previousBalance: wallet.itc_balance,
      newBalance,
      credited: payment.itcAmount
    })

    // 3. Mark royalty as credited
    const { error: statusError } = await supabase
      .from('user_product_royalties')
      .update({
        status: 'credited',
        credited_at: new Date().toISOString()
      })
      .eq('id', royalty.id)

    if (statusError) {
      console.error('[royalties] ⚠️ Error updating royalty status:', statusError)
      // Not critical, payment already processed
    }

    console.log('[royalties] 🎉 Royalty payment complete!')

  } catch (error: any) {
    console.error('[royalties] ❌ Failed to process royalty:', error.message)

    // Mark as failed if we have royalty ID
    // Note: This is best-effort, might not have royalty ID if creation failed
    throw error
  }
}

/**
 * Calculate royalty amount for a product sale
 */
export function calculateRoyalty(salePriceCents: number): {
  royaltyAmountCents: number
  itcAmount: number
} {
  const royaltyAmountCents = Math.floor(salePriceCents * ROYALTY_PERCENTAGE)
  const itcAmount = royaltyAmountCents * ITC_CONVERSION_RATE

  return { royaltyAmountCents, itcAmount }
}

/**
 * Get royalty earnings for a user
 */
export async function getUserRoyalties(userId: string): Promise<{
  totalEarnedCents: number
  totalItcEarned: number
  pendingCount: number
  creditedCount: number
  royalties: any[]
}> {
  const { data: royalties, error } = await supabase
    .from('user_product_royalties')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[royalties] ❌ Error fetching user royalties:', error)
    throw error
  }

  const totalEarnedCents = royalties
    .filter(r => r.status === 'credited')
    .reduce((sum, r) => sum + r.amount_cents, 0)

  const totalItcEarned = royalties
    .filter(r => r.status === 'credited')
    .reduce((sum, r) => sum + r.itc_amount, 0)

  const pendingCount = royalties.filter(r => r.status === 'pending').length
  const creditedCount = royalties.filter(r => r.status === 'credited').length

  return {
    totalEarnedCents,
    totalItcEarned,
    pendingCount,
    creditedCount,
    royalties
  }
}

/**
 * Get royalty stats for a product
 */
export async function getProductRoyalties(productId: string): Promise<{
  totalSales: number
  totalRoyaltiesCents: number
  creator: any | null
}> {
  const { data: royalties, error } = await supabase
    .from('user_product_royalties')
    .select('*, user_profiles!user_id(*)')
    .eq('product_id', productId)
    .eq('status', 'credited')

  if (error) {
    console.error('[royalties] ❌ Error fetching product royalties:', error)
    throw error
  }

  const totalSales = royalties.length
  const totalRoyaltiesCents = royalties.reduce((sum, r) => sum + r.amount_cents, 0)
  const creator = royalties.length > 0 ? royalties[0].user_profiles : null

  return {
    totalSales,
    totalRoyaltiesCents,
    creator
  }
}
