import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'
import { readDiscountInput, storeToday, type DiscountCodeRow } from '../lib/vendor-store-discount-codes.js'

// Her discount codes in her store manager (David 2026-10-26: "she should be able to give a discount to her peeps
// but whatever she does cuts at her own cost"). Percent or dollars off, an optional last day, on/off. Buyers type
// one in her cart; the checkout (routes/vendor-store.ts) takes it off her share only (lib/vendor-store-split.ts).
// Mounted behind requireStoreManager in routes/vendor-store.ts, so req.vendorStore is set: the store's owner and
// ITP admins only.
//
//   GET   /api/vendor-store/manage/:slug/discounts        her codes, newest first
//   POST  /api/vendor-store/manage/:slug/discounts        { code, kind, amount, endsOn?, active? }
//   PATCH /api/vendor-store/manage/:slug/discounts/:id    any of those
// amount: whole percent for kind 'percent', cents for kind 'amount'. endsOn: 'YYYY-MM-DD' (last day it works) or null.
const router = Router({ mergeParams: true })

const publicCode = (r: DiscountCodeRow) => ({
  id: r.id,
  code: r.code,
  kind: r.kind,
  amount: r.amount,
  endsOn: r.ends_on,
  active: r.active,
  createdAt: r.created_at
})

const taken = (code: string) => `You already have a code called ${code}.`

router.get('/', async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const { data, error } = await supabase
    .from('vendor_store_discount_codes')
    .select('*')
    .eq('storefront_id', store.id)
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: 'Your codes didn’t load' })
  return res.json({ codes: ((data || []) as DiscountCodeRow[]).map(publicCode), today: storeToday() })
})

router.post('/', async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const read = readDiscountInput(req.body)
  if ('problem' in read) return res.status(400).json({ error: read.problem })
  const { data, error } = await supabase
    .from('vendor_store_discount_codes')
    .insert({ ...read.fields, storefront_id: store.id })
    .select()
    .single()
  if (error?.code === '23505') return res.status(409).json({ error: taken(read.fields.code!) })
  if (error || !data) return res.status(500).json({ error: 'The code didn’t save' })
  return res.json({ code: publicCode(data as DiscountCodeRow) })
})

router.patch('/:id', async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const { data: current } = await supabase
    .from('vendor_store_discount_codes').select('*').eq('id', req.params.id).eq('storefront_id', store.id).maybeSingle()
  if (!current) return res.status(404).json({ error: 'Code not found' })
  const read = readDiscountInput(req.body, current as DiscountCodeRow)
  if ('problem' in read) return res.status(400).json({ error: read.problem })
  if (!Object.keys(read.fields).length) return res.status(400).json({ error: 'Nothing to change' })
  const { data, error } = await supabase
    .from('vendor_store_discount_codes')
    .update({ ...read.fields, updated_at: new Date().toISOString() })
    .eq('id', current.id)
    .select()
    .single()
  if (error?.code === '23505') return res.status(409).json({ error: taken(read.fields.code!) })
  if (error || !data) return res.status(500).json({ error: 'The code didn’t save' })
  return res.json({ code: publicCode(data as DiscountCodeRow) })
})

export default router
