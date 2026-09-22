// CRM server-side aggregation + pagination (Watchtower task 582e38ea).
//
// src/pages/CRM.tsx used to load the whole `user_profiles` table and the whole
// `orders` table on mount and then compute per-customer totalSpent /
// totalOrders / lastOrderDate in a JavaScript loop. A client-side `.limit()`
// could not fix it: truncating the orders fetch does not show fewer customers,
// it shows WRONG MONEY for the customers it does show.
//
// So the aggregation moved into Postgres (supabase/migrations/
// 20260922170000_crm_customer_aggregates.sql) and this router is the only way
// the browser reaches it. Every endpoint here is bounded: a page size, a hard
// cap, and a total count so the UI can say where the rest are.
//
// FALLBACK: `/customers` degrades to a bounded two-step query if the RPC is not
// installed. Frontend and API deploy independently on this project (Vercel vs
// Render), so a browser running today's bundle WILL at some point talk to an
// API whose database has not had the migration applied yet — the CRM should
// show slightly weaker sorting in that window, not a blank page. See
// [[itp-vercel-render-deploy-skew]].
import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'

const router = Router()

router.use(requireAuth)
router.use(requireRole(['admin', 'manager']))

// Mirrors EVER_PAID_PAYMENT_STATUSES in src/lib/order-payment-truth.ts and
// crm_ever_paid_statuses() in the migration. An `orders` row exists from the
// moment the payment intent is created, so "has a row" is not "was paid".
const EVER_PAID = ['paid', 'refunded', 'partially_refunded', 'disputed']

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

type Paging = { limit: number; offset: number; page: number }

function paging(req: Request, fallbackLimit = DEFAULT_LIMIT): Paging {
  const rawLimit = Number.parseInt(String(req.query.limit ?? ''), 10)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : fallbackLimit
  const rawPage = Number.parseInt(String(req.query.page ?? ''), 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  return { limit, offset: (page - 1) * limit, page }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * `code` on a PostgREST error when the function does not exist in the schema
 * cache. Anything else is a real failure and must surface, not be swallowed
 * into a silently-degraded answer.
 */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true
  return /could not find the function|does not exist/i.test(error.message || '')
}

const SORTS = new Set(['recent', 'spend', 'orders', 'last_order', 'name'])

/**
 * Turns a date filter into an inclusive UTC instant.
 *
 * A bare `YYYY-MM-DD` from a `<input type="date">` has no time and no zone.
 * Both obvious readings of it are wrong:
 *   - as an END bound it means midnight, which hides everything that happened
 *     on the last day of the range (the client-side filter this replaced had
 *     exactly that bug — a range ending "today" returned nothing from today), and
 *   - fixing it with `setHours(23,59,59)` builds the bound in the SERVER's
 *     local time, so the same query returns different rows depending on which
 *     machine answered it. Render runs UTC, a laptop does not.
 * So a bare date is read as a whole UTC day, explicitly. A full timestamp is
 * passed through as given.
 */
function dayBound(value: string, edge: 'start' | 'end'): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

type CustomerRow = {
  id: string
  email: string
  name: string
  phone: string
  company: string
  role: string
  registrationDate: string | null
  totalSpent: number
  totalOrders: number
  lastOrderDate: string | null
}

/**
 * GET /api/admin/crm/customers?page&limit&search&role&sort
 *
 * One page of customers, each carrying its EXACT lifetime order aggregates —
 * computed by SQL GROUP BY over the whole `orders` table, not over the page.
 */
router.get('/customers', async (req: Request, res: Response): Promise<any> => {
  const { limit, offset, page } = paging(req)
  const search = str(req.query.search)
  const role = str(req.query.role)
  const sortParam = str(req.query.sort)
  const sort = SORTS.has(sortParam) ? sortParam : 'recent'

  try {
    const { data, error } = await supabase.rpc('crm_customer_stats', {
      p_limit: limit,
      p_offset: offset,
      p_search: search || null,
      p_role: role || null,
      p_sort: sort
    })

    if (error) {
      if (!isMissingFunction(error)) {
        console.error('[admin/crm] crm_customer_stats failed:', error)
        return res.status(500).json({ error: error.message })
      }
      const fallback = await customersFallback({ limit, offset, search, role })
      return res.json({ ...fallback, page, limit, sort, mode: 'fallback' })
    }

    const rows = (data || []) as any[]
    const customers: CustomerRow[] = rows.map(r => ({
      id: r.id,
      email: r.email || '',
      name: r.name || 'Unknown',
      phone: r.phone || '',
      company: r.company || '',
      role: r.role || 'customer',
      registrationDate: r.registration_date ?? null,
      totalSpent: Number(r.total_spent || 0),
      totalOrders: Number(r.total_orders || 0),
      lastOrderDate: r.last_order_date ?? null
    }))

    // total_count rides on every row (a window count); an empty page means the
    // filter matched nothing, so 0 is the right total.
    const total = rows.length > 0 ? Number(rows[0].total_count || 0) : 0

    return res.json({ customers, total, page, limit, sort, mode: 'aggregate' })
  } catch (error: any) {
    console.error('[admin/crm] customers error:', error)
    return res.status(500).json({ error: error.message || 'Failed to load customers' })
  }
})

/**
 * Bounded stand-in for the RPC.
 *
 * Still no full-table scan: it reads ONE PAGE of profiles, then reads only the
 * orders belonging to that page's user ids. Every order of a listed customer is
 * counted, so the money on screen is exact — what is lost is the ability to
 * sort or filter globally by spend, which the caller is told about via
 * `mode: 'fallback'`.
 */
async function customersFallback(opts: {
  limit: number
  offset: number
  search: string
  role: string
}): Promise<{ customers: CustomerRow[]; total: number }> {
  let query = supabase
    .from('user_profiles')
    .select(
      'id, email, display_name, full_name, username, first_name, last_name, company_name, shipping_phone, role, created_at',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1)

  if (opts.role) query = query.eq('role', opts.role)
  if (opts.search) {
    const like = `%${opts.search.replace(/[,()]/g, ' ')}%`
    query = query.or(
      `email.ilike.${like},display_name.ilike.${like},full_name.ilike.${like},username.ilike.${like},company_name.ilike.${like}`
    )
  }

  const { data: profiles, error, count } = await query
  if (error) throw error

  const rows = profiles || []
  const ids = rows.map(p => p.id)

  const stats: Record<string, { totalSpent: number; totalOrders: number; lastOrderDate: string | null }> = {}
  if (ids.length > 0) {
    const emails = rows.map(p => (p.email || '').toLowerCase()).filter(Boolean)
    const byEmail = new Map(rows.filter(p => p.email).map(p => [(p.email as string).toLowerCase(), p.id]))

    // Two narrow reads keyed to this page only — never the whole orders table.
    const [ownedRes, guestRes] = await Promise.all([
      supabase.from('orders').select('user_id, customer_email, total, created_at').in('user_id', ids).in('payment_status', EVER_PAID),
      emails.length
        ? supabase
            .from('orders')
            .select('user_id, customer_email, total, created_at')
            .is('user_id', null)
            .in('customer_email', emails)
            .in('payment_status', EVER_PAID)
        : Promise.resolve({ data: [], error: null } as any)
    ])
    if (ownedRes.error) throw ownedRes.error
    if (guestRes.error) throw guestRes.error

    for (const order of [...(ownedRes.data || []), ...(guestRes.data || [])]) {
      const key = order.user_id || byEmail.get(String(order.customer_email || '').toLowerCase())
      if (!key) continue
      const bucket = (stats[key] ||= { totalSpent: 0, totalOrders: 0, lastOrderDate: null })
      bucket.totalSpent += Number(order.total || 0)
      bucket.totalOrders += 1
      if (!bucket.lastOrderDate || order.created_at > bucket.lastOrderDate) bucket.lastOrderDate = order.created_at
    }
  }

  const customers: CustomerRow[] = rows.map((p: any) => {
    const s = stats[p.id] || { totalSpent: 0, totalOrders: 0, lastOrderDate: null }
    const name =
      (p.display_name || '').trim() ||
      (p.full_name || '').trim() ||
      (p.username || '').trim() ||
      `${p.first_name || ''} ${p.last_name || ''}`.trim() ||
      (p.email || '').split('@')[0] ||
      'Unknown'
    return {
      id: p.id,
      email: p.email || '',
      name,
      phone: p.shipping_phone || '',
      company: p.company_name || '',
      role: p.role || 'customer',
      registrationDate: p.created_at ?? null,
      totalSpent: s.totalSpent,
      totalOrders: s.totalOrders,
      lastOrderDate: s.lastOrderDate
    }
  })

  return { customers, total: count ?? customers.length }
}

/**
 * GET /api/admin/crm/totals
 *
 * The header cards. Whole-table numbers, so they do not change when the admin
 * turns a page — which is exactly what happened when they were summed from
 * whatever rows the browser had loaded.
 */
router.get('/totals', async (_req: Request, res: Response): Promise<any> => {
  try {
    const { data, error } = await supabase.rpc('crm_dashboard_totals')
    if (error) {
      if (!isMissingFunction(error)) {
        console.error('[admin/crm] crm_dashboard_totals failed:', error)
        return res.status(500).json({ error: error.message })
      }
      // head:true counts do not transfer rows, so this fallback is cheap.
      const [customers, paidOrders, allOrders] = await Promise.all([
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }),
        supabase.from('orders').select('id', { count: 'exact', head: true }).in('payment_status', EVER_PAID),
        supabase.from('orders').select('id', { count: 'exact', head: true })
      ])
      return res.json({
        customers: customers.count ?? 0,
        paidOrders: paidOrders.count ?? 0,
        unpaidDrafts: Math.max((allOrders.count ?? 0) - (paidOrders.count ?? 0), 0),
        pendingOrders: 0,
        revenue: null, // no honest way to sum without the aggregate — say so
        mode: 'fallback'
      })
    }

    const row: any = Array.isArray(data) ? data[0] : data
    return res.json({
      customers: Number(row?.customers || 0),
      paidOrders: Number(row?.paid_orders || 0),
      unpaidDrafts: Number(row?.unpaid_drafts || 0),
      pendingOrders: Number(row?.pending_orders || 0),
      revenue: Number(row?.revenue || 0),
      mode: 'aggregate'
    })
  } catch (error: any) {
    console.error('[admin/crm] totals error:', error)
    return res.status(500).json({ error: error.message || 'Failed to load totals' })
  }
})

/**
 * GET /api/admin/crm/segments
 *
 * Analytics tab: role segments (SQL GROUP BY) + the five biggest spenders
 * (the same aggregate, sorted by spend, limit 5). Both used to be derived by
 * scanning the full in-memory customer array.
 */
router.get('/segments', async (_req: Request, res: Response): Promise<any> => {
  try {
    const [segmentsRes, topRes] = await Promise.all([
      supabase.rpc('crm_role_segments'),
      supabase.rpc('crm_customer_stats', {
        p_limit: 5,
        p_offset: 0,
        p_search: null,
        p_role: null,
        p_sort: 'spend'
      })
    ])

    if (segmentsRes.error && !isMissingFunction(segmentsRes.error)) {
      return res.status(500).json({ error: segmentsRes.error.message })
    }
    if (topRes.error && !isMissingFunction(topRes.error)) {
      return res.status(500).json({ error: topRes.error.message })
    }

    const segments = (segmentsRes.data || []).map((r: any) => ({
      role: r.role || 'customer',
      customers: Number(r.customers || 0)
    }))
    const topCustomers = (topRes.data || []).map((r: any) => ({
      id: r.id,
      name: r.name || 'Unknown',
      totalSpent: Number(r.total_spent || 0)
    }))

    return res.json({
      segments,
      topCustomers,
      mode: segmentsRes.error || topRes.error ? 'fallback' : 'aggregate'
    })
  } catch (error: any) {
    console.error('[admin/crm] segments error:', error)
    return res.status(500).json({ error: error.message || 'Failed to load segments' })
  }
})

/**
 * GET /api/admin/crm/orders?page&limit&status&search&start&end&userId
 *
 * One page of orders with the line items for that page only. The CRM used to
 * fetch every order row and then filter in the browser; worse, it mapped
 * `items: order.items` — a column that does not exist — so every order rendered
 * and exported with an empty item list.
 */
router.get('/orders', async (req: Request, res: Response): Promise<any> => {
  const { limit, offset, page } = paging(req)
  const status = str(req.query.status)
  const search = str(req.query.search)
  const start = str(req.query.start)
  const end = str(req.query.end)
  const userId = str(req.query.userId)
  const paidOnly = str(req.query.paidOnly) === 'true'

  try {
    let query = supabase
      .from('orders')
      .select(
        'id, order_number, user_id, customer_name, customer_email, status, payment_status, total, ' +
          'tracking_number, shipping_label_url, estimated_delivery, shipping_address, notes, internal_notes, created_at',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status && status !== 'all') query = query.eq('status', status)
    if (userId) query = query.eq('user_id', userId)
    if (paidOnly) query = query.in('payment_status', EVER_PAID)
    if (start) {
      const from = dayBound(start, 'start')
      if (from) query = query.gte('created_at', from)
    }
    if (end) {
      const to = dayBound(end, 'end')
      if (to) query = query.lte('created_at', to)
    }
    if (search) {
      const like = `%${search.replace(/[,()]/g, ' ')}%`
      query = query.or(`customer_name.ilike.${like},customer_email.ilike.${like},order_number.ilike.${like}`)
    }

    const { data, error, count } = await query
    if (error) throw error

    const rows = (data || []) as any[]

    // Line items for THIS PAGE only.
    const itemsByOrder: Record<string, Array<{ name: string; quantity: number; unitPrice: number }>> = {}
    if (rows.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('order_id, product_name, quantity, unit_price')
        .in('order_id', rows.map(o => o.id))
      // A missing order_items table must not take the orders tab down with it.
      if (itemsError) {
        console.warn('[admin/crm] order_items read failed:', itemsError.message)
      } else {
        for (const item of items || []) {
          ;(itemsByOrder[item.order_id] ||= []).push({
            name: item.product_name || 'Item',
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unit_price || 0)
          })
        }
      }
    }

    const orders = rows.map((o: any) => ({
      id: o.id,
      orderNumber: o.order_number || null,
      userId: o.user_id || null,
      customerName: o.customer_name || '',
      customerEmail: o.customer_email || '',
      status: o.status || 'pending',
      paymentStatus: o.payment_status || null,
      everPaid: EVER_PAID.includes(String(o.payment_status || '').toLowerCase()),
      total: Number(o.total || 0),
      trackingNumber: o.tracking_number || undefined,
      shippingLabelUrl: o.shipping_label_url || undefined,
      estimatedDelivery: o.estimated_delivery || undefined,
      shippingAddress: o.shipping_address || {},
      customerNotes: o.notes || undefined,
      internalNotes: o.internal_notes || undefined,
      createdAt: o.created_at,
      items: itemsByOrder[o.id] || []
    }))

    return res.json({ orders, total: count ?? orders.length, page, limit })
  } catch (error: any) {
    console.error('[admin/crm] orders error:', error)
    return res.status(500).json({ error: error.message || 'Failed to load orders' })
  }
})

export default router
