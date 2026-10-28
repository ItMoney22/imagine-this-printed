/**
 * QR counter stand print files: queue, claim, finish, and send to print.
 *
 * The geometry and the scan-back are Python (tools/qr-stand/gen.py) and run on
 * Earth, next to the A1s, because that is where the printers and the slicer are
 * (task deebfdca). So the backend never builds anything: it writes a
 * qr_stand_builds row and the builder on Earth claims it over the print-bridge
 * token, runs gen.py, and posts back the 3mf + face picture + scan result.
 *
 *   paid order  ──► queueBuildsForPaidOrder ──► row 'queued'
 *   admin edit  ──► queueBuild              ──► row 'queued'   (a NEW row; history stays)
 *   builder     ──► claimNextBuild          ──► 'building' ──► completeBuild ──► 'ready' | 'failed'
 *   admin print ──► requestPrint            ──► print 'requested'
 *   builder     ──► claimNextPrint          ──► 'sending'  ──► completePrint ──► 'sent' | 'failed'
 *
 * A build is only 'ready' when gen.py read its own face back as the exact link;
 * requestPrint refuses anything else, so nothing that does not scan can print.
 */
import { supabase } from '../lib/supabase.js'
import { getSignedUrl } from './google-cloud-storage.js'
import { QR_STAND } from '../shared/qr-stand.js'
import { notifyResellerSales, type ResellerSaleLine } from './qr-stand-reseller.js'

type Logger = { info?: Function; warn?: Function; error?: Function } | undefined

/** A 'building' row older than this was abandoned by a builder that died. */
export const STALE_CLAIM_MS = 10 * 60 * 1000

export interface QrStandLineMeta {
  line_index: number
  link: string
  caption: string
  logo_path: string | null
  reseller?: { vendor: string; client_ref: string | null; notified_at?: string | null; error?: string | null } | null
  /** Set by the admin editor: who last changed the stand and when. */
  edited_at?: string | null
  edited_by?: string | null
}

export interface StandLine {
  orderItemId: string
  lineIndex: number
  quantity: number
  unitPrice: number
  stand: QrStandLineMeta
}

export interface BuildRow {
  id: string
  order_id: string
  line_index: number
  link: string
  caption: string
  logo_path: string | null
  status: 'queued' | 'building' | 'ready' | 'failed'
  claimed_at: string | null
  built_at: string | null
  threemf_path: string | null
  face_path: string | null
  scan_ok: boolean | null
  scan_text: string | null
  qr_version: number | null
  logo_mode: string | null
  error: string | null
  print_status: 'requested' | 'sending' | 'sent' | 'failed' | null
  print_requested_at: string | null
  print_sent_at: string | null
  print_job_id: string | null
  print_printer: string | null
  print_error: string | null
  requested_by: string | null
  created_at: string
  updated_at: string
}

/** The stand lines on an order, in line order. */
export async function standLinesOfOrder(orderId: string): Promise<StandLine[]> {
  const { data, error } = await supabase
    .from('order_items')
    .select('id, quantity, unit_price, metadata')
    .eq('order_id', orderId)
  if (error) throw new Error(`order items: ${error.message}`)
  return (data ?? [])
    .filter((r: any) => r.metadata?.qr_stand && typeof r.metadata.qr_stand.link === 'string')
    .map((r: any) => ({
      orderItemId: r.id,
      lineIndex: Number(r.metadata.qr_stand.line_index) || 0,
      quantity: Number(r.quantity) || 1,
      unitPrice: Number(r.unit_price) || 0,
      stand: r.metadata.qr_stand as QrStandLineMeta,
    }))
    .sort((a, b) => a.lineIndex - b.lineIndex)
}

export async function queueBuild(input: {
  orderId: string
  lineIndex: number
  link: string
  caption: string
  logoPath: string | null
  requestedBy: string | null
}): Promise<BuildRow> {
  const { data, error } = await supabase
    .from('qr_stand_builds')
    .insert({
      order_id: input.orderId,
      line_index: input.lineIndex,
      link: input.link,
      caption: input.caption,
      logo_path: input.logoPath,
      requested_by: input.requestedBy,
    })
    .select('*')
    .single()
  if (error) throw new Error(`queue build: ${error.message}`)
  return data as BuildRow
}

/** Newest build per line for an order. */
export async function latestBuilds(orderId: string): Promise<Map<number, BuildRow>> {
  const { data, error } = await supabase
    .from('qr_stand_builds')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`builds: ${error.message}`)
  const out = new Map<number, BuildRow>()
  for (const row of (data ?? []) as BuildRow[]) if (!out.has(row.line_index)) out.set(row.line_index, row)
  return out
}

/**
 * Run when an order is paid: a print file for every stand line that has none
 * yet, and the sale reported to the reseller site it came through. Fail-soft.
 */
export async function onQrStandOrderPaid(
  order: { id: string; order_number: string | null; subtotal?: number; discount_amount?: number },
  log?: Logger
): Promise<void> {
  let lines: StandLine[]
  try {
    lines = await standLinesOfOrder(order.id)
  } catch (err) {
    log?.error?.({ err, orderId: order.id }, '[qr-stand] could not read stand lines of a paid order')
    return
  }
  if (!lines.length) return

  try {
    const existing = await latestBuilds(order.id)
    for (const line of lines) {
      if (existing.has(line.lineIndex)) continue
      await queueBuild({
        orderId: order.id,
        lineIndex: line.lineIndex,
        link: line.stand.link,
        caption: line.stand.caption,
        logoPath: line.stand.logo_path,
        requestedBy: null,
      })
    }
  } catch (err) {
    log?.error?.({ err, orderId: order.id }, '[qr-stand] could not queue print files for a paid order')
  }

  const sales: ResellerSaleLine[] = lines
    .filter((l) => l.stand.reseller?.vendor && !l.stand.reseller.notified_at)
    .map((l) => ({
      lineIndex: l.lineIndex,
      vendor: l.stand.reseller!.vendor,
      clientRef: l.stand.reseller!.client_ref ?? null,
      quantity: l.quantity,
      grossCents: lineGrossCents(l.unitPrice, l.quantity, order.subtotal, order.discount_amount),
    }))
  if (!sales.length) return
  const results = await notifyResellerSales(order, sales, QR_STAND.name, log)
  for (const r of results) {
    const line = lines.find((l) => l.lineIndex === r.lineIndex)
    if (!line) continue
    await stampReseller(line, r.sent ? { notified_at: new Date().toISOString(), error: null } : { error: r.error ?? 'not sent' })
  }
}

/**
 * What the buyer actually paid for a line: its price less its share of any
 * order-wide discount (a coupon comes off the whole subtotal), before tax and
 * shipping. The reseller's 10% is of THIS, so a coupon never pays a share on
 * money that was not collected.
 */
export function lineGrossCents(unitPrice: number, quantity: number, subtotal?: number, discount?: number): number {
  const line = Math.round(unitPrice * 100) * quantity
  const sub = Math.round((subtotal ?? 0) * 100)
  const off = Math.round((discount ?? 0) * 100)
  if (sub <= 0 || off <= 0) return line
  return Math.max(0, line - Math.round((line * Math.min(off, sub)) / sub))
}

async function stampReseller(line: StandLine, patch: { notified_at?: string; error: string | null }): Promise<void> {
  const { data } = await supabase.from('order_items').select('metadata').eq('id', line.orderItemId).maybeSingle()
  const meta = (data?.metadata ?? {}) as Record<string, any>
  if (!meta.qr_stand?.reseller) return
  meta.qr_stand = { ...meta.qr_stand, reseller: { ...meta.qr_stand.reseller, ...patch } }
  await supabase.from('order_items').update({ metadata: meta }).eq('id', line.orderItemId)
}

/** Builder: take the oldest queued build (or one a dead builder abandoned). */
export async function claimNextBuild(now = Date.now()): Promise<{ build: BuildRow; logoUrl: string | null } | null> {
  const staleBefore = new Date(now - STALE_CLAIM_MS).toISOString()
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: candidates, error } = await supabase
      .from('qr_stand_builds')
      .select('id, status, claimed_at')
      .or(`status.eq.queued,and(status.eq.building,claimed_at.lt.${staleBefore})`)
      .order('created_at', { ascending: true })
      .limit(1)
    if (error) throw new Error(`claim: ${error.message}`)
    const next = candidates?.[0] as { id: string; status: string; claimed_at: string | null } | undefined
    if (!next) return null
    // Compare-and-set on the state we read: a second builder racing for the same
    // row updates nothing and loops round for the next one.
    let q = supabase
      .from('qr_stand_builds')
      .update({ status: 'building', claimed_at: new Date(now).toISOString(), error: null, updated_at: new Date(now).toISOString() })
      .eq('id', next.id)
      .eq('status', next.status)
    q = next.claimed_at ? q.eq('claimed_at', next.claimed_at) : q.is('claimed_at', null)
    const { data: claimed } = await q.select('*')
    const build = (claimed?.[0] ?? null) as BuildRow | null
    if (!build) continue
    const logoUrl = build.logo_path ? await getSignedUrl(build.logo_path, 30) : null
    return { build, logoUrl }
  }
  return null
}

export interface BuildResult {
  ok: boolean
  error?: string | null
  threemfPath?: string | null
  facePath?: string | null
  scanOk?: boolean | null
  scanText?: string | null
  qrVersion?: number | null
  logoMode?: string | null
}

/** Builder: record the outcome. 'ready' requires a face that scanned back as the link. */
export async function completeBuild(id: string, result: BuildResult): Promise<BuildRow | null> {
  const ready = result.ok && result.scanOk === true && !!result.threemfPath && !!result.facePath
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('qr_stand_builds')
    .update({
      status: ready ? 'ready' : 'failed',
      built_at: now,
      threemf_path: ready ? result.threemfPath : null,
      face_path: result.facePath ?? null,
      scan_ok: result.scanOk ?? null,
      scan_text: result.scanText ?? null,
      qr_version: result.qrVersion ?? null,
      logo_mode: result.logoMode ?? null,
      error: ready ? null : (result.error || (result.scanOk === false ? 'the code did not scan back' : 'build failed')),
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'building')
    .select('*')
  if (error) throw new Error(`complete build: ${error.message}`)
  return (data?.[0] ?? null) as BuildRow | null
}

/** Admin: send a ready build to the printers. Only a scanned-back build may go. */
export async function requestPrint(id: string): Promise<{ ok: true; build: BuildRow } | { ok: false; error: string }> {
  const { data: row } = await supabase.from('qr_stand_builds').select('*').eq('id', id).maybeSingle()
  const build = row as BuildRow | null
  if (!build) return { ok: false, error: 'No print file found.' }
  if (build.status !== 'ready' || build.scan_ok !== true) return { ok: false, error: 'Rebuild the print file first: only a file that scans can print.' }
  // A cancelled or refunded order is never printed (task 14ce738b: a refund on the shop that sold it cancels it here).
  const { data: order } = await supabase.from('orders').select('status').eq('id', build.order_id).maybeSingle()
  if (order && (order.status === 'cancelled' || order.status === 'refunded')) {
    return { ok: false, error: `This order is ${order.status}: it must not be printed.` }
  }
  // Only the NEWEST file for a stand may print: an older one says whatever the
  // stand said before the last edit.
  const newest = (await latestBuilds(build.order_id)).get(build.line_index)
  if (newest && newest.id !== build.id) return { ok: false, error: 'That print file is out of date: send the newest one.' }
  if (build.print_status === 'requested' || build.print_status === 'sending') return { ok: true, build }
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('qr_stand_builds')
    .update({ print_status: 'requested', print_requested_at: now, print_error: null, updated_at: now })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, build: data as BuildRow }
}

/** Builder: take the oldest print request, with a link to its 3mf. */
export async function claimNextPrint(now = Date.now()): Promise<{ build: BuildRow; threemfUrl: string } | null> {
  const staleBefore = new Date(now - STALE_CLAIM_MS).toISOString()
  const { data: candidates, error } = await supabase
    .from('qr_stand_builds')
    .select('id, print_status, updated_at')
    .or(`print_status.eq.requested,and(print_status.eq.sending,updated_at.lt.${staleBefore})`)
    .order('print_requested_at', { ascending: true })
    .limit(1)
  if (error) throw new Error(`claim print: ${error.message}`)
  const next = candidates?.[0] as { id: string; print_status: string; updated_at: string } | undefined
  if (!next) return null
  const { data: claimed } = await supabase
    .from('qr_stand_builds')
    .update({ print_status: 'sending', updated_at: new Date(now).toISOString() })
    .eq('id', next.id)
    .eq('print_status', next.print_status)
    .eq('updated_at', next.updated_at)
    .select('*')
  const build = (claimed?.[0] ?? null) as BuildRow | null
  if (!build || !build.threemf_path) return null
  return { build, threemfUrl: await getSignedUrl(build.threemf_path, 60) }
}

export async function completePrint(
  id: string,
  result: { ok: boolean; jobId?: string | null; printer?: string | null; error?: string | null }
): Promise<BuildRow | null> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('qr_stand_builds')
    .update({
      print_status: result.ok ? 'sent' : 'failed',
      print_sent_at: result.ok ? now : null,
      print_job_id: result.jobId ?? null,
      print_printer: result.printer ?? null,
      print_error: result.ok ? null : (result.error || 'could not send'),
      updated_at: now,
    })
    .eq('id', id)
    .eq('print_status', 'sending')
    .select('*')
  if (error) throw new Error(`complete print: ${error.message}`)
  return (data?.[0] ?? null) as BuildRow | null
}
