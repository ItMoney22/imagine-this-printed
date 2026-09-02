// Admin print-materials inventory: filament spools + paint bottles.
// Mounted at /api/admin/print-materials. The AMS takes 4 spools, so the
// matcher (services/print-palette.ts) only ever needs ≤4 in-stock colors per
// order; this CRUD keeps that stock truthful. No movement ledger for v1 —
// filament isn't decremented per order (no per-print gram data yet), the
// floor adjusts counts by hand.
import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'

const router = Router()

router.use(requireAuth)
router.use(requireRole(['admin', 'manager']))

const clean = (v: unknown): string => String(v ?? '').trim()
const HEX_RE = /^#[0-9a-fA-F]{6}$/

function validateMaterialInput(body: any): { error?: string; row?: Record<string, any> } {
  const kind = clean(body.kind).toLowerCase()
  if (kind !== 'filament' && kind !== 'paint') {
    return { error: "kind must be 'filament' or 'paint'" }
  }
  const brand = clean(body.brand)
  const material = clean(body.material)
  const colorName = clean(body.color_name)
  const hex = clean(body.hex).toLowerCase()
  if (!brand || !material || !colorName) {
    return { error: 'brand, material and color_name are required' }
  }
  if (!HEX_RE.test(hex)) {
    return { error: 'hex must look like #rrggbb — it is the color-matching key' }
  }
  const qty = Number(body.qty_on_hand ?? 0)
  const threshold = Number(body.reorder_threshold ?? 1)
  if (!Number.isFinite(qty) || !Number.isFinite(threshold) || threshold < 0) {
    return { error: 'qty_on_hand and reorder_threshold must be numbers' }
  }
  return {
    row: {
      kind,
      brand,
      material,
      color_name: colorName,
      hex,
      qty_on_hand: Math.trunc(qty),
      reorder_threshold: Math.trunc(threshold),
      cost_per_unit: body.cost_per_unit != null && body.cost_per_unit !== '' ? Number(body.cost_per_unit) : null,
      grams_per_unit: body.grams_per_unit != null && body.grams_per_unit !== '' ? Number(body.grams_per_unit) : null,
      supplier: clean(body.supplier) || null,
      notes: clean(body.notes) || null,
      is_active: body.is_active === false ? false : true
    }
  }
}

// GET /api/admin/print-materials?kind=filament — list + low-stock flag
router.get('/', async (req: Request, res: Response) => {
  try {
    let query = supabase
      .from('print_materials')
      .select('*')
      .order('kind')
      .order('brand')
      .order('color_name')
    const kind = clean(req.query.kind).toLowerCase()
    if (kind === 'filament' || kind === 'paint') query = query.eq('kind', kind)
    const { data, error } = await query
    if (error) throw error
    const items = (data || []).map(m => ({ ...m, low_stock: m.qty_on_hand <= m.reorder_threshold }))
    res.json({ items, low_stock_count: items.filter(i => i.low_stock).length })
  } catch (error: any) {
    console.error('[admin/print-materials] list failed:', error)
    res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/print-materials — create one material
router.post('/', async (req: Request, res: Response) => {
  try {
    const { error: vError, row } = validateMaterialInput(req.body)
    if (vError) return res.status(400).json({ error: vError })
    const { data, error } = await supabase.from('print_materials').insert(row!).select().single()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That kind/brand/material/color already exists' })
      throw error
    }
    return res.status(201).json({ item: data })
  } catch (error: any) {
    console.error('[admin/print-materials] create failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/print-materials/bulk — onboard many at once
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const entries = Array.isArray(req.body?.items) ? req.body.items : []
    if (entries.length === 0) return res.status(400).json({ error: 'items array is required' })
    if (entries.length > 100) return res.status(400).json({ error: 'Max 100 items per bulk create' })
    const rows: Record<string, any>[] = []
    for (const entry of entries) {
      const { error: vError, row } = validateMaterialInput(entry)
      if (vError) return res.status(400).json({ error: `${vError} (item ${rows.length + 1})` })
      rows.push(row!)
    }
    const { data, error } = await supabase.from('print_materials').insert(rows).select()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'One of those kind/brand/material/color rows already exists' })
      throw error
    }
    return res.status(201).json({ items: data })
  } catch (error: any) {
    console.error('[admin/print-materials] bulk create failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// PUT /api/admin/print-materials/:id — edit fields (qty included; no ledger v1)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const allowed = [
      'brand', 'material', 'color_name', 'hex', 'qty_on_hand',
      'reorder_threshold', 'cost_per_unit', 'grams_per_unit',
      'supplier', 'notes', 'is_active'
    ]
    const updates: Record<string, any> = {}
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key]
    }
    if (typeof updates.hex === 'string') {
      updates.hex = updates.hex.trim().toLowerCase()
      if (!HEX_RE.test(updates.hex)) return res.status(400).json({ error: 'hex must look like #rrggbb' })
    }
    if ('qty_on_hand' in updates) {
      const qty = Math.trunc(Number(updates.qty_on_hand))
      if (!Number.isFinite(qty)) return res.status(400).json({ error: 'qty_on_hand must be a number' })
      updates.qty_on_hand = qty
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No editable fields provided' })
    updates.updated_at = new Date().toISOString()
    const { data, error } = await supabase
      .from('print_materials')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    return res.json({ item: data })
  } catch (error: any) {
    console.error('[admin/print-materials] update failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// DELETE /api/admin/print-materials/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabase.from('print_materials').delete().eq('id', req.params.id)
    if (error) throw error
    return res.json({ success: true })
  } catch (error: any) {
    console.error('[admin/print-materials] delete failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
