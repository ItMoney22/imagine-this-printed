import React, { useState, useEffect } from 'react'
import { FileText, DollarSign, CheckCircle, Send, XCircle, Plus, RefreshCw, ExternalLink, Clock } from 'lucide-react'
import api from '../lib/api'
import CreateInvoiceModal from './CreateInvoiceModal'

interface AdminInvoice {
  id: string
  client_email: string
  client_name: string | null
  subtotal_cents: number
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void'
  stripe_hosted_invoice_url: string | null
  due_date: string
  created_at: string
  sent_at: string | null
  paid_at: string | null
  line_items: Array<{ description: string; amount_cents: number; quantity: number }>
  memo: string | null
}

interface InvoiceStats {
  total_invoices: number
  draft: number
  sent: number
  paid: number
  overdue: number
  void: number
  total_billed: number
  total_collected: number
}

const AdminInvoiceManagement: React.FC = () => {
  const [invoices, setInvoices] = useState<AdminInvoice[]>([])
  const [stats, setStats] = useState<InvoiceStats | null>(null)
  const [selectedTab, setSelectedTab] = useState<'all' | 'draft' | 'sent' | 'paid' | 'overdue'>('all')
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [voidingId, setVoidingId] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [invoicesRes, statsRes] = await Promise.all([
        api.get('/invoices'),
        api.get('/invoices/stats/summary')
      ])

      if (invoicesRes.data.ok) {
        setInvoices(invoicesRes.data.invoices)
      }
      if (statsRes.data.ok) {
        setStats(statsRes.data.stats)
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleSendInvoice = async (invoiceId: string) => {
    setSendingId(invoiceId)
    try {
      const { data } = await api.post(`/invoices/${invoiceId}/send`)
      if (data.ok) {
        fetchData()
      }
    } catch (error) {
      console.error('Failed to send invoice:', error)
    } finally {
      setSendingId(null)
    }
  }

  const handleVoidInvoice = async (invoiceId: string) => {
    if (!confirm('Are you sure you want to void this invoice? This cannot be undone.')) return

    setVoidingId(invoiceId)
    try {
      const { data } = await api.post(`/invoices/${invoiceId}/void`)
      if (data.ok) {
        fetchData()
      }
    } catch (error) {
      console.error('Failed to void invoice:', error)
    } finally {
      setVoidingId(null)
    }
  }

  const filteredInvoices = selectedTab === 'all'
    ? invoices
    : invoices.filter(inv => inv.status === selectedTab)

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: 'bg-slate-100 text-slate-600',
      sent: 'bg-blue-100 text-blue-700',
      paid: 'bg-green-100 text-green-700',
      overdue: 'bg-red-100 text-red-700',
      void: 'bg-slate-100 text-slate-400'
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.draft}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Invoice Management</h2>
          <p className="text-slate-500">Create and manage branded invoices for clients</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Invoice
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Total Invoices</p>
              <p className="text-xl font-bold text-slate-800">{stats?.total_invoices || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100">
              <DollarSign className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Total Billed</p>
              <p className="text-xl font-bold text-slate-800">${stats?.total_billed?.toFixed(2) || '0.00'}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Collected</p>
              <p className="text-xl font-bold text-green-600">${stats?.total_collected?.toFixed(2) || '0.00'}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Pending</p>
              <p className="text-xl font-bold text-amber-600">{stats?.sent || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        {(['all', 'draft', 'sent', 'paid', 'overdue'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSelectedTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedTab === tab
                ? 'bg-purple-100 text-purple-700'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab !== 'all' && stats && (
              <span className="ml-2 text-xs opacity-60">
                ({stats[tab as keyof InvoiceStats] || 0})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Invoices Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12 bg-white rounded-xl border border-slate-200">
          <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-800 mb-2">No invoices yet</h3>
          <p className="text-slate-500 mb-4">Create your first branded invoice for a client</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Invoice
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Client</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Due Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-slate-800">{invoice.client_name || 'No name'}</p>
                        <p className="text-sm text-slate-500">{invoice.client_email}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-slate-800">
                        ${(invoice.subtotal_cents / 100).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(invoice.status)}
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {new Date(invoice.due_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-sm">
                      {new Date(invoice.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {invoice.status === 'draft' && (
                          <button
                            onClick={() => handleSendInvoice(invoice.id)}
                            disabled={sendingId === invoice.id}
                            className="p-2 rounded-lg hover:bg-blue-100 text-blue-600 transition-colors disabled:opacity-50"
                            title="Send Invoice"
                          >
                            {sendingId === invoice.id ? (
                              <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        {invoice.stripe_hosted_invoice_url && (
                          <a
                            href={invoice.stripe_hosted_invoice_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-lg hover:bg-purple-100 text-purple-600 transition-colors"
                            title="View Invoice"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        {(invoice.status === 'draft' || invoice.status === 'sent') && (
                          <button
                            onClick={() => handleVoidInvoice(invoice.id)}
                            disabled={voidingId === invoice.id}
                            className="p-2 rounded-lg hover:bg-red-100 text-red-600 transition-colors disabled:opacity-50"
                            title="Void Invoice"
                          >
                            {voidingId === invoice.id ? (
                              <div className="w-4 h-4 border-2 border-red-200 border-t-red-600 rounded-full animate-spin" />
                            ) : (
                              <XCircle className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Invoice Modal */}
      <CreateInvoiceModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={fetchData}
        isAdmin={true}
      />
    </div>
  )
}

export default AdminInvoiceManagement
