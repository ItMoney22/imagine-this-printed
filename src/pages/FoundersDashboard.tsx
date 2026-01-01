import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { FileText, DollarSign, Clock, CheckCircle, Send, Eye, XCircle, Plus, RefreshCw, ExternalLink } from 'lucide-react'
import api from '../lib/api'
import CreateInvoiceModal from '../components/CreateInvoiceModal'

interface FounderInvoice {
  id: string
  client_email: string
  client_name: string | null
  subtotal_cents: number
  founder_earnings_cents: number
  platform_fee_cents: number
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
  total_earnings: number
  pending_earnings: number
}

const FoundersDashboard: React.FC = () => {
  const { user } = useAuth()
  const [invoices, setInvoices] = useState<FounderInvoice[]>([])
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
        api.get('/api/invoices'),
        api.get('/api/invoices/stats/summary')
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
    if (user?.role === 'founder' || user?.role === 'admin') {
      fetchData()
    }
  }, [user])

  const handleSendInvoice = async (invoiceId: string) => {
    setSendingId(invoiceId)
    try {
      const { data } = await api.post(`/api/invoices/${invoiceId}/send`)
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
      const { data } = await api.post(`/api/invoices/${invoiceId}/void`)
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
      draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      sent: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      paid: 'bg-green-500/20 text-green-400 border-green-500/30',
      overdue: 'bg-red-500/20 text-red-400 border-red-500/30',
      void: 'bg-gray-500/20 text-gray-500 border-gray-500/30'
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${styles[status] || styles.draft}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  if (user?.role !== 'founder' && user?.role !== 'admin') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-red-400">Access denied. This page is for founders only.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-text mb-2">Founders Dashboard</h1>
          <p className="text-muted">Create and manage invoices for your clients</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-lg border border-white/10 hover:bg-white/5 text-muted hover:text-text transition-colors"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium hover:from-purple-600 hover:to-pink-600 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Invoice
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-card rounded-xl border border-white/10 p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-blue-500/20">
              <FileText className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-muted">Total Invoices</p>
              <p className="text-2xl font-bold text-text">{stats?.total_invoices || 0}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-white/10 p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-green-500/20">
              <DollarSign className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-muted">Total Earnings</p>
              <p className="text-2xl font-bold text-green-400">${stats?.total_earnings?.toFixed(2) || '0.00'}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-white/10 p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-yellow-500/20">
              <Clock className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-muted">Pending Earnings</p>
              <p className="text-2xl font-bold text-yellow-400">${stats?.pending_earnings?.toFixed(2) || '0.00'}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-white/10 p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-purple-500/20">
              <CheckCircle className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-muted">Paid Invoices</p>
              <p className="text-2xl font-bold text-text">{stats?.paid || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6 border-b border-white/10 pb-4">
        {(['all', 'draft', 'sent', 'paid', 'overdue'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSelectedTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedTab === tab
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                : 'text-muted hover:text-text hover:bg-white/5'
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
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-xl border border-white/10">
          <FileText className="w-12 h-12 text-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text mb-2">No invoices yet</h3>
          <p className="text-muted mb-4">Create your first invoice to start billing clients</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Invoice
          </button>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-6 py-4 text-left text-xs font-medium text-muted uppercase tracking-wider">Client</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-muted uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-muted uppercase tracking-wider">Your Earnings</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-muted uppercase tracking-wider">Due Date</th>
                  <th className="px-6 py-4 text-left text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-text">{invoice.client_name || 'No name'}</p>
                        <p className="text-sm text-muted">{invoice.client_email}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-text">
                        ${(invoice.subtotal_cents / 100).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-green-400">
                        ${(invoice.founder_earnings_cents / 100).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(invoice.status)}
                    </td>
                    <td className="px-6 py-4 text-muted">
                      {new Date(invoice.due_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {invoice.status === 'draft' && (
                          <button
                            onClick={() => handleSendInvoice(invoice.id)}
                            disabled={sendingId === invoice.id}
                            className="p-2 rounded-lg hover:bg-blue-500/20 text-blue-400 transition-colors disabled:opacity-50"
                            title="Send Invoice"
                          >
                            {sendingId === invoice.id ? (
                              <div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
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
                            className="p-2 rounded-lg hover:bg-purple-500/20 text-purple-400 transition-colors"
                            title="View Invoice"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        {(invoice.status === 'draft' || invoice.status === 'sent') && (
                          <button
                            onClick={() => handleVoidInvoice(invoice.id)}
                            disabled={voidingId === invoice.id}
                            className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-50"
                            title="Void Invoice"
                          >
                            {voidingId === invoice.id ? (
                              <div className="w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
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
        isAdmin={user?.role === 'admin'}
      />
    </div>
  )
}

export default FoundersDashboard
