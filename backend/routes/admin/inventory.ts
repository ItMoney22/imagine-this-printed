// Admin blank-shirt inventory: CRUD, receive-stock, adjustments, movement
// history, low-stock listing. Mounted at /api/admin/inventory.
// Sale decrements do NOT go through here — they run automatically on paid
// orders via services/blank-inventory.ts.
import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'

const router = Router()

router.use(requireAuth)
router.use(requireRole(['admin', 'manager']))

const clean = (v: unknown): string => String(v ?? '').trim()

function validateBlankInput(body: any): { error?: string; row?: Record<string, any> } {
  const brand = clean(body.brand)
  const styleCode = clean(body.style_code)
  const color = clean(body.color)
  const size = clean(body.size)
  if (!brand || !styleCode || !color || !size) {
    return { error: 'brand, style_code, color and size are required' }
  }
  const qty = Number(body.qty_on_hand ?? 0)
  const threshold = Number(body.reorder_threshold ?? 12)
  if (!Number.isFinite(qty) || !Number.isFinite(threshold) || threshold < 0) {
    return { error: 'qty_on_hand and reorder_threshold must be numbers' }
  }
  return {
    row: {
      brand,
      style_code: styleCode,
      color,
      size,
      qty_on_hand: Math.trunc(qty),
      reorder_threshold: Math.trunc(threshold),
      reorder_qty: body.reorder_qty != null && body.reorder_qty !== '' ? Math.trunc(Number(body.reorder_qty)) : null,
      cost_per_unit: body.cost_per_unit != null && body.cost_per_unit !== '' ? Number(body.cost_per_unit) : null,
      supplier: clean(body.supplier) || null,
      notes: clean(body.notes) || null
    }
  }
}

// GET /api/admin/inventory - all blanks + low-stock flag
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('blank_inventory')
      .select('*')
      .order('brand')
      .order('style_code')
      .order('color')
      .order('size')
    if (error) throw error
    const items = (data || []).map(b => ({ ...b, low_stock: b.qty_on_hand <= b.reorder_threshold }))
    res.json({ items, low_stock_count: items.filter(i => i.low_stock).length })
  } catch (error: any) {
    console.error('[admin/inventory] list failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/inventory - create one blank SKU
router.post('/', async (req: Request, res: Response) => {
  try {
    const { error: vError, row } = validateBlankInput(req.body)
    if (vError) return res.status(400).json({ error: vError })

    const { data, error } = await supabase.from('blank_inventory').insert(row!).select().single()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That brand/style/color/size already exists' })
      throw error
    }
    if (row!.qty_on_hand !== 0) {
      await supabase.from('blank_inventory_movements').insert({
        blank_id: data.id,
        delta: row!.qty_on_hand,
        reason: 'received',
        unit_cost: row!.cost_per_unit,
        note: 'Initial stock entry',
        created_by: req.user?.sub ?? null
      })
    }
    return res.status(201).json({ item: data })
  } catch (error: any) {
    console.error('[admin/inventory] create failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/inventory/bulk - create many SKUs at once (stock onboarding:
// one brand/style/color, several size/qty pairs)
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const entries = Array.isArray(req.body?.items) ? req.body.items : []
    if (entries.length === 0) return res.status(400).json({ error: 'items array is required' })
    if (entries.length > 100) return res.status(400).json({ error: 'Max 100 items per bulk create' })

    const rows: Record<string, any>[] = []
    for (const entry of entries) {
      const { error: vError, row } = validateBlankInput(entry)
      if (vError) return res.status(400).json({ error: `${vError} (item ${rows.length + 1})` })
      rows.push(row!)
    }

    const { data, error } = await supabase.from('blank_inventory').insert(rows).select()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'One of those brand/style/color/size rows already exists' })
      throw error
    }
    const movements = (data || [])
      .filter(d => d.qty_on_hand !== 0)
      .map(d => ({
        blank_id: d.id,
        delta: d.qty_on_hand,
        reason: 'received',
        unit_cost: d.cost_per_unit,
        note: 'Initial stock entry',
        created_by: req.user?.sub ?? null
      }))
    if (movements.length > 0) await supabase.from('blank_inventory_movements').insert(movements)
    return res.status(201).json({ items: data })
  } catch (error: any) {
    console.error('[admin/inventory] bulk create failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// PUT /api/admin/inventory/:id - edit SKU fields (not quantity — use
// /receive or /adjust so the movement ledger stays truthful)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const allowed = ['brand', 'style_code', 'color', 'size', 'reorder_threshold', 'reorder_qty', 'cost_per_unit', 'supplier', 'notes']
    const updates: Record<string, any> = {}
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key]
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No editable fields provided' })
    updates.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('blank_inventory')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    return res.json({ item: data })
  } catch (error: any) {
    console.error('[admin/inventory] update failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/inventory/:id/receive - stock arrived
router.post('/:id/receive', async (req: Request, res: Response) => {
  try {
    const qty = Math.trunc(Number(req.body?.qty))
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'qty must be a positive number' })
    const unitCost = req.body?.cost_per_unit != null && req.body.cost_per_unit !== '' ? Number(req.body.cost_per_unit) : null

    const { data: blank, error: fetchError } = await supabase
      .from('blank_inventory')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (fetchError || !blank) return res.status(404).json({ error: 'Blank not found' })

    const newQty = blank.qty_on_hand + qty
    const updates: Record<string, any> = {
      qty_on_hand: newQty,
      updated_at: new Date().toISOString()
    }
    if (unitCost != null) updates.cost_per_unit = unitCost
    // Re-arm the low-stock alert once we're back above threshold.
    if (newQty > blank.reorder_threshold) updates.last_alerted_at = null

    const { data, error } = await supabase
      .from('blank_inventory')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error

    await supabase.from('blank_inventory_movements').insert({
      blank_id: req.params.id,
      delta: qty,
      reason: 'received',
      unit_cost: unitCost ?? blank.cost_per_unit,
      note: clean(req.body?.note) || null,
      created_by: req.user?.sub ?? null
    })
    return res.json({ item: data })
  } catch (error: any) {
    console.error('[admin/inventory] receive failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/inventory/:id/adjust - set counted quantity (cycle count,
// shrinkage, damage). Body: { new_qty, reason?, note? }
router.post('/:id/adjust', async (req: Request, res: Response) => {
  try {
    const newQty = Math.trunc(Number(req.body?.new_qty))
    if (!Number.isFinite(newQty)) return res.status(400).json({ error: 'new_qty must be a number' })
    const reason = req.body?.reason === 'shrinkage' ? 'shrinkage' : 'adjustment'

    const { data: blank, error: fetchError } = await supabase
      .from('blank_inventory')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (fetchError || !blank) return res.status(404).json({ error: 'Blank not found' })

    const delta = newQty - blank.qty_on_hand
    const updates: Record<string, any> = {
      qty_on_hand: newQty,
      updated_at: new Date().toISOString()
    }
    if (newQty > blank.reorder_threshold) updates.last_alerted_at = null

    const { data, error } = await supabase
      .from('blank_inventory')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error

    if (delta !== 0) {
      await supabase.from('blank_inventory_movements').insert({
        blank_id: req.params.id,
        delta,
        reason,
        note: clean(req.body?.note) || null,
        created_by: req.user?.sub ?? null
      })
    }
    return res.json({ item: data })
  } catch (error: any) {
    console.error('[admin/inventory] adjust failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/admin/inventory/:id/movements - ledger for one SKU
router.get('/:id/movements', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('blank_inventory_movements')
      .select('*')
      .eq('blank_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error
    return res.json({ movements: data || [] })
  } catch (error: any) {
    console.error('[admin/inventory] movements failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// DELETE /api/admin/inventory/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabase.from('blank_inventory').delete().eq('id', req.params.id)
    if (error) throw error
    return res.json({ success: true })
  } catch (error: any) {
    console.error('[admin/inventory] delete failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
