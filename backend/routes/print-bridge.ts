import { Router, Request, Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase.js'
import { sendEmail } from '../utils/email.js'

/**
 * Print bridge — the seam between the ITP storefront and the Watchtower print
 * factory (Saturn's Bambu A1 fleet: Batman + Levosa).
 *
 * ITP owns its own database. Watchtower never touches it directly — it calls
 * these two endpoints:
 *   GET  /api/print-bridge/queue?since=<iso>&limit=N
 *        -> paid orders containing a 3D-print line item, since a cursor. Read-only.
 *   POST /api/print-bridge/status  { itpOrderId, status, railStatus?, printer?, jobId? }
 *        -> mirror the coarse, customer-facing print status onto the order
 *           (stored in orders.metadata.print — no schema change). Idempotent.
 *
 * This is ADDITIVE: it does not touch checkout, the Stripe webhook, or order
 * creation. Auth: Bearer <PRINT_BRIDGE_TOKEN> (a dedicated shared secret).
 */

const router = Router()

function requireBridgeAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.PRINT_BRIDGE_TOKEN
  if (!token) {
    res.status(500).json({ error: 'PRINT_BRIDGE_TOKEN not configured' })
    return
  }
  const header = req.headers.authorization || ''
  if (header !== `Bearer ${token}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

// Cart products for a 3D print are created as id `3d-print-<modelId>` (see
// backend/routes/3d-models.ts POST /:id/order), so order_items carry that id.
const PRINT_ITEM_PREFIX = '3d-print-'

const CUSTOMER_STATUSES = [
  'received', 'in_production', 'printing', 'shipped_soon', 'rejected', 'issue',
  // factory floor stages that trigger WORKER notification emails:
  'insert_pause',      // printer paused at insert layer — add 2 magnets + write NFC tag
  'ready_for_packing', // print finished — pack (verify tag written)
]

// Statuses that email the print-floor workers. Recipients come from
// PRINT_WORKER_EMAILS (comma-separated); falls back to the company mailbox.
const WORKER_NOTIFY_STATUSES = new Set(['insert_pause', 'ready_for_packing'])

/**
 * GET /api/print-bridge/queue
 * Paid orders (payment_status='paid') created after `since`, that contain a
 * 3D-print line item, mapped to the bridge order shape Watchtower expects.
 */
router.get('/queue', requireBridgeAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const since = (req.query.since as string) || ''
    const limit = Math.min(Number(req.query.limit) || 50, 100)

    let q = supabase
      .from('orders')
      .select('id, order_number, customer_email, customer_name, total, created_at, payment_status, metadata')
      .eq('payment_status', 'paid')
      .order('created_at', { ascending: true })
      .limit(limit)
    if (since) q = q.gt('created_at', since)

    const { data: orders, error } = await q
    if (error) return res.status(500).json({ error: error.message })

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    const out: any[] = []
    let cursor = since
    for (const o of orders || []) {
      cursor = o.created_at // advance past every scanned order, 3D or not

      // Production order_items columns are (product_id uuid, product_name,
      // quantity, unit_price, subtotal, metadata) — NOT price/total. And a
      // uuid product_id can never hold '3d-print-<modelId>': the client cart
      // id lives in order_items.metadata.client_product_id (new rows) and in
      // the orders.metadata.items snapshot (all rows, incl. orders predating
      // the order_items fix).
      const { data: items } = await supabase
        .from('order_items')
        .select('product_id, product_name, quantity, unit_price, subtotal, metadata')
        .eq('order_id', o.id)

      const lineItems = items || []
      const metaItems: any[] = Array.isArray((o as any).metadata?.items) ? (o as any).metadata.items : []
      const clientId = (it: any) => it?.metadata?.client_product_id ?? it?.product_id

      // Custom minis: cart ids '3d-print-<modelId>' from the 3D model designer.
      const tablePrint = lineItems.find(
        (it: any) => typeof clientId(it) === 'string' && String(clientId(it)).startsWith(PRINT_ITEM_PREFIX),
      )
      const metaPrint = metaItems.find(
        (m: any) => typeof m?.id === 'string' && m.id.startsWith(PRINT_ITEM_PREFIX),
      )
      const printItem = tablePrint
        ? { id: String(clientId(tablePrint)), name: tablePrint.product_name, quantity: tablePrint.quantity, total: tablePrint.subtotal }
        : metaPrint
          ? { id: String(metaPrint.id), name: metaPrint.name, quantity: metaPrint.quantity, total: (metaPrint.price || 0) * (metaPrint.quantity || 1) }
          : null
      if (printItem) {
        const modelId = printItem.id.slice(PRINT_ITEM_PREFIX.length)
        let model: any = null
        if (modelId) {
          const { data } = await supabase
            .from('user_3d_models')
            .select('id, prompt, style, glb_url, stl_url, concept_image_url, print_height_mm, metadata')
            .eq('id', modelId)
            .single()
          model = data
        }

        // Resolve print attributes from order item metadata (if present) then model metadata
        const itemMeta = (tablePrint as any)?.metadata ?? (metaPrint as any)?.metadata ?? {}
        const customColorMode: 'grey' | 'color4' =
          itemMeta?.color_mode === 'color4' ? 'color4'
          : (model?.metadata as any)?.color_mode === 'color4' ? 'color4'
          : 'grey'
        const customNfcExperienceUrl: string | undefined = (model?.metadata as any)?.nfc?.experience_url
          ? (model.metadata as any).nfc.experience_url
          : `https://imaginethisprinted.com/ar/${modelId}`

        out.push({
          itpOrderId: o.id,
          line: 'custom-mini',
          title: printItem.name || 'Custom figurine',
          concept: model?.prompt || printItem.name || 'Custom 3D print',
          glbUrl: model?.glb_url || undefined,
          referenceUrl: model?.concept_image_url || undefined,
          quantity: printItem.quantity || 1,
          material: 'PLA',
          colorMode: customColorMode,
          style: model?.style ?? 'cartoon',
          magnetSockets: 2,
          nfcUrl: customNfcExperienceUrl,
          customerName: o.customer_name || undefined,
          customerEmail: o.customer_email || undefined,
          priceUsd: printItem.total ?? o.total ?? undefined,
          createdAt: o.created_at,
        })
      }

      // Catalog toys: regular catalog products that are 3D-printable — category
      // '3d-prints' or explicitly flagged via metadata.print3d.enabled. Ordering
      // one of these starts production on Saturn's printer fleet, same as a
      // custom mini. Entries carry lineItemId so multi-item orders disambiguate.
      // Candidates come from order_items rows AND the metadata snapshot
      // (deduped by product id) so older orders without rows still print.
      const catalogCandidates = new Map<string, { product_id: string; product_name?: string; quantity: number; total?: number }>()
      for (const it of lineItems) {
        const pid = it.product_id
        if (typeof pid === 'string' && UUID_RE.test(pid) && !catalogCandidates.has(pid)) {
          catalogCandidates.set(pid, { product_id: pid, product_name: it.product_name, quantity: it.quantity || 1, total: it.subtotal })
        }
      }
      for (const m of metaItems) {
        const pid = m?.id
        if (typeof pid === 'string' && UUID_RE.test(pid) && !catalogCandidates.has(pid)) {
          catalogCandidates.set(pid, { product_id: pid, product_name: m.name, quantity: m.quantity || 1, total: (m.price || 0) * (m.quantity || 1) })
        }
      }
      if (catalogCandidates.size > 0) {
        const { data: prods } = await supabase
          .from('products')
          .select('id, name, category, images, metadata')
          .in('id', Array.from(catalogCandidates.keys()))
        const printable = new Map(
          (prods || [])
            .filter((p: any) => p.category === '3d-prints' || p?.metadata?.print3d?.enabled === true)
            .map((p: any) => [p.id, p]),
        )
        for (const it of catalogCandidates.values()) {
          const p: any = printable.get(it.product_id)
          if (!p) continue
          const catalogColorMode: 'grey' | 'color4' =
            p.metadata?.print3d?.color_mode === 'color4' ? 'color4' : 'grey'
          const catalogMagnetSockets: number =
            typeof p.metadata?.print3d?.magnet_sockets === 'number'
              ? p.metadata.print3d.magnet_sockets
              : 2
          const catalogNfcUrl: string | null =
            p.metadata?.print3d?.nfc_url ?? null

          out.push({
            itpOrderId: o.id,
            lineItemId: it.product_id,
            line: 'catalog-toy',
            title: it.product_name || p.name || 'Catalog 3D print',
            concept: p.name || it.product_name || 'Catalog 3D print',
            glbUrl: p.metadata?.print3d?.glb_url || p.metadata?.glb_url || undefined,
            stlUrl: p.metadata?.print3d?.stl_url || undefined,
            referenceUrl: Array.isArray(p.images) && p.images[0] ? p.images[0] : undefined,
            quantity: it.quantity || 1,
            material: p.metadata?.print3d?.material || 'PLA',
            colorMode: catalogColorMode,
            magnetSockets: catalogMagnetSockets,
            nfcUrl: catalogNfcUrl,
            customerName: o.customer_name || undefined,
            customerEmail: o.customer_email || undefined,
            priceUsd: it.total ?? undefined,
            createdAt: o.created_at,
          })
        }
      }
    }

    return res.json({ orders: out, cursor })
  } catch (error: any) {
    req.log?.error?.({ err: error }, 'print-bridge queue failed')
    return res.status(500).json({ error: error.message || 'queue failed' })
  }
})

/**
 * POST /api/print-bridge/status
 * Mirror the factory's customer-facing status onto the order. Watchtower is the
 * only writer; stored in orders.metadata.print so there's no schema change and
 * the storefront can render a read-only "your print" widget.
 */
router.post('/status', requireBridgeAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { itpOrderId, status, railStatus, printer, jobId } = req.body || {}
    if (!itpOrderId || !status) {
      return res.status(400).json({ error: 'itpOrderId and status are required' })
    }
    if (!CUSTOMER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `invalid status; expected one of ${CUSTOMER_STATUSES.join(', ')}` })
    }

    const { data: order, error } = await supabase
      .from('orders')
      .select('id, metadata')
      .eq('id', itpOrderId)
      .single()
    if (error || !order) return res.status(404).json({ error: 'order not found' })

    const metadata = order.metadata && typeof order.metadata === 'object' ? { ...order.metadata } : {}
    ;(metadata as any).print = {
      status,
      railStatus: railStatus || null,
      printer: printer || null,
      jobId: jobId || null,
      updatedAt: new Date().toISOString(),
    }

    const { error: upErr } = await supabase
      .from('orders')
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('id', itpOrderId)
    if (upErr) return res.status(500).json({ error: upErr.message })

    // Notify print-floor workers on insert-pause / ready-for-packing.
    // Fire-and-forget: a mail failure must never fail the factory callback.
    if (WORKER_NOTIFY_STATUSES.has(status)) {
      notifyWorkers(order, status, { railStatus, printer, jobId }).catch(err =>
        console.error('[print-bridge] worker notify failed:', err instanceof Error ? err.message : err)
      )
    }

    return res.json({ ok: true })
  } catch (error: any) {
    req.log?.error?.({ err: error }, 'print-bridge status failed')
    return res.status(500).json({ error: error.message || 'status update failed' })
  }
})

/**
 * Email the print-floor workers when a job needs hands: the insert pause
 * (2 magnets + NFC tag written with the toy's experience URL) or final packing.
 */
async function notifyWorkers(
  order: { id: string; metadata: any },
  status: string,
  info: { railStatus?: string; printer?: string; jobId?: string }
): Promise<void> {
  const recipients = (process.env.PRINT_WORKER_EMAILS || 'wecare@imaginethisprinted.com')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean)

  const items: any[] = Array.isArray(order.metadata?.items) ? order.metadata.items : []
  const printItems = items.filter(i =>
    String(i.client_product_id || i.id || '').startsWith(PRINT_ITEM_PREFIX) ||
    String(i.client_product_id || i.id || '').startsWith('catalog-toy')
  )
  const itemLines = (printItems.length ? printItems : items).map(i => {
    const rawId = String(i.client_product_id || i.id || '')
    const modelId = rawId.startsWith(PRINT_ITEM_PREFIX) ? rawId.slice(PRINT_ITEM_PREFIX.length) : null
    const nfcUrl = i.metadata?.nfc_url
      || (modelId ? `https://imaginethisprinted.com/ar/${modelId}` : null)
    const colorMode = i.metadata?.color_mode === 'color4' ? 'FULL COLOR (4 max)' : 'matte grey'
    return `<li><strong>${i.name || i.product_name || 'Toy'}</strong> × ${i.quantity || 1} — ${colorMode}` +
      (nfcUrl ? `<br/>NFC URL to write: <a href="${nfcUrl}">${nfcUrl}</a>` : '') +
      `</li>`
  }).join('')

  const isPause = status === 'insert_pause'
  const subject = isPause
    ? `Insert pause — order ${order.id.slice(0, 8)} needs magnets + NFC tag`
    : `Ready for packing — order ${order.id.slice(0, 8)}`
  const todo = isPause
    ? `<p><strong>The printer is paused.</strong> Please:</p>
       <ol>
         <li>Place <strong>2 magnets</strong> into the sockets</li>
         <li>Write the <strong>NFC tag</strong> with the URL below (NFC Tools → Write → URL), place it in the base</li>
         <li>Resume the print</li>
       </ol>`
    : `<p>The print is finished. Verify the NFC tag responds (tap it with a phone), then pack and mark the tag as written in the Toy Lab.</p>`

  await sendEmail({
    to: recipients.join(','),
    subject,
    htmlContent: `
      <h2>${isPause ? 'Insert pause' : 'Ready for packing'}</h2>
      <p>Order <strong>${order.id}</strong>${info.printer ? ` · printer <strong>${info.printer}</strong>` : ''}${info.jobId ? ` · job ${info.jobId}` : ''}</p>
      ${todo}
      <ul>${itemLines || '<li>(item details on the order)</li>'}</ul>
      <p><a href="https://imaginethisprinted.com/admin/orders">Open Order Management</a> · <a href="https://imaginethisprinted.com/admin/toys">Open Toy Lab</a></p>
    `,
  })
}

export default router
