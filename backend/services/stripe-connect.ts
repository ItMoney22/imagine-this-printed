/**
 * Stripe Connect Service
 * Handles ITC cash-out via Stripe Connect Express accounts with instant payouts
 */

import Stripe from 'stripe'
import { supabase } from '../lib/supabase.js'

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia'
})

// =============================================================================
// Constants
// =============================================================================

export const ITC_TO_USD = 0.01 // 1 ITC = $0.01
export const MINIMUM_CASHOUT_ITC = 5000 // $50 minimum
export const PLATFORM_FEE_PERCENT = 7 // 7% platform fee
export const INSTANT_PAYOUT_FEE_PERCENT = 1.5 // Stripe charges ~1.5% for instant
export const INSTANT_PAYOUT_MIN_FEE = 0.50 // Minimum $0.50 fee

// =============================================================================
// Interfaces
// =============================================================================

export interface ConnectAccountStatus {
  hasAccount: boolean
  accountId: string | null
  onboardingComplete: boolean
  payoutsEnabled: boolean
  instantPayoutsEnabled: boolean
  externalAccountLast4: string | null
  externalAccountBrand: string | null
  requiresAction: boolean
  currentlyDue: string[]
}

export interface CashoutCalculation {
  amountItc: number
  grossUsd: number
  platformFeeUsd: number
  platformFeePercent: number
  instantFeeUsd: number
  netUsd: number
  payoutType: 'instant' | 'standard'
}

export interface CashoutResult {
  success: boolean
  payoutId?: string
  transferId?: string
  error?: string
  cashoutRequestId?: string
}

// =============================================================================
// Account Management
// =============================================================================

/**
 * Create a new Stripe Connect Express account for a user
 */
export async function createExpressAccount(
  userId: string,
  email: string
): Promise<Stripe.Account> {
  console.log('[stripe-connect] Creating Express account for user:', userId)

  // Create Stripe Express account
  const account = await stripe.accounts.create({
    type: 'express',
    country: 'US',
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    settings: {
      payouts: {
        schedule: { interval: 'manual' }, // We control payouts
      },
    },
    metadata: {
      userId,
      platform: 'imaginethisprinted',
      purpose: 'itc_cashout'
    }
  })

  console.log('[stripe-connect] Express account created:', account.id)

  // Store in database
  const { error: insertError } = await supabase
    .from('stripe_connect_accounts')
    .insert({
      user_id: userId,
      stripe_account_id: account.id,
      account_type: 'express',
      country: 'US'
    })

  if (insertError) {
    console.error('[stripe-connect] Failed to save account to database:', insertError)
    // Try to clean up the Stripe account
    try {
      await stripe.accounts.del(account.id)
    } catch (deleteError) {
      console.error('[stripe-connect] Failed to delete orphaned Stripe account:', deleteError)
    }
    throw new Error('Failed to save Connect account')
  }

  // Update user_profiles for quick lookup
  await supabase
    .from('user_profiles')
    .update({ stripe_account_id: account.id })
    .eq('id', userId)

  return account
}

/**
 * Create an account onboarding link for Stripe-hosted onboarding
 */
export async function createOnboardingLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<string> {
  console.log('[stripe-connect] Creating onboarding link for account:', accountId)

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
    collect: 'eventually_due'
  })

  return accountLink.url
}

/**
 * Get the current status of a user's Connect account
 */
export async function getConnectAccountStatus(
  userId: string
): Promise<ConnectAccountStatus> {
  // Check local database first
  const { data: localAccount } = await supabase
    .from('stripe_connect_accounts')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (!localAccount) {
    return {
      hasAccount: false,
      accountId: null,
      onboardingComplete: false,
      payoutsEnabled: false,
      instantPayoutsEnabled: false,
      externalAccountLast4: null,
      externalAccountBrand: null,
      requiresAction: false,
      currentlyDue: []
    }
  }

  try {
    // Fetch latest from Stripe
    const account = await stripe.accounts.retrieve(localAccount.stripe_account_id)

    // Check instant payout eligibility
    let instantEnabled = false
    let externalAccount = null

    if (account.external_accounts?.data?.length) {
      // Look for a debit card that supports instant payouts
      for (const ea of account.external_accounts.data) {
        if (ea.object === 'card') {
          const card = ea as Stripe.Card
          if ((card as any).available_payout_methods?.includes('instant')) {
            instantEnabled = true
            externalAccount = card
            break
          }
          // If no instant-eligible card found, use first card
          if (!externalAccount) {
            externalAccount = card
          }
        }
      }

      // If no cards, check for bank accounts (standard payouts only)
      if (!externalAccount && account.external_accounts.data.length > 0) {
        const firstAccount = account.external_accounts.data[0]
        if (firstAccount.object === 'bank_account') {
          externalAccount = firstAccount as Stripe.BankAccount
        }
      }
    }

    // Update local database with latest status
    await supabase.from('stripe_connect_accounts').update({
      onboarding_complete: account.details_submitted,
      details_submitted: account.details_submitted,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      instant_payouts_enabled: instantEnabled,
      currently_due: account.requirements?.currently_due || [],
      eventually_due: account.requirements?.eventually_due || [],
      past_due: account.requirements?.past_due || [],
      disabled_reason: account.requirements?.disabled_reason || null,
      has_external_account: !!externalAccount,
      external_account_last4: externalAccount?.last4 || null,
      external_account_brand: (externalAccount as any)?.brand || null,
      external_account_type: externalAccount?.object || null,
      updated_at: new Date().toISOString()
    }).eq('user_id', userId)

    return {
      hasAccount: true,
      accountId: account.id,
      onboardingComplete: account.details_submitted || false,
      payoutsEnabled: account.payouts_enabled || false,
      instantPayoutsEnabled: instantEnabled,
      externalAccountLast4: externalAccount?.last4 || null,
      externalAccountBrand: (externalAccount as any)?.brand || null,
      requiresAction: (account.requirements?.currently_due?.length || 0) > 0,
      currentlyDue: account.requirements?.currently_due || []
    }
  } catch (error: any) {
    console.error('[stripe-connect] Error fetching account from Stripe:', error)

    // Return cached data from database
    return {
      hasAccount: true,
      accountId: localAccount.stripe_account_id,
      onboardingComplete: localAccount.onboarding_complete,
      payoutsEnabled: localAccount.payouts_enabled,
      instantPayoutsEnabled: localAccount.instant_payouts_enabled,
      externalAccountLast4: localAccount.external_account_last4,
      externalAccountBrand: localAccount.external_account_brand,
      requiresAction: (localAccount.currently_due?.length || 0) > 0,
      currentlyDue: localAccount.currently_due || []
    }
  }
}

// =============================================================================
// Cashout Calculations
// =============================================================================

/**
 * Calculate cashout amounts and fees
 */
export function calculateCashout(
  amountItc: number,
  useInstant: boolean = true
): CashoutCalculation {
  const grossUsd = amountItc * ITC_TO_USD
  const platformFeeUsd = Math.round((grossUsd * (PLATFORM_FEE_PERCENT / 100)) * 100) / 100

  let instantFeeUsd = 0
  if (useInstant) {
    instantFeeUsd = Math.max(
      Math.round((grossUsd * (INSTANT_PAYOUT_FEE_PERCENT / 100)) * 100) / 100,
      INSTANT_PAYOUT_MIN_FEE
    )
  }

  const netUsd = Math.round((grossUsd - platformFeeUsd - instantFeeUsd) * 100) / 100

  return {
    amountItc,
    grossUsd: Math.round(grossUsd * 100) / 100,
    platformFeeUsd,
    platformFeePercent: PLATFORM_FEE_PERCENT,
    instantFeeUsd,
    netUsd,
    payoutType: useInstant ? 'instant' : 'standard'
  }
}

// =============================================================================
// Payout Processing
// =============================================================================

/**
 * Process an instant payout for ITC cash-out
 */
export async function processInstantPayout(
  userId: string,
  amountItc: number
): Promise<CashoutResult> {
  console.log('[stripe-connect] Processing payout for user:', userId, 'amount:', amountItc)

  // 1. Get connect account
  const { data: connectAccount, error: accountError } = await supabase
    .from('stripe_connect_accounts')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (accountError || !connectAccount) {
    return { success: false, error: 'No Stripe Connect account found. Please set up cash-out first.' }
  }

  if (!connectAccount.payouts_enabled) {
    return { success: false, error: 'Payouts not enabled. Please complete onboarding first.' }
  }

  // 2. Check wallet balance
  const { data: wallet, error: walletError } = await supabase
    .from('user_wallets')
    .select('itc_balance')
    .eq('user_id', userId)
    .single()

  if (walletError || !wallet) {
    return { success: false, error: 'Wallet not found' }
  }

  if (wallet.itc_balance < amountItc) {
    return { success: false, error: 'Insufficient ITC balance' }
  }

  if (amountItc < MINIMUM_CASHOUT_ITC) {
    return {
      success: false,
      error: `Minimum cashout is ${MINIMUM_CASHOUT_ITC} ITC ($${MINIMUM_CASHOUT_ITC * ITC_TO_USD})`
    }
  }

  // 3. Calculate amounts
  const useInstant = connectAccount.instant_payouts_enabled
  const calculation = calculateCashout(amountItc, useInstant)
  const amountCents = Math.round(calculation.netUsd * 100)

  if (amountCents < 100) {
    return { success: false, error: 'Net payout amount is too small. Minimum payout is $1.00' }
  }

  try {
    // 4. Deduct ITC from wallet
    const newBalance = wallet.itc_balance - amountItc
    const { error: deductError } = await supabase
      .from('user_wallets')
      .update({
        itc_balance: newBalance,
        last_itc_activity: new Date().toISOString()
      })
      .eq('user_id', userId)

    if (deductError) {
      throw new Error('Failed to deduct ITC from wallet')
    }

    // 5. Create cashout request record
    const { data: cashoutRequest, error: insertError } = await supabase
      .from('itc_cashout_requests')
      .insert({
        user_id: userId,
        stripe_connect_account_id: connectAccount.id,
        amount_itc: amountItc,
        gross_amount_usd: calculation.grossUsd,
        platform_fee_usd: calculation.platformFeeUsd,
        platform_fee_percent: calculation.platformFeePercent,
        instant_fee_usd: calculation.instantFeeUsd,
        net_amount_usd: calculation.netUsd,
        payout_type: calculation.payoutType,
        status: 'processing'
      })
      .select()
      .single()

    if (insertError || !cashoutRequest) {
      // Rollback wallet
      await supabase
        .from('user_wallets')
        .update({ itc_balance: wallet.itc_balance })
        .eq('user_id', userId)
      throw new Error('Failed to create cashout request')
    }

    // 6. Transfer funds to connected account
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: 'usd',
      destination: connectAccount.stripe_account_id,
      metadata: {
        cashout_request_id: cashoutRequest.id,
        user_id: userId,
        itc_amount: amountItc.toString(),
        gross_usd: calculation.grossUsd.toString(),
        platform_fee: calculation.platformFeeUsd.toString(),
        instant_fee: calculation.instantFeeUsd.toString()
      }
    })

    console.log('[stripe-connect] Transfer created:', transfer.id)

    // 7. Create payout on the connected account
    const payoutMethod = useInstant ? 'instant' : 'standard'
    const payout = await stripe.payouts.create(
      {
        amount: amountCents,
        currency: 'usd',
        method: payoutMethod,
        metadata: {
          cashout_request_id: cashoutRequest.id,
          transfer_id: transfer.id
        }
      },
      { stripeAccount: connectAccount.stripe_account_id }
    )

    console.log('[stripe-connect] Payout created:', payout.id, 'status:', payout.status)

    // 8. Update cashout request with Stripe IDs
    await supabase
      .from('itc_cashout_requests')
      .update({
        stripe_transfer_id: transfer.id,
        stripe_payout_id: payout.id,
        status: payout.status === 'paid' ? 'paid' : 'processing',
        processed_at: new Date().toISOString()
      })
      .eq('id', cashoutRequest.id)

    // 9. Log ITC transaction
    await supabase.from('itc_transactions').insert({
      user_id: userId,
      type: 'cashout',
      amount: -amountItc,
      balance_after: newBalance,
      usd_value: calculation.netUsd,
      reason: `Cash out ${amountItc} ITC for $${calculation.netUsd.toFixed(2)} via ${payoutMethod} payout`,
      reference_id: cashoutRequest.id,
      metadata: {
        gross_usd: calculation.grossUsd,
        platform_fee: calculation.platformFeeUsd,
        instant_fee: calculation.instantFeeUsd,
        net_usd: calculation.netUsd,
        payout_id: payout.id,
        transfer_id: transfer.id
      }
    })

    return {
      success: true,
      payoutId: payout.id,
      transferId: transfer.id,
      cashoutRequestId: cashoutRequest.id
    }

  } catch (error: any) {
    console.error('[stripe-connect] Payout failed:', error)

    // Rollback: restore ITC balance
    await supabase
      .from('user_wallets')
      .update({ itc_balance: wallet.itc_balance })
      .eq('user_id', userId)

    return { success: false, error: error.message || 'Payout processing failed' }
  }
}

// =============================================================================
// Webhook Handlers
// =============================================================================

/**
 * Handle account.updated webhook from Stripe Connect
 */
export async function handleConnectAccountUpdate(
  account: Stripe.Account
): Promise<void> {
  console.log('[stripe-connect] Handling account update:', account.id)

  // Check instant payout eligibility
  let instantEnabled = false
  let externalAccount = null

  if (account.external_accounts?.data?.length) {
    for (const ea of account.external_accounts.data) {
      if (ea.object === 'card') {
        const card = ea as Stripe.Card
        if ((card as any).available_payout_methods?.includes('instant')) {
          instantEnabled = true
          externalAccount = card
          break
        }
        if (!externalAccount) {
          externalAccount = card
        }
      }
    }
  }

  await supabase
    .from('stripe_connect_accounts')
    .update({
      onboarding_complete: account.details_submitted,
      details_submitted: account.details_submitted,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      instant_payouts_enabled: instantEnabled,
      currently_due: account.requirements?.currently_due || [],
      eventually_due: account.requirements?.eventually_due || [],
      past_due: account.requirements?.past_due || [],
      disabled_reason: account.requirements?.disabled_reason || null,
      has_external_account: !!externalAccount,
      external_account_last4: externalAccount?.last4 || null,
      external_account_brand: (externalAccount as any)?.brand || null,
      external_account_type: externalAccount?.object || null,
      updated_at: new Date().toISOString()
    })
    .eq('stripe_account_id', account.id)

  console.log('[stripe-connect] Account status updated:', {
    accountId: account.id,
    detailsSubmitted: account.details_submitted,
    payoutsEnabled: account.payouts_enabled,
    instantEnabled
  })
}

/**
 * Handle payout.paid webhook - mark cashout as completed
 */
export async function handlePayoutPaid(
  payout: Stripe.Payout,
  connectedAccountId: string
): Promise<void> {
  console.log('[stripe-connect] Payout paid:', payout.id)

  const cashoutRequestId = payout.metadata?.cashout_request_id
  if (cashoutRequestId) {
    await supabase
      .from('itc_cashout_requests')
      .update({
        status: 'paid',
        arrived_at: new Date().toISOString()
      })
      .eq('id', cashoutRequestId)

    console.log('[stripe-connect] Cashout request marked as paid:', cashoutRequestId)
  }
}

/**
 * Handle payout.failed webhook - refund ITC to user
 */
export async function handlePayoutFailed(
  payout: Stripe.Payout,
  connectedAccountId: string
): Promise<void> {
  console.log('[stripe-connect] Payout failed:', payout.id, payout.failure_code)

  const cashoutRequestId = payout.metadata?.cashout_request_id
  if (!cashoutRequestId) {
    console.warn('[stripe-connect] No cashout_request_id in payout metadata')
    return
  }

  // Get the request to refund ITC
  const { data: request } = await supabase
    .from('itc_cashout_requests')
    .select('user_id, amount_itc')
    .eq('id', cashoutRequestId)
    .single()

  if (!request) {
    console.error('[stripe-connect] Cashout request not found:', cashoutRequestId)
    return
  }

  // Refund ITC to wallet
  const { data: wallet } = await supabase
    .from('user_wallets')
    .select('itc_balance')
    .eq('user_id', request.user_id)
    .single()

  if (wallet) {
    const refundedBalance = wallet.itc_balance + request.amount_itc

    await supabase
      .from('user_wallets')
      .update({
        itc_balance: refundedBalance,
        last_itc_activity: new Date().toISOString()
      })
      .eq('user_id', request.user_id)

    // Log refund transaction
    await supabase.from('itc_transactions').insert({
      user_id: request.user_id,
      type: 'refund',
      amount: request.amount_itc,
      balance_after: refundedBalance,
      reason: `Cashout failed - ${request.amount_itc} ITC refunded`,
      reference_id: cashoutRequestId,
      metadata: {
        failure_code: payout.failure_code,
        failure_message: payout.failure_message,
        payout_id: payout.id
      }
    })

    console.log('[stripe-connect] ITC refunded to user:', request.user_id, 'amount:', request.amount_itc)
  }

  // Update request status
  await supabase
    .from('itc_cashout_requests')
    .update({
      status: 'failed',
      failure_code: payout.failure_code,
      failure_message: payout.failure_message
    })
    .eq('id', cashoutRequestId)
}
