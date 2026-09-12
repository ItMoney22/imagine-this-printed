/**
 * Getting the bytes of a purchased label.
 *
 * Two callers need this and must not drift apart: the station screen, which
 * fetches the label as an admin and prints it in the browser, and the station
 * agent on Pluto, which fetches it with a machine token and sends it to CUPS.
 *
 * The awkward part is that Shippo's `label_url` is a signed link with an
 * expiry. Storing it once and trusting it forever means reprints quietly break
 * months later, so a dead link is re-resolved from the transaction and the
 * order is repointed at the fresh one.
 */
import { supabase } from '../lib/supabase.js'

const SHIPPO_BASE_URL = 'https://api.goshippo.com'

export interface LabelFile {
  buffer: Buffer
  contentType: string
  filename: string
}

export interface LabelFileError {
  status: number
  error: string
}

export function isLabelFileError(result: LabelFile | LabelFileError): result is LabelFileError {
  return (result as LabelFileError).error !== undefined
}

export async function fetchOrderLabelFile(orderId: string): Promise<LabelFile | LabelFileError> {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, order_number, tracking_number, shipping_label_url, metadata')
    .eq('id', orderId)
    .single()

  if (orderError || !order) return { status: 404, error: 'Order not found' }

  const stored = order.metadata?.shipping_label || {}
  const transactionId: string | null = stored.transaction_id || null
  let labelUrl: string | null = order.shipping_label_url || stored.label_url || null

  if (!labelUrl && !transactionId) {
    return { status: 404, error: 'This order has no purchased label to print.' }
  }

  const token = process.env.SHIPPO_API_TOKEN

  const refreshFromShippo = async (): Promise<string | null> => {
    if (!token || !transactionId) return null
    const tx = await fetch(`${SHIPPO_BASE_URL}/transactions/${transactionId}`, {
      headers: { 'Authorization': `ShippoToken ${token}` }
    })
    if (!tx.ok) return null
    const body = await tx.json().catch(() => ({})) as any
    return body?.label_url || null
  }

  if (!labelUrl) labelUrl = await refreshFromShippo()
  if (!labelUrl) return { status: 404, error: 'This order has no purchased label to print.' }

  let upstream = await fetch(labelUrl)

  if (!upstream.ok) {
    const fresh = await refreshFromShippo()
    if (fresh && fresh !== labelUrl) {
      labelUrl = fresh
      upstream = await fetch(fresh)
      // Keep the order pointed at the working link so the next print is direct.
      if (upstream.ok) {
        await supabase.from('orders').update({
          shipping_label_url: fresh,
          metadata: {
            ...(order.metadata && typeof order.metadata === 'object' ? order.metadata : {}),
            shipping_label: { ...stored, label_url: fresh }
          }
        }).eq('id', orderId)
      }
    }
  }

  if (!upstream.ok) {
    console.error('[shipping-label-file] Could not fetch label for', orderId, upstream.status)
    return {
      status: 502,
      error: `The carrier could not return this label (${upstream.status}). Open it in Shippo instead.`
    }
  }

  const contentType = upstream.headers.get('content-type') || 'application/pdf'
  const buffer = Buffer.from(await upstream.arrayBuffer())
  const extension = contentType.includes('png') ? 'png' : contentType.includes('text') ? 'zpl' : 'pdf'
  const filename = `label-${order.order_number || order.id.slice(0, 8)}.${extension}`

  return { buffer, contentType, filename }
}
