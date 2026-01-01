import React, { useState } from 'react'
import { X, Plus, Trash2, Send, DollarSign, FileText } from 'lucide-react'
import api from '../lib/api'

interface LineItem {
  description: string
  amount: number
  quantity: number
}

interface CreateInvoiceModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  orderId?: string
  isAdmin?: boolean
}

const CreateInvoiceModal: React.FC<CreateInvoiceModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  orderId,
  isAdmin = false
}) => {
  const [clientEmail, setClientEmail] = useState('')
  const [clientName, setClientName] = useState('')
  const [memo, setMemo] = useState('')
  const [dueDays, setDueDays] = useState(14)
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: '', amount: 0, quantity: 1 }
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sendImmediately, setSendImmediately] = useState(true)

  const addLineItem = () => {
    setLineItems([...lineItems, { description: '', amount: 0, quantity: 1 }])
  }

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index))
    }
  }

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lineItems]
    if (field === 'description') {
      updated[index].description = value as string
    } else if (field === 'amount') {
      updated[index].amount = parseFloat(value as string) || 0
    } else if (field === 'quantity') {
      updated[index].quantity = parseInt(value as string) || 1
    }
    setLineItems(updated)
  }

  const calculateSubtotal = () => {
    return lineItems.reduce((sum, item) => sum + (item.amount * item.quantity), 0)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validation
    if (!clientEmail) {
      setError('Client email is required')
      return
    }
    if (lineItems.some(item => !item.description || item.amount <= 0)) {
      setError('All line items must have a description and amount')
      return
    }

    setLoading(true)

    try {
      // Create invoice (admin-only, no founder split)
      const { data } = await api.post('/api/invoices', {
        client_email: clientEmail,
        client_name: clientName || undefined,
        line_items: lineItems.map(item => ({
          description: item.description,
          amount_cents: Math.round(item.amount * 100),
          quantity: item.quantity
        })),
        memo: memo || undefined,
        due_days: dueDays,
        order_id: orderId || undefined,
        invoice_type: 'admin' // Mark as admin invoice (no founder split)
      })

      if (!data.ok) {
        throw new Error(data.error || 'Failed to create invoice')
      }

      // Send immediately if checked
      if (sendImmediately) {
        await api.post(`/api/invoices/${data.invoice.id}/send`)
      }

      onSuccess()
      onClose()
      resetForm()
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to create invoice')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setClientEmail('')
    setClientName('')
    setMemo('')
    setDueDays(14)
    setLineItems([{ description: '', amount: 0, quantity: 1 }])
    setError('')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        {/* Modal */}
        <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100">
                <FileText className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-800">Create Invoice</h2>
                <p className="text-sm text-slate-500">Send a branded invoice to your client</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                {error}
              </div>
            )}

            {/* Client Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Client Email *
                </label>
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Client Name
                </label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Line Items */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Line Items
              </label>
              <div className="space-y-3">
                {lineItems.map((item, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                      placeholder="Description (e.g., Custom T-Shirt Design)"
                      className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <div className="relative w-28">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.amount || ''}
                        onChange={(e) => updateLineItem(index, 'amount', e.target.value)}
                        placeholder="0.00"
                        className="w-full pl-8 pr-3 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, 'quantity', e.target.value)}
                      className="w-16 px-3 py-2.5 rounded-lg border border-slate-300 text-slate-800 text-center focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={() => removeLineItem(index)}
                      className="p-2 rounded-lg hover:bg-red-50 text-red-500 transition-colors disabled:opacity-50"
                      disabled={lineItems.length === 1}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addLineItem}
                className="mt-3 flex items-center gap-2 text-sm text-purple-600 hover:text-purple-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Line Item
              </button>
            </div>

            {/* Memo */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Memo / Notes
              </label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Add a note to the invoice (e.g., Thank you for your business!)"
                rows={2}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
              />
            </div>

            {/* Due Days */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Payment Due
                </label>
                <select
                  value={dueDays}
                  onChange={(e) => setDueDays(parseInt(e.target.value))}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="flex items-center gap-2 cursor-pointer mt-6">
                  <input
                    type="checkbox"
                    checked={sendImmediately}
                    onChange={(e) => setSendImmediately(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm text-slate-600">Send immediately</span>
                </label>
              </div>
            </div>

            {/* Summary */}
            <div className="p-4 rounded-lg bg-purple-50 border border-purple-100">
              <div className="flex justify-between items-center">
                <span className="text-slate-600 font-medium">Invoice Total</span>
                <span className="text-2xl font-bold text-purple-600">${calculateSubtotal().toFixed(2)}</span>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Invoice will include your logo and branding. Client will receive email with payment link.
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    {sendImmediately ? 'Create & Send' : 'Create Draft'}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default CreateInvoiceModal
