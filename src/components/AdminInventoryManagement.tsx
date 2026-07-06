import React, { useState, useEffect } from 'react'
import { Plus, Package, AlertTriangle, History, Pencil, Trash2, X } from 'lucide-react'
import api from '../lib/api'
import type { BlankInventoryItem, BlankInventoryMovement } from '../types'

const SIZE_PRESET = ['S', 'M', 'L', 'XL', '2XL', '3XL']

interface SizeQtyRow {
  size: string
  qty: string
}

const emptyBulkForm = {
  brand: '',
  style_code: '',
  color: '',
  cost_per_unit: '',
  reorder_threshold: '12',
  reorder_qty: '',
  supplier: ''
}

export default function AdminInventoryManagement() {
  const [items, setItems] = useState<BlankInventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [lowOnly, setLowOnly] = useState(false)

  // Add-blanks modal (one brand/style/color, several size rows)
  const [showAddModal, setShowAddModal] = useState(false)
  const [bulkForm, setBulkForm] = useState(emptyBulkForm)
  const [sizeRows, setSizeRows] = useState<SizeQtyRow[]>(SIZE_PRESET.map(s => ({ size: s, qty: '' })))

  // Edit modal
  const [editing, setEditing] = useState<BlankInventoryItem | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})

  // Receive / adjust inline state
  const [receiveFor, setReceiveFor] = useState<BlankInventoryItem | null>(null)
  const [receiveQty, setReceiveQty] = useState('')
  const [receiveCost, setReceiveCost] = useState('')
  const [adjustFor, setAdjustFor] = useState<BlankInventoryItem | null>(null)
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustNote, setAdjustNote] = useState('')

  // Movement history drawer
  const [historyFor, setHistoryFor] = useState<BlankInventoryItem | null>(null)
  const [movements, setMovements] = useState<BlankInventoryMovement[]>([])

  useEffect(() => {
    fetchItems()
  }, [])

  const flash = (msg: string) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 4000)
  }

  const fetchItems = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.get('/api/admin/inventory')
      setItems(response.data.items || [])
    } catch (err: any) {
      console.error('Error fetching inventory:', err)
      setError(err.response?.data?.error || 'Failed to load inventory')
    } finally {
      setLoading(false)
    }
  }

  const handleBulkAdd = async () => {
    const rows = sizeRows.filter(r => r.size.trim() && r.qty.trim() !== '')
    if (!bulkForm.brand.trim() || !bulkForm.style_code.trim() || !bulkForm.color.trim() || rows.length === 0) {
      setError('Brand, style, color and at least one size quantity are required')
      return
    }
    try {
      setProcessing(true)
      setError(null)
      await api.post('/api/admin/inventory/bulk', {
        items: rows.map(r => ({
          brand: bulkForm.brand,
          style_code: bulkForm.style_code,
          color: bulkForm.color,
          size: r.size,
          qty_on_hand: Number(r.qty),
          reorder_threshold: Number(bulkForm.reorder_threshold) || 12,
          reorder_qty: bulkForm.reorder_qty || null,
          cost_per_unit: bulkForm.cost_per_unit || null,
          supplier: bulkForm.supplier || null
        }))
      })
      setShowAddModal(false)
      setBulkForm(emptyBulkForm)
      setSizeRows(SIZE_PRESET.map(s => ({ size: s, qty: '' })))
      flash('Blanks added')
      fetchItems()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to add blanks')
    } finally {
      setProcessing(false)
    }
  }

  const handleEditSave = async () => {
    if (!editing) return
    try {
      setProcessing(true)
      setError(null)
      await api.put(`/api/admin/inventory/${editing.id}`, {
        brand: editForm.brand,
        style_code: editForm.style_code,
        color: editForm.color,
        size: editForm.size,
        reorder_threshold: Number(editForm.reorder_threshold) || 0,
        reorder_qty: editForm.reorder_qty === '' ? null : Number(editForm.reorder_qty),
        cost_per_unit: editForm.cost_per_unit === '' ? null : Number(editForm.cost_per_unit),
        supplier: editForm.supplier || null,
        notes: editForm.notes || null
      })
      setEditing(null)
      flash('Blank updated')
      fetchItems()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update')
    } finally {
      setProcessing(false)
    }
  }

  const handleReceive = async () => {
    if (!receiveFor || !receiveQty) return
    try {
      setProcessing(true)
      setError(null)
      await api.post(`/api/admin/inventory/${receiveFor.id}/receive`, {
        qty: Number(receiveQty),
        cost_per_unit: receiveCost || null
      })
      setReceiveFor(null)
      setReceiveQty('')
      setReceiveCost('')
      flash('Stock received')
      fetchItems()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to receive stock')
    } finally {
      setProcessing(false)
    }
  }

  const handleAdjust = async () => {
    if (!adjustFor || adjustQty === '') return
    try {
      setProcessing(true)
      setError(null)
      await api.post(`/api/admin/inventory/${adjustFor.id}/adjust`, {
        new_qty: Number(adjustQty),
        note: adjustNote || null
      })
      setAdjustFor(null)
      setAdjustQty('')
      setAdjustNote('')
      flash('Quantity adjusted')
      fetchItems()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to adjust')
    } finally {
      setProcessing(false)
    }
  }

  const handleDelete = async (item: BlankInventoryItem) => {
    if (!window.confirm(`Delete ${item.brand} ${item.style_code} ${item.color}/${item.size}? Movement history goes with it.`)) return
    try {
      setProcessing(true)
      await api.delete(`/api/admin/inventory/${item.id}`)
      flash('Blank deleted')
      fetchItems()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete')
    } finally {
      setProcessing(false)
    }
  }

  const openHistory = async (item: BlankInventoryItem) => {
    setHistoryFor(item)
    setMovements([])
    try {
      const response = await api.get(`/api/admin/inventory/${item.id}/movements`)
      setMovements(response.data.movements || [])
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load history')
    }
  }

  const lowCount = items.filter(i => i.low_stock).length
  const totalUnits = items.reduce((s, i) => s + i.qty_on_hand, 0)
  const stockValue = items.reduce((s, i) => s + i.qty_on_hand * (Number(i.cost_per_unit) || 0), 0)
  const visible = lowOnly ? items.filter(i => i.low_stock) : items

  return (
    <div className="space-y-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-5 flex items-center gap-4">
          <div className="p-3 bg-purple-100 rounded-xl"><Package className="w-6 h-6 text-purple-600" /></div>
          <div>
            <div className="text-sm text-slate-500">Blanks on hand</div>
            <div className="text-2xl font-bold text-slate-900">{totalUnits}</div>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-5 flex items-center gap-4">
          <div className={`p-3 rounded-xl ${lowCount > 0 ? 'bg-red-100' : 'bg-emerald-100'}`}>
            <AlertTriangle className={`w-6 h-6 ${lowCount > 0 ? 'text-red-600' : 'text-emerald-600'}`} />
          </div>
          <div>
            <div className="text-sm text-slate-500">Low-stock SKUs</div>
            <div className={`text-2xl font-bold ${lowCount > 0 ? 'text-red-600' : 'text-slate-900'}`}>{lowCount}</div>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-5 flex items-center gap-4">
          <div className="p-3 bg-blue-100 rounded-xl"><Package className="w-6 h-6 text-blue-600" /></div>
          <div>
            <div className="text-sm text-slate-500">Stock value (cost)</div>
            <div className="text-2xl font-bold text-slate-900">${stockValue.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-3">{success}</div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-display font-bold text-slate-900">Blank Shirt Inventory</h3>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} className="rounded" />
              Low stock only
            </label>
            <button
              onClick={() => { setShowAddModal(true); setError(null) }}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium text-sm hover:bg-purple-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Blanks
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-slate-500">Loading inventory…</div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-slate-500">
            {items.length === 0
              ? 'No blanks tracked yet. Add your first stock with "Add Blanks" — shirt sales will start decrementing automatically.'
              : 'Nothing low on stock. 🎉'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-slate-600">
                  <th className="px-4 py-3 font-medium">Style</th>
                  <th className="px-4 py-3 font-medium">Color</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 font-medium text-center">On hand</th>
                  <th className="px-4 py-3 font-medium text-center">Threshold</th>
                  <th className="px-4 py-3 font-medium text-right">Cost/unit</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(item => (
                  <tr key={item.id} className={`border-t border-slate-100 ${item.low_stock ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-3 font-medium text-slate-900">{item.brand} {item.style_code}</td>
                    <td className="px-4 py-3 text-slate-700">{item.color}</td>
                    <td className="px-4 py-3 text-slate-700">{item.size}</td>
                    <td className={`px-4 py-3 text-center font-bold ${item.low_stock ? 'text-red-600' : 'text-slate-900'}`}>
                      {item.qty_on_hand}
                      {item.low_stock && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">LOW</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-500">{item.reorder_threshold}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{item.cost_per_unit != null ? `$${Number(item.cost_per_unit).toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{item.supplier || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setReceiveFor(item); setReceiveQty(''); setReceiveCost('') }}
                          className="px-2 py-1 text-xs bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 font-medium"
                          title="Receive stock"
                        >
                          + Receive
                        </button>
                        <button
                          onClick={() => { setAdjustFor(item); setAdjustQty(String(item.qty_on_hand)); setAdjustNote('') }}
                          className="px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 font-medium"
                          title="Adjust count"
                        >
                          Adjust
                        </button>
                        <button onClick={() => openHistory(item)} className="p-1.5 text-slate-400 hover:text-slate-700" title="Movement history">
                          <History className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setEditing(item)
                            setEditForm({
                              brand: item.brand,
                              style_code: item.style_code,
                              color: item.color,
                              size: item.size,
                              reorder_threshold: String(item.reorder_threshold),
                              reorder_qty: item.reorder_qty != null ? String(item.reorder_qty) : '',
                              cost_per_unit: item.cost_per_unit != null ? String(item.cost_per_unit) : '',
                              supplier: item.supplier || '',
                              notes: item.notes || ''
                            })
                          }}
                          className="p-1.5 text-slate-400 hover:text-slate-700"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(item)} className="p-1.5 text-slate-400 hover:text-red-600" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add blanks modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">Add Blanks</h3>
              <button onClick={() => setShowAddModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-sm text-slate-600 mb-1">Brand *</label>
                <input value={bulkForm.brand} onChange={e => setBulkForm({ ...bulkForm, brand: e.target.value })}
                  placeholder="Gildan" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Style *</label>
                <input value={bulkForm.style_code} onChange={e => setBulkForm({ ...bulkForm, style_code: e.target.value })}
                  placeholder="5000" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Color *</label>
                <input value={bulkForm.color} onChange={e => setBulkForm({ ...bulkForm, color: e.target.value })}
                  placeholder="Black" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Cost per unit ($)</label>
                <input value={bulkForm.cost_per_unit} onChange={e => setBulkForm({ ...bulkForm, cost_per_unit: e.target.value })}
                  placeholder="3.25" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Low-stock threshold</label>
                <input value={bulkForm.reorder_threshold} onChange={e => setBulkForm({ ...bulkForm, reorder_threshold: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">Reorder qty</label>
                <input value={bulkForm.reorder_qty} onChange={e => setBulkForm({ ...bulkForm, reorder_qty: e.target.value })}
                  placeholder="72" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-slate-600 mb-1">Supplier</label>
                <input value={bulkForm.supplier} onChange={e => setBulkForm({ ...bulkForm, supplier: e.target.value })}
                  placeholder="S&S Activewear" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <label className="block text-sm text-slate-600 mb-2">Quantities per size (leave blank to skip a size)</label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {sizeRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input value={row.size}
                    onChange={e => setSizeRows(rows => rows.map((r, i) => i === idx ? { ...r, size: e.target.value } : r))}
                    className="w-14 border border-slate-200 rounded-lg px-2 py-2 text-sm text-center" />
                  <input value={row.qty} placeholder="0"
                    onChange={e => setSizeRows(rows => rows.map((r, i) => i === idx ? { ...r, qty: e.target.value } : r))}
                    className="flex-1 border border-slate-200 rounded-lg px-2 py-2 text-sm" />
                </div>
              ))}
            </div>
            <button onClick={() => setSizeRows(rows => [...rows, { size: '', qty: '' }])}
              className="text-sm text-purple-600 hover:text-purple-800 mb-4">+ another size</button>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleBulkAdd} disabled={processing}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                {processing ? 'Saving…' : 'Add Blanks'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive modal */}
      {receiveFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Receive stock</h3>
            <p className="text-sm text-slate-500 mb-4">{receiveFor.brand} {receiveFor.style_code} — {receiveFor.color} / {receiveFor.size}</p>
            <label className="block text-sm text-slate-600 mb-1">Quantity received *</label>
            <input autoFocus value={receiveQty} onChange={e => setReceiveQty(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3" />
            <label className="block text-sm text-slate-600 mb-1">New cost per unit ($, optional)</label>
            <input value={receiveCost} onChange={e => setReceiveCost(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-4" />
            <div className="flex justify-end gap-3">
              <button onClick={() => setReceiveFor(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleReceive} disabled={processing || !receiveQty}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {processing ? 'Saving…' : 'Receive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust modal */}
      {adjustFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-1">Adjust count</h3>
            <p className="text-sm text-slate-500 mb-4">{adjustFor.brand} {adjustFor.style_code} — {adjustFor.color} / {adjustFor.size} (currently {adjustFor.qty_on_hand})</p>
            <label className="block text-sm text-slate-600 mb-1">Counted quantity *</label>
            <input autoFocus value={adjustQty} onChange={e => setAdjustQty(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3" />
            <label className="block text-sm text-slate-600 mb-1">Note</label>
            <input value={adjustNote} onChange={e => setAdjustNote(e.target.value)} placeholder="cycle count / damaged / misprint"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-4" />
            <div className="flex justify-end gap-3">
              <button onClick={() => setAdjustFor(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleAdjust} disabled={processing || adjustQty === ''}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                {processing ? 'Saving…' : 'Save count'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">Edit blank</h3>
              <button onClick={() => setEditing(null)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {([
                ['brand', 'Brand'], ['style_code', 'Style'], ['color', 'Color'], ['size', 'Size'],
                ['reorder_threshold', 'Low-stock threshold'], ['reorder_qty', 'Reorder qty'],
                ['cost_per_unit', 'Cost per unit ($)'], ['supplier', 'Supplier']
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-sm text-slate-600 mb-1">{label}</label>
                  <input value={editForm[key] ?? ''} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>
              ))}
              <div className="col-span-2">
                <label className="block text-sm text-slate-600 mb-1">Notes</label>
                <input value={editForm.notes ?? ''} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleEditSave} disabled={processing}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                {processing ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Movement history drawer */}
      {historyFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                History — {historyFor.brand} {historyFor.style_code} {historyFor.color}/{historyFor.size}
              </h3>
              <button onClick={() => setHistoryFor(null)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            {movements.length === 0 ? (
              <p className="text-slate-500 text-sm">No movements yet.</p>
            ) : (
              <div className="space-y-2">
                {movements.map(m => (
                  <div key={m.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 text-sm">
                    <div>
                      <span className={`font-bold ${m.delta < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                      </span>
                      <span className="ml-2 text-slate-600 capitalize">{m.reason}</span>
                      {m.order_id && <span className="ml-2 text-xs text-slate-400">order {m.order_id.slice(0, 8)}…</span>}
                      {m.note && <div className="text-xs text-slate-400">{m.note}</div>}
                    </div>
                    <span className="text-xs text-slate-400">{new Date(m.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
