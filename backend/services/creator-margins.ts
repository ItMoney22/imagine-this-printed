/**
 * Creator margin accrual — pays creators when a paid order contains their
 * user-generated products.
 *
 * Money model (D1, David 2026-07-10): products with a cost basis
 * (products.cost_price > 0 — e.g. Merch Studio shirts at $10 base + back
 * upcharge) accrue `retail − cost_price − fee share` per unit to the creator's
 * ITC wallet. Products WITHOUT a cost basis (legacy AI-flow designs) keep the
 * platform's standing 15% royalty promise.
 *
 * Idempotency: at most ONE accrual per (order, product). Two layers:
 *   1. an existence check on user_product_royalties before inserting
 *   2. the uq_user_product_royalties_order_product unique index
 *      (supabase/migrations/20260710_merch_studio_storefront.sql) — a
 *      concurrent duplicate insert fails 23505 and is treated as already-done.
 * Safe to call from BOTH paid paths (stripe.ts handleCheckoutOrderPayment and
 * the webhooks.ts payment_intent.succeeded fallback), same as
 * decrementBlanksForOrder.
 */

import { supabase } from '../lib/supabase.js'

const LEGACY_ROYALTY_PERCENT = 15 // no-cost-basis fallback — matches user-royalties.ts
const ITC_PER_CENT = 1 // 1 cent = 1 ITC (matches user-royalties.ts)

function feePercent(): number {
  const raw = Number(process.env.STOREFRONT_CREATOR_FEE_PERCENT)
  return Number.isFinite(raw) && raw >= 0 && raw <= 50 ? raw : 3
}

type Logger = { info?: Function; warn?: Function; error?: Function } | undefined

export async function accrueCreatorMarginsForOrder(orderId: string, log?: Logger): Promise<void> {
  try {
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_number, source')
      .eq('id', orderId)
      .single()
    if (orderErr || !order) {
      log?.error?.({ err: orderErr, orderId }, '[creator-margins] order not found')
      return
    }

    const { data: items, error: itemsErr } = await supabase
      .from('order_items')
      .select('product_id, quantity, unit_price')
      .eq('order_id', orderId)
    if (itemsErr) {
      log?.error?.({ err: itemsErr, orderId }, '[creator-margins] failed to load order items')
      return
    }

    const productIds = [...new Set((items || []).map(i => i.product_id).filter(Boolean))]
    if (productIds.length === 0) return

    const { data: products, error: productsErr } = await supabase
      .from('products')
      .select('id, name, cost_price, is_user_generated, created_by_user_id')
      .in('id', productIds)
    if (productsErr) {
      log?.error?.({ err: productsErr, orderId }, '[creator-margins] failed to load products')
      return
    }

    for (const product of products || []) {
      if (!product.is_user_generated || !product.created_by_user_id) continue

      // One accrual per (order, product): aggregate every matching line item
      // (same product can appear twice, e.g. size M + plus-size 2XL at
      // different unit prices) into a single royalty row.
      const productItems = (items || []).filter(i => i.product_id === product.id)
      if (productItems.length === 0) continue

      const costCents = Math.round((Number(product.cost_price) || 0) * 100)
      const pct = feePercent()
      let marginCents = 0
      let saleCents = 0
      let quantity = 0
      let feeShareCents = 0
      for (const item of productItems) {
        const qty = Math.max(1, Number(item.quantity) || 1)
        const unitCents = Math.round((Number(item.unit_price) || 0) * 100)
        saleCents += unitCents * qty
        quantity += qty
        if (costCents > 0) {
          const fee = Math.round(unitCents * (pct / 100))
          feeShareCents += fee * qty
          marginCents += Math.max(0, unitCents - costCents - fee) * qty
        }
      }
      const model = costCents > 0 ? 'margin_d1' : 'royalty_15'
      if (costCents <= 0) {
        marginCents = Math.round(saleCents * (LEGACY_ROYALTY_PERCENT / 100))
      }
      if (marginCents <= 0) {
        log?.info?.({ orderId, productId: product.id, model }, '[creator-margins] zero margin — nothing to accrue')
        continue
      }

      // Idempotency check (unique index is the concurrent-race backstop).
      const { data: existing } = await supabase
        .from('user_product_royalties')
        .select('id')
        .eq('order_id', orderId)
        .eq('product_id', product.id)
        .maybeSingle()
      if (existing) {
        log?.info?.({ orderId, productId: product.id }, '[creator-margins] already accrued — skipping')
        continue
      }

      const itcAmount = marginCents * ITC_PER_CENT
      const { data: royalty, error: insertErr } = await supabase
        .from('user_product_royalties')
        .insert({
          user_id: product.created_by_user_id,
          product_id: product.id,
          order_id: orderId,
          amount_cents: marginCents,
          itc_amount: itcAmount,
          status: 'pending',
          metadata: {
            model,
            order_number: order.order_number,
            storefront: order.source || null,
            quantity,
            sale_price_cents: saleCents,
            cost_price_cents: costCents,
            fee_share_cents: feeShareCents,
            fee_percent: costCents > 0 ? pct : null,
          },
        })
        .select()
        .single()

      if (insertErr) {
        if ((insertErr as any).code === '23505') {
          log?.info?.({ orderId, productId: product.id }, '[creator-margins] concurrent duplicate accrual blocked by unique index')
        } else {
          log?.error?.({ err: insertErr, orderId, productId: product.id }, '[creator-margins] royalty insert failed')
        }
        continue
      }

      // Credit the creator's ITC wallet.
      const { data: wallet, error: walletErr } = await supabase
        .from('user_wallets')
        .select('itc_balance')
        .eq('user_id', product.created_by_user_id)
        .single()
      if (walletErr || !wallet) {
        log?.error?.({ err: walletErr, creatorId: product.created_by_user_id }, '[creator-margins] creator wallet not found — royalty row left pending')
        continue
      }
      const newBalance = (Number(wallet.itc_balance) || 0) + itcAmount
      const { error: creditErr } = await supabase
        .from('user_wallets')
        .update({ itc_balance: newBalance, updated_at: new Date().toISOString() })
        .eq('user_id', product.created_by_user_id)
      if (creditErr) {
        log?.error?.({ err: creditErr, creatorId: product.created_by_user_id }, '[creator-margins] wallet credit failed — royalty row left pending')
        continue
      }

      await supabase
        .from('user_product_royalties')
        .update({ status: 'credited', credited_at: new Date().toISOString() })
        .eq('id', royalty.id)

      // Ledger entry so creator analytics (itc_transactions type='royalty')
      // sees storefront earnings too. Non-blocking.
      const { error: ledgerErr } = await supabase.from('itc_transactions').insert({
        user_id: product.created_by_user_id,
        type: 'royalty',
        amount: itcAmount,
        balance_after: newBalance,
        reference: orderId,
        metadata: {
          product_id: product.id,
          product_name: product.name,
          order_number: order.order_number,
          model,
          description: `Creator earnings for order ${order.order_number}`,
        },
      })
      if (ledgerErr) log?.warn?.({ err: ledgerErr }, '[creator-margins] ledger insert failed (non-blocking)')

      log?.info?.({
        orderId,
        productId: product.id,
        creatorId: product.created_by_user_id,
        model,
        marginCents,
        itcAmount,
      }, '💰 [creator-margins] creator margin credited')
    }
  } catch (err: any) {
    log?.error?.({ err, orderId }, '[creator-margins] accrual failed (non-fatal)')
  }
}
