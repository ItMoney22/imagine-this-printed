/**
 * Proof that a purchase through a store owner's link pays her cut (task 1a699ba8, Crystal).
 *
 * Runs the REAL checkout route in-process (POST /api/stripe/checkout-payment-intent) as a guest
 * who came through the link, then the REAL paid-order step (payStoreReferralCut), then reads the
 * transfer back from Stripe. No email, no team alert, no print job: only the claim UPDATE that
 * applyPaidCheckoutOrder makes, then the referral step. The order rows are deleted at the end.
 *
 * Two modes:
 *   TEST (default): Stripe TEST mode end to end. Needs STRIPE_TEST_SECRET_KEY_ITP (sk_test_,
 *     KEY card 8144ed23). Makes a test connected account standing in for hers, a proof store row
 *     pointing at it (10%), pays with the 4242 test card, checks the transfer reached that
 *     account, refunds, checks the transfer was reversed, then deletes the proof rows.
 *   --checkout-only: LIVE key, her real store code (CRYSTAL). Stops before payment: proves the
 *     checkout stamps her link on the order, then cancels the PaymentIntent (no money moves) and
 *     deletes the draft order.
 *
 *   npx tsx --env-file="D:/Projects for MetaSphere/imagine-this-printed/backend/.env" \
 *     --env-file="D:/Projects for MetaSphere/imagine-this-printed/.env.local" \
 *     backend/scripts/store-referral-test-proof.ts [--checkout-only]
 */
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import type { AddressInfo } from 'node:net'
import Stripe from 'stripe'

const CHECKOUT_ONLY = process.argv.includes('--checkout-only')
const PRODUCT = { id: 'b4cb3371-ffb0-4c4a-9f71-c7ce2dd66ed7', name: 'Too Cute To Spook Ghost T-Shirt', price: 25 }
const BUYER_EMAIL = 'qa+referral-proof-1a699ba8@imaginethisprinted.com'
const PROOF_DIR = 'E:/memory/watchtower/projects/imagine-this-printed/2026-10-26-1a699ba8-crystal-referral'

const testKey = process.env.STRIPE_TEST_SECRET_KEY_ITP || ''
if (!CHECKOUT_ONLY) {
  if (!testKey.startsWith('sk_test_')) {
    console.error('STRIPE_TEST_SECRET_KEY_ITP (sk_test_...) is missing: KEY card 8144ed23. Nothing was run.')
    process.exit(2)
  }
  // Every module below builds its Stripe client from this at import time.
  process.env.STRIPE_SECRET_KEY = testKey
}
const key = process.env.STRIPE_SECRET_KEY || ''
const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' })
const mode = key.startsWith('sk_test_') ? 'test' : 'live'
if (!CHECKOUT_ONLY && mode !== 'test') throw new Error('refusing: the full proof only runs in Stripe test mode')

const { supabase } = await import('../lib/supabase.js')
const { default: stripeRouter } = await import('../routes/stripe.js')
const { payStoreReferralCut, reverseStoreReferralCut } = await import('../services/store-referral.js')

const log = { info: (o: any, m?: string) => console.log('  ·', m ?? '', JSON.stringify(o)), warn: console.warn, error: console.error }
const proof: Record<string, any> = { task: '1a699ba8', mode, checkoutOnly: CHECKOUT_ONLY, at: new Date().toISOString() }
const cleanup: Array<() => Promise<unknown>> = []

async function waitForTransfers(accountId: string): Promise<string> {
  for (let i = 0; i < 15; i++) {
    const a = await stripe.accounts.retrieve(accountId)
    if (a.capabilities?.transfers === 'active') return 'active'
    await new Promise(r => setTimeout(r, 2000))
  }
  return (await stripe.accounts.retrieve(accountId)).capabilities?.transfers ?? 'unknown'
}

try {
  // 1. Whose link: her real code (live, no payment), or a proof store on a test account.
  let code = 'CRYSTAL'
  let accountId: string | null = null
  if (!CHECKOUT_ONLY) {
    const account = await stripe.accounts.create({
      country: 'US',
      email: BUYER_EMAIL.replace('referral-proof', 'referral-seller'),
      controller: { stripe_dashboard: { type: 'none' }, fees: { payer: 'application' }, losses: { payments: 'application' }, requirement_collection: 'application' },
      capabilities: { transfers: { requested: true } },
      business_type: 'individual',
      individual: {
        first_name: 'Crystal', last_name: 'Test', email: BUYER_EMAIL.replace('referral-proof', 'referral-seller'), phone: '+14015550123',
        dob: { day: 1, month: 1, year: 1901 }, id_number: '000000000', ssn_last_4: '0000',
        address: { line1: 'address_full_match', city: 'Providence', state: 'RI', postal_code: '02903', country: 'US' }
      },
      business_profile: { mcc: '5699', url: 'https://crystal.imaginethisprinted.com', product_description: 'Shirts and gifts sold on Imagine This Printed' },
      tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '127.0.0.1' },
      external_account: 'btok_us_verified',
      metadata: { purpose: 'store_referral_test_proof', task: '1a699ba8', vendor_store: 'crystal' }
    })
    accountId = account.id
    proof.testAccount = { id: account.id, transfers: await waitForTransfers(account.id) }
    console.log('test account', proof.testAccount)

    code = `PROOF${Math.floor(10000 + Math.random() * 89999)}`
    const { data: store, error } = await supabase
      .from('vendor_storefronts')
      .insert({ slug: `proof-${Date.now().toString(36)}`, name: 'Referral proof (test, deleted after the run)', referral_code: code, referral_percent: 10, stripe_account_id: account.id, status: 'draft' })
      .select('id, slug')
      .single()
    if (error) throw new Error(`proof store insert: ${error.message}`)
    proof.proofStore = { ...store, code, percent: 10 }
    cleanup.push(async () => supabase.from('vendor_storefronts').delete().eq('id', store!.id))
  }

  // 2. The real checkout route, as a guest who landed on the site through the link.
  const app = express()
  app.use(express.json())
  app.use('/api/stripe', stripeRouter)
  const server = app.listen(0)
  cleanup.push(async () => server.close())
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const body = (amount: number) => ({
    amount, currency: 'usd',
    items: [{ product: PRODUCT, quantity: 1, selectedSize: 'M' }],
    shipping: { firstName: 'Referral', lastName: 'Proof', email: BUYER_EMAIL, address: '1 Test Street', city: 'Providence', state: 'RI', zipCode: '02903', country: 'US' },
    shippingType: 'pickup', shippingMethod: 'Local Pickup', shippingCost: 0,
    referralCode: code
  })
  const post = (amount: number) => fetch(`${base}/api/stripe/checkout-payment-intent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body(amount)) })
  // Like the real page: the first answer carries the server's total, the second uses it.
  let res = await post(0)
  let json: any = await res.json()
  if (res.status === 400 && json.pricing?.total) {
    res = await post(Math.round(json.pricing.total * 100)) // the route takes cents
    json = await res.json()
  }
  if (!res.ok) throw new Error(`checkout ${res.status}: ${JSON.stringify(json)}`)
  const { orderId, paymentIntentId } = json
  cleanup.push(async () => {
    await supabase.from('order_items').delete().eq('order_id', orderId)
    return supabase.from('orders').delete().eq('id', orderId)
  })
  const { data: stamped } = await supabase.from('orders').select('order_number, subtotal, discount_amount, total, metadata').eq('id', orderId).single()
  proof.checkout = { orderId, orderNumber: stamped?.order_number, paymentIntentId, total: stamped?.total, storeReferral: stamped?.metadata?.store_referral ?? null }
  console.log('checkout stamped', proof.checkout)
  if (stamped?.metadata?.store_referral?.code !== code) throw new Error('the order was NOT stamped with the link code')

  if (CHECKOUT_ONLY) {
    const pi = await stripe.paymentIntents.cancel(paymentIntentId)
    proof.cancelled = { paymentIntent: pi.id, status: pi.status, storeReferralOnPi: pi.metadata.storeReferral }
  } else {
    // 3. Pay with the 4242 test card, then the paid hook's claim + the referral step.
    const pi = await stripe.paymentIntents.confirm(paymentIntentId, { payment_method: 'pm_card_visa', return_url: 'https://imaginethisprinted.com/order-confirmation' })
    const charge = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null
    proof.payment = { status: pi.status, amount: pi.amount, charge }
    if (pi.status !== 'succeeded') throw new Error(`test payment ${pi.status}`)
    await supabase.from('orders').update({ status: 'processing', payment_status: 'paid', payment_intent_id: pi.id, charge_id: charge }).eq('id', orderId).neq('payment_status', 'paid')

    const cut = await payStoreReferralCut(orderId, log)
    const { data: paid } = await supabase.from('orders').select('metadata').eq('id', orderId).single()
    proof.cutOnOrder = paid?.metadata?.store_referral?.cut ?? null
    if (cut?.status !== 'paid' || !cut.transfer_id) throw new Error(`cut not paid: ${JSON.stringify(cut)}`)

    const transfer = await stripe.transfers.retrieve(cut.transfer_id)
    const balance = await stripe.balance.retrieve({ stripeAccount: accountId! })
    proof.transfer = { id: transfer.id, amount: transfer.amount, destination: transfer.destination, source_transaction: transfer.source_transaction, group: transfer.transfer_group }
    proof.sellerBalance = { pending: balance.pending, available: balance.available }
    if (transfer.destination !== accountId) throw new Error('transfer went somewhere else')

    // 4. Refund: her cut comes back.
    const refund = await stripe.refunds.create({ payment_intent: pi.id })
    const reversal = await reverseStoreReferralCut(orderId, log)
    const after = await stripe.transfers.retrieve(cut.transfer_id)
    proof.refund = { refund: refund.id, reversal, amountReversed: after.amount_reversed, reversed: after.reversed }
  }
  proof.ok = true
} catch (err: any) {
  proof.ok = false
  proof.error = String(err?.message || err)
  console.error('PROOF FAILED:', proof.error)
} finally {
  for (const step of cleanup.reverse()) await step().catch(e => console.error('cleanup:', e?.message))
  fs.mkdirSync(PROOF_DIR, { recursive: true })
  const file = path.join(PROOF_DIR, `proof-${CHECKOUT_ONLY ? 'checkout-live' : 'stripe-test'}-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(proof, null, 2))
  console.log(JSON.stringify(proof, null, 2))
  console.log('proof written:', file)
  process.exit(proof.ok ? 0 : 1)
}
