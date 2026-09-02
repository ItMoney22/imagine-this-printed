// Filament + paint inventory (print_materials). The AMS takes 4 spools, so
// every full-color toy order gets a ≤4-color filament plan matched against
// THIS stock by hex — and paint kits pack paints matched the same way. Keep
// the hex honest: it is the matching key.
import React, { useState, useEffect } from 'react'
import { Plus, Droplets, AlertTriangle, Trash2, Pencil, X } from 'lucide-react'
import api from '../lib/api'

export interface PrintMaterial {
  id: string
  kind: 'filament' | 'paint'
  brand: string
  material: string
  color_name: string
  hex: string
  qty_on_hand: number
  reorder_threshold: number
  cost_per_unit: number | null
  grams_per_unit: number | null
  supplier: string | null
  notes: string | null
  is_active: boolean
  low_stock?: boolean
}

const emptyForm = {
  kind: 'filament' as 'filament' | 'paint',
  brand: '',
  material: 'PLA',
  color_name: '',
  hex: '#22aa55',
  qty_on_hand: '1',
  reorder_threshold: '1',
  cost_per_unit: '',
  grams_per_unit: '',
  supplier: ''
}

export default function AdminPrintMaterials() {
  const [items, setItems] = useState<PrintMaterial[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | 'filament' | 'paint'>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<PrintMaterial | null>(null)
  const [editQty, setEditQty] = useState('')
  const [processing, setProcessing] = useState(false)

  useEffect(() => { void fetchItems() }, [])

  const flash = (msg: string) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 4000)
  }

  const fetchItems = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.get('/api/admin/print-materials')
      setItems(response.data.items || [])
    } catch (err: any) {
      console.error('Error fetching print materials:', err)
      setError(err.response?.data?.error || 'Failed to load print materials')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = async () => {
    if (!form.brand.trim() || !form.material.trim() || !form.color_name.trim()) {
      setError('Brand, material and color name are required')
      return
    }
    setProcessing(true)
    setError(null)
    try {
      await api.post('/api/admin/print-materials', {
        ...form,
        qty_on_hand: Number(form.qty_on_hand) || 0,
        reorder_threshold: Number(form.reorder_threshold) || 1,
        cost_per_unit: form.cost_per_unit === '' ? null : Number(form.cost_per_unit),
        grams_per_unit: form.grams_per_unit === '' ? null : Number(form.grams_per_unit),
        supplier: form.supplier || null
      })
      flash(`${form.kind === 'filament' ? 'Filament' : 'Paint'} "${form.color_name}" added`)
      setShowAdd(false)
      setForm(emptyForm)
      await fetchItems()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to add material')
    } finally {
      setProcessing(false)
    }
  }

  const handleSaveQty = async () => {
    if (!editing) return
    setProcessing(true)
    setError(null)
    try {
      await api.put(`/api/admin/print-materials/${editing.id}`, { qty_on_hand: Number(editQty) || 0 })
      flash(`${editing.color_name} quantity updated`)
      setEditing(null)
      await fetchItems()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update quantity')
    } finally {
      setProcessing(false)
    }
  }

  const handleToggleActive = async (item: PrintMaterial) => {
    try {
      await api.put(`/api/admin/print-materials/${item.id}`, { is_active: !item.is_active })
      await fetchItems()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update material')
    }
  }

  const handleDelete = async (item: PrintMaterial) => {
    if (!window.confirm(`Delete ${item.brand} ${item.color_name}? This cannot be undone.`)) return
    try {
      await api.delete(`/api/admin/print-materials/${item.id}`)
      flash(`${item.color_name} deleted`)
      await fetchItems()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete material')
    }
  }

  const visible = items.filter(i => kindFilter === 'all' || i.kind === kindFilter)
  const lowCount = items.filter(i => i.low_stock).length

  return (
    <div className="bg-card rounded-lg shadow-lg p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-bold text-text flex items-center gap-2">
            <Droplets className="w-5 h-5 text-primary" />
            Filament &amp; Paint Inventory
          </h2>
          <p className="text-sm text-muted mt-0.5">
            Full-color toy orders auto-match up to 4 filament colors (AMS limit) from this
            stock; paint kits pack paints the same way. The hex swatch is the matching key.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lowCount > 0 && (
            <span className="flex items-center gap-1 text-amber-500 text-sm font-medium">
              <AlertTriangle className="w-4 h-4" /> {lowCount} low
            </span>
          )}
          <select
            value={kindFilter}
            onChange={e => setKindFilter(e.target.value as any)}
            className="px-2 py-1.5 rounded-md border card-border bg-bg text-text text-sm"
          >
            <option value="all">All</option>
            <option value="filament">Filament</option>
            <option value="paint">Paint</option>
          </select>
          <button
            onClick={() => { setShowAdd(true); setError(null) }}
            className="flex items-center gap-1 bg-primary text-white text-sm font-medium px-3 py-1.5 rounded-md hover:opacity-90"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      {error && <div className="mb-3 p-3 rounded-md bg-red-500/10 text-red-500 text-sm">{error}</div>}
      {success && <div className="mb-3 p-3 rounded-md bg-green-500/10 text-green-500 text-sm">{success}</div>}

      {loading ? (
        <p className="text-muted text-sm py-8 text-center">Loading materials…</p>
      ) : visible.length === 0 ? (
        <p className="text-muted text-sm py-8 text-center">
          No {kindFilter === 'all' ? 'materials' : kindFilter} yet — add the spools/bottles on the shelf so
          orders can tell the floor which colors to load.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b card-border">
                <th className="py-2 pr-3">Color</th>
                <th className="py-2 pr-3">Kind</th>
                <th className="py-2 pr-3">Brand / Material</th>
                <th className="py-2 pr-3">On hand</th>
                <th className="py-2 pr-3">Cost</th>
                <th className="py-2 pr-3">Active</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(item => (
                <tr key={item.id} className={`border-b card-border ${!item.is_active ? 'opacity-50' : ''}`}>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full border border-white/20 shrink-0" style={{ backgroundColor: item.hex }} />
                      <span className="font-medium text-text">{item.color_name}</span>
                      <span className="text-xs text-muted">{item.hex}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-3 capitalize">{item.kind}</td>
                  <td className="py-2 pr-3">{item.brand} · {item.material}</td>
                  <td className="py-2 pr-3">
                    <span className={item.low_stock ? 'text-amber-500 font-semibold' : 'text-text'}>
                      {item.qty_on_hand}
                    </span>
                    {item.low_stock && <span className="ml-1 text-xs text-amber-500">low</span>}
                  </td>
                  <td className="py-2 pr-3">{item.cost_per_unit != null ? `$${Number(item.cost_per_unit).toFixed(2)}` : '—'}</td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => handleToggleActive(item)}
                      className={`text-xs px-2 py-0.5 rounded-full ${item.is_active ? 'bg-green-500/15 text-green-500' : 'bg-gray-500/15 text-muted'}`}
                    >
                      {item.is_active ? 'active' : 'off'}
                    </button>
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => { setEditing(item); setEditQty(String(item.qty_on_hand)); setError(null) }}
                      className="p-1.5 text-muted hover:text-primary"
                      title="Edit quantity"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      className="p-1.5 text-muted hover:text-red-500"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative z-10 bg-card border card-border rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text">Add material</h3>
              <button onClick={() => setShowAdd(false)} className="text-muted hover:text-text"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-text">
                  Kind
                  <select
                    value={form.kind}
                    onChange={e => setForm(f => ({ ...f, kind: e.target.value as any, material: e.target.value === 'paint' ? 'acrylic' : 'PLA' }))}
                    className="mt-1 w-full px-2 py-1.5 rounded-md border card-border bg-bg text-text"
                  >
                    <option value="filament">Filament spool</option>
                    <option value="paint">Paint bottle</option>
                  </select>
                </label>
                <label className="text-sm text-text">
                  Material
                  <input value={form.material} onChange={e => setForm(f => ({ ...f, material: e.target.value }))}
                    placeholder="PLA / PETG / acrylic" className="mt-1 w-full px-2 py-1.5 rounded-md border card-border bg-bg text-text" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-text">
                  Brand
                  <input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                    placeholder="Bambu / Polymaker" className="mt-1 w-full px-2 py-1.5 rounded-md border card-border bg-bg text-text" />
                </label>
                <label className="text-sm text-text">
                  Color name
                  <input value={form.color_name} onChange={e => setForm(f => ({ ...f, color_name: e.target.value }))}
                    placeholder="Fire Engine Red" className="mt-1 w-full px-2 py-1.5 rounded-md border card-border bg-bg text-text" />
                </label>
              </div>
              <label className="text-sm text-text block">
                Color (matching key)
                <span className="mt-1 flex items-center gap-2">
                  <input type="color" value={form.hex} onChange={e => setForm(f => ({ ...f, hex: e.target.value }))} className="h-9 w-14 rounded cursor-pointer border card-border bg-bg" />
                  <input value={form.hex} onChange={e => setForm(f => ({ ...f, hex: e.target.value }))} className="flex-1 px-2 py-1.5 rounded-md border card-border bg-bg text-text" />
                </span>
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="text-sm text-text">
                  Qty on hand
                  <input type="number" min="0" value={form.qty_on_hand} onChange={e => setForm(f => ({ ...f, qty_on_hand: e.target.value }))}
                    className="mt-1 w-full px-2 py-1.5 rounded-md border card-border bg-bg text-text" />
                </label>
                <label className="text-sm text-text">
                  Reorder at
                  <input type="number" min="0" value={form.reorder_threshold} onChange={e => setForm(f => ({ ...f, reorder_threshold: e.target.value }))}
                    className="mt-1 w-full px-2 py-1.5 rounded-md border card-border bg-bg text-text" />
                </label>
                <label className="text-sm text-text">
                  Cost/unit
                  <input type="number" min="0" step="0.01" value={form.cost_per_unit} onChange={e => setForm(f => ({ ...f, cost_per_unit: e.target.value }))}
                    placeholder="24.99" className="mt-1 w-full px-2 py-1.5 rounded-md border card-border bg-bg text-text" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-text">
                  {form.kind === 'filament' ? 'Grams per spool' : 'ml per bottle'}
                  <input type="number" min="0" value={form.grams_per_unit} onChange={e => setForm(f => ({ ...f, grams_per_unit: e.target.value }))}
                    placeholder={form.kind === 'filament' ? '1000' : '59'} className="mt-1 w-full px-2 py-1.5 rounded-md border card-border bg-bg text-text" />
                </label>
                <label className="text-sm text-text">
                  Supplier
                  <input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))}
                    placeholder="Amazon / Bambu store" className="mt-1 w-full px-2 py-1.5 rounded-md border card-border bg-bg text-text" />
                </label>
              </div>
              <button
                onClick={handleAdd}
                disabled={processing}
                className="w-full bg-primary text-white font-medium py-2 rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {processing ? 'Adding…' : 'Add material'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit qty modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditing(null)} />
          <div className="relative z-10 bg-card border card-border rounded-xl shadow-2xl w-full max-w-xs p-6">
            <h3 className="text-lg font-semibold text-text mb-3">
              {editing.brand} — {editing.color_name}
            </h3>
            <label className="text-sm text-text block">
              Quantity on hand
              <input
                type="number"
                min="0"
                value={editQty}
                onChange={e => setEditQty(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 rounded-md border card-border bg-bg text-text"
                autoFocus
              />
            </label>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setEditing(null)} className="flex-1 py-2 rounded-md border card-border text-muted text-sm hover:bg-text/5">Cancel</button>
              <button onClick={handleSaveQty} disabled={processing} className="flex-1 py-2 rounded-md bg-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
                {processing ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
