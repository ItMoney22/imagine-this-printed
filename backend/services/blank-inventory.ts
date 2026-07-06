// ---------------------------------------------------------------------------
// Blank-shirt inventory: sale decrement + low-stock sweep.
//
// decrementBlanksForOrder() is called from BOTH Stripe paid paths
// (routes/stripe.ts handleCheckoutOrderPayment and routes/webhooks.ts
// payment_intent.succeeded fallback). Idempotency lives in the DB: the
// record_blank_sale RPC inserts the sale movement against a partial unique
// index (blank_id, order_id) WHERE reason='sale', so double invocation for the
// same order is a no-op. Never throws — a missing blank match must never fail
// a paid checkout.
//
// sweepLowStockBlanks() runs on the worker's hourly loop: alerts once per SKU
// (admin_notifications bell + digest email) and re-arms when stock rises back
// above the threshold.
// ---------------------------------------------------------------------------
import { supabase } from '../lib/supabase.js'
import { sendLowStockAlertEmail } from '../utils/email.js'

const SHIRT_CATEGORIES = new Set(['shirts'])

export interface BlankRow {
  id: string
  brand: string
  style_code: string
  color: string
  size: string
  qty_on_hand: number
  reorder_threshold: number
  reorder_qty: number | null
  cost_per_unit: number | null
  supplier: string | null
  last_alerted_at: string | null
}

interface LineToDecrement {
  size: string
  color: string
  quantity: number
  blankStyle?: string | null
}

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

// Resolve one order line to a blank_inventory row. Preference order:
// product's designated style (products.metadata.blank_style) → single
// color+size match → largest-stock match (logged, so a wrong auto-pick is
// visible in the movement history).
function pickBlank(blanks: BlankRow[], line: LineToDecrement): BlankRow | null {
  const colorSize = blanks.filter(
    b => norm(b.color) === norm(line.color) && norm(b.size) === norm(line.size)
  )
  if (colorSize.length === 0) return null
  if (line.blankStyle) {
    const styled = colorSize.filter(b => norm(b.style_code) === norm(line.blankStyle))
    if (styled.length > 0) return styled[0]
  }
  if (colorSize.length === 1) return colorSize[0]
  const picked = [...colorSize].sort((a, b) => b.qty_on_hand - a.qty_on_hand)[0]
  console.warn(
    `[blank-inventory] Ambiguous blank match for ${line.color}/${line.size} ` +
    `(${colorSize.length} styles) — auto-picked ${picked.brand} ${picked.style_code}. ` +
    `Set products.metadata.blank_style to pin the mapping.`
  )
  return picked
}

export async function decrementBlanksForOrder(orderId: string): Promise<void> {
  try {
    // Fast idempotency pre-check (the RPC's unique index is the hard guard).
    const { data: existing } = await supabase
      .from('blank_inventory_movements')
      .select('id')
      .eq('order_id', orderId)
      .eq('reason', 'sale')
      .limit(1)
    if (existing && existing.length > 0) return

    // Line items: order_items rows first, orders.metadata.items snapshot as
    // fallback (some legacy/custom orders have no order_items rows).
    const { data: items } = await supabase
      .from('order_items')
      .select('product_id, quantity, metadata')
      .eq('order_id', orderId)

    let lines: Array<{ productId: string | null; quantity: number; size: string | null; color: string | null }> = []
    if (items && items.length > 0) {
      lines = items.map(i => ({
        productId: i.product_id,
        quantity: i.quantity || 1,
        size: i.metadata?.size ?? null,
        color: i.metadata?.color ?? null
      }))
    } else {
      const { data: order } = await supabase
        .from('orders')
        .select('metadata')
        .eq('id', orderId)
        .single()
      lines = ((order?.metadata?.items as any[]) || []).map(i => ({
        productId: typeof i?.id === 'string' ? i.id : null,
        quantity: i?.quantity || 1,
        size: i?.size ?? null,
        color: i?.color ?? null
      }))
    }

    const withVariant = lines.filter(l => l.productId && l.size && l.color)
    if (withVariant.length === 0) return

    const productIds = [...new Set(withVariant.map(l => l.productId as string))]
    const { data: products } = await supabase
      .from('products')
      .select('id, category, metadata')
      .in('id', productIds)
    const productById = new Map((products || []).map(p => [p.id, p]))

    const shirtLines: LineToDecrement[] = []
    for (const l of withVariant) {
      const product = productById.get(l.productId as string)
      if (!product || !SHIRT_CATEGORIES.has(norm(product.category))) continue
      shirtLines.push({
        size: l.size as string,
        color: l.color as string,
        quantity: l.quantity,
        blankStyle: product.metadata?.blank_style ?? null
      })
    }
    if (shirtLines.length === 0) return

    const { data: blanks } = await supabase.from('blank_inventory').select('*')
    if (!blanks || blanks.length === 0) {
      console.warn(`[blank-inventory] Order ${orderId} has shirt items but blank_inventory is empty — nothing decremented`)
      return
    }

    // Aggregate per blank so one movement row covers repeated lines.
    const qtyByBlank = new Map<string, number>()
    for (const line of shirtLines) {
      const blank = pickBlank(blanks as BlankRow[], line)
      if (!blank) {
        console.warn(`[blank-inventory] No blank matches ${line.color}/${line.size} for order ${orderId} — skipped`)
        continue
      }
      qtyByBlank.set(blank.id, (qtyByBlank.get(blank.id) || 0) + line.quantity)
    }

    for (const [blankId, qty] of qtyByBlank) {
      const { data: recorded, error } = await supabase.rpc('record_blank_sale', {
        p_blank_id: blankId,
        p_order_id: orderId,
        p_qty: qty
      })
      if (error) {
        console.error(`[blank-inventory] record_blank_sale failed for blank ${blankId} / order ${orderId}:`, error.message)
      } else if (recorded) {
        console.log(`[blank-inventory] ✅ Decremented blank ${blankId} by ${qty} for order ${orderId}`)
      }
    }
  } catch (err: any) {
    console.error(`[blank-inventory] decrementBlanksForOrder(${orderId}) error:`, err?.message || err)
  }
}

// Hourly worker sweep. Alerts once per SKU while it sits at/below threshold;
// re-arms automatically when stock rises above the threshold again.
export async function sweepLowStockBlanks(): Promise<void> {
  try {
    // Small table — fetch all and compare columns in JS (PostgREST can't
    // compare qty_on_hand to reorder_threshold server-side).
    const { data, error } = await supabase.from('blank_inventory').select('*')
    if (error) {
      console.error('[blank-inventory] Low-stock sweep fetch failed:', error.message)
      return
    }
    const blanks = (data || []) as BlankRow[]
    if (blanks.length === 0) return

    const rearm = blanks.filter(b => b.qty_on_hand > b.reorder_threshold && b.last_alerted_at)
    if (rearm.length > 0) {
      await supabase
        .from('blank_inventory')
        .update({ last_alerted_at: null })
        .in('id', rearm.map(b => b.id))
    }

    const fresh = blanks.filter(b => b.qty_on_hand <= b.reorder_threshold && !b.last_alerted_at)
    if (fresh.length === 0) return

    console.log(`[blank-inventory] 🚨 ${fresh.length} blank SKU(s) newly at/below reorder threshold`)

    const notifications = fresh.map(b => ({
      type: 'low_stock',
      title: `Low stock: ${b.brand} ${b.style_code} ${b.color} / ${b.size}`,
      message: `${b.qty_on_hand} left (threshold ${b.reorder_threshold}).` +
        (b.reorder_qty ? ` Suggested reorder: ${b.reorder_qty}.` : '') +
        (b.supplier ? ` Supplier: ${b.supplier}.` : '')
    }))
    const { error: notifError } = await supabase.from('admin_notifications').insert(notifications)
    if (notifError) console.error('[blank-inventory] Failed to insert low-stock notifications:', notifError.message)

    try {
      await sendLowStockAlertEmail(fresh)
    } catch (emailErr: any) {
      console.error('[blank-inventory] Low-stock email failed:', emailErr?.message || emailErr)
    }

    await supabase
      .from('blank_inventory')
      .update({ last_alerted_at: new Date().toISOString() })
      .in('id', fresh.map(b => b.id))
  } catch (err: any) {
    console.error('[blank-inventory] sweepLowStockBlanks error:', err?.message || err)
  }
}
