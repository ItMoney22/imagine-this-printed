import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import { useToast } from '../hooks/useToast'
import { Pagination } from '../components/Pagination'
import { crmApi } from '../lib/api'
import type { CrmCustomer, CrmOrder, CrmSegments, CrmTotals } from '../lib/api'
import type { ContactNote, CustomJobRequest } from '../types'

// Rows per page. 50 keeps a full screen of table without the 2,600-row payload
// this page used to pull down on mount.
const PAGE_SIZE = 50

// Hard ceiling on a CSV export. Export still walks the server pages, but it
// walks a KNOWN number of them — an unbounded export is the same unbounded
// fetch this page was built to delete, just triggered by a button.
const EXPORT_MAX_ROWS = 5000

/**
 * The table needs a couple of fields the aggregate does not carry: `tags`
 * (today, the customer's role) and `notes` (loaded per customer). Kept as a
 * view model so the server payload stays exactly what the SQL returned.
 */
type CustomerRow = CrmCustomer & { tags: string[]; notes: ContactNote[] }

const toRow = (c: CrmCustomer): CustomerRow => ({
  ...c,
  tags: c.role ? [c.role] : [],
  notes: []
})

const CRM: React.FC = () => {
  const { user } = useAuth()
  const toast = useToast()
  const [selectedTab, setSelectedTab] = useState<'customers' | 'jobs' | 'analytics' | 'orders'>('customers')

  // --- Customers (server-aggregated, server-paged) -------------------------
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [customerTotal, setCustomerTotal] = useState(0)
  const [customerPage, setCustomerPage] = useState(1)
  const [customerSort, setCustomerSort] = useState<'recent' | 'spend' | 'orders' | 'last_order' | 'name'>('recent')
  const [customersBusy, setCustomersBusy] = useState(false)

  // --- Orders (server-paged) -----------------------------------------------
  const [orders, setOrders] = useState<CrmOrder[]>([])
  const [orderTotal, setOrderTotal] = useState(0)
  const [orderPage, setOrderPage] = useState(1)
  const [ordersBusy, setOrdersBusy] = useState(false)

  // --- Whole-table numbers -------------------------------------------------
  const [totals, setTotals] = useState<CrmTotals | null>(null)
  const [segments, setSegments] = useState<CrmSegments | null>(null)

  const [jobs, setJobs] = useState<CustomJobRequest[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null)
  const [customerOrders, setCustomerOrders] = useState<CrmOrder[]>([])
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [chatMessages, setChatMessages] = useState<{[customerId: string]: Array<{id: string, message: string, sender: string, timestamp: string}>}>({})
  const [newChatMessage, setNewChatMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Search hits the server now, so every keystroke would be a query. 350ms is
  // the same debounce ProductCatalog uses.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 350)
    return () => clearTimeout(id)
  }, [searchTerm])

  // Any filter change invalidates the page number — page 4 of the old result
  // set is not page 4 of the new one.
  useEffect(() => { setCustomerPage(1) }, [debouncedSearch, filterTag, customerSort])
  useEffect(() => { setOrderPage(1) }, [debouncedSearch, orderStatusFilter, dateRange.start, dateRange.end])

  // Header cards + analytics: whole-table aggregates, fetched once. These are
  // the numbers that used to be summed from whatever rows happened to be in
  // memory, which meant they changed when you filtered the table.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [t, s] = await Promise.all([crmApi.totals(), crmApi.segments()])
        if (cancelled) return
        setTotals(t)
        setSegments(s)
      } catch (err: any) {
        if (!cancelled) console.error('[CRM] totals/segments failed:', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const loadCustomers = useCallback(async () => {
    setCustomersBusy(true)
    try {
      const result = await crmApi.customers({
        page: customerPage,
        limit: PAGE_SIZE,
        search: debouncedSearch || undefined,
        role: filterTag || undefined,
        sort: customerSort
      })
      setCustomers(result.customers.map(toRow))
      setCustomerTotal(result.total)
      setError(null)
    } catch (err: any) {
      console.error('[CRM] Error fetching customers:', err)
      setError(err.message || 'Failed to load CRM data')
    } finally {
      setCustomersBusy(false)
      setLoading(false)
    }
  }, [customerPage, debouncedSearch, filterTag, customerSort])

  useEffect(() => { void loadCustomers() }, [loadCustomers])

  const loadOrders = useCallback(async () => {
    setOrdersBusy(true)
    try {
      const result = await crmApi.orders({
        page: orderPage,
        limit: PAGE_SIZE,
        status: orderStatusFilter !== 'all' ? orderStatusFilter : undefined,
        search: debouncedSearch || undefined,
        // Only send a range when BOTH ends are set — the old client-side filter
        // had the same rule, and a half-open range silently hid rows.
        start: dateRange.start && dateRange.end ? dateRange.start : undefined,
        end: dateRange.start && dateRange.end ? dateRange.end : undefined
      })
      setOrders(result.orders)
      setOrderTotal(result.total)
    } catch (err: any) {
      console.error('[CRM] Error fetching orders:', err)
      toast.error('Failed to load orders', err.message)
    } finally {
      setOrdersBusy(false)
    }
    // toast is stable per render from useToast(); excluded so a re-render does
    // not re-trigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderPage, orderStatusFilter, debouncedSearch, dateRange.start, dateRange.end])

  useEffect(() => { void loadOrders() }, [loadOrders])

  // Custom jobs. The table does not exist on this database yet; a missing
  // table must leave the tab empty, not break the page.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: jobsError } = await supabase
        .from('custom_job_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .range(0, PAGE_SIZE - 1)

      if (cancelled) return
      if (jobsError) {
        console.log('[CRM] custom_job_requests unavailable:', jobsError.message)
        setJobs([])
        return
      }
      setJobs((data || []).map((job: any) => ({
        id: job.id,
        customerId: job.user_id,
        title: job.title,
        description: job.description,
        requirements: job.requirements,
        budget: job.budget,
        deadline: job.deadline,
        files: job.files || [],
        status: job.status || 'submitted',
        assignedTo: job.assigned_to,
        approvedBy: job.approved_by,
        estimatedCost: job.estimated_cost,
        finalCost: job.final_cost,
        notes: job.notes || [],
        createdAt: job.created_at,
        updatedAt: job.updated_at
      })))
    })()
    return () => { cancelled = true }
  }, [])

  // The detail modal shows one customer's purchase history. That used to be a
  // filter over every order in memory; now it is that customer's page of orders.
  const openCustomer = useCallback(async (customer: CustomerRow) => {
    setSelectedCustomer(customer)
    setCustomerOrders([])
    setShowCustomerModal(true)
    try {
      const result = await crmApi.orders({ userId: customer.id, limit: PAGE_SIZE, paidOnly: true })
      setCustomerOrders(result.orders)
    } catch (err: any) {
      console.error('[CRM] Error fetching customer orders:', err)
    }
  }, [])

  // All five mutations below follow the same shape: update local state first
  // (optimistic), then write to Supabase. If the write fails, revert the
  // local state back to what it was and surface a toast — the UI must never
  // keep showing a change that didn't actually persist.

  const addNote = async (customerId: string) => {
    const content = newNote.trim()
    if (!content || !user) return

    const tempId = `temp-${Date.now()}`
    const optimisticNote: ContactNote = {
      id: tempId,
      content,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
      type: 'general'
    }

    setCustomers(prev => prev.map(customer =>
      customer.id === customerId
        ? { ...customer, notes: [optimisticNote, ...customer.notes] }
        : customer
    ))
    setNewNote('')

    const { data, error } = await supabase
      .from('crm_notes')
      .insert({
        customer_id: customerId,
        content,
        note_type: 'general',
        created_by: user.id
      })
      .select()
      .single()

    if (error) {
      console.error('[CRM] Error saving note:', error)
      setCustomers(prev => prev.map(customer =>
        customer.id === customerId
          ? { ...customer, notes: customer.notes.filter(note => note.id !== tempId) }
          : customer
      ))
      toast.error('Failed to save note', error.message)
      return
    }

    // Reconcile the optimistic temp id with the real DB-assigned id.
    setCustomers(prev => prev.map(customer =>
      customer.id === customerId
        ? { ...customer, notes: customer.notes.map(note => note.id === tempId ? { ...note, id: data.id } : note) }
        : customer
    ))
  }

  const removeTag = async (customerId: string, tagToRemove: string) => {
    setCustomers(prev => prev.map(customer =>
      customer.id === customerId
        ? { ...customer, tags: customer.tags.filter(tag => tag !== tagToRemove) }
        : customer
    ))

    const { error } = await supabase
      .from('crm_tags')
      .delete()
      .eq('customer_id', customerId)
      .eq('tag', tagToRemove)

    if (error) {
      console.error('[CRM] Error removing tag:', error)
      setCustomers(prev => prev.map(customer =>
        customer.id === customerId && !customer.tags.includes(tagToRemove)
          ? { ...customer, tags: [...customer.tags, tagToRemove] }
          : customer
      ))
      toast.error('Failed to remove tag', error.message)
    }
  }

  const addTag = async (customerId: string) => {
    // TODO(audit #9): replace this `prompt()` with a tag-picker modal once
    // we have a shared "edit-list-of-strings" pattern. Until then at least
    // the button isn't inert and we de-dupe + trim.
    const raw = prompt('Add tag (use - or _ instead of spaces):')
    if (raw === null) return // user cancelled
    const tag = raw.trim()
    if (!tag || !user) return

    const customer = customers.find(c => c.id === customerId)
    if (customer?.tags.includes(tag)) return // de-dupe

    setCustomers(prev => prev.map(c => {
      if (c.id !== customerId) return c
      if (c.tags.includes(tag)) return c
      return { ...c, tags: [...c.tags, tag] }
    }))

    const { error } = await supabase
      .from('crm_tags')
      .insert({ customer_id: customerId, tag, created_by: user.id })

    if (error) {
      console.error('[CRM] Error adding tag:', error)
      setCustomers(prev => prev.map(c =>
        c.id === customerId ? { ...c, tags: c.tags.filter(t => t !== tag) } : c
      ))
      toast.error('Failed to add tag', error.message)
    }
  }

  const updateJobStatus = async (jobId: string, status: CustomJobRequest['status'], assignedTo?: string) => {
    const previous = jobs.find(job => job.id === jobId)
    if (!previous) return

    setJobs(prev => prev.map(job =>
      job.id === jobId
        ? { ...job, status, assignedTo, updatedAt: new Date().toISOString() }
        : job
    ))

    const { error } = await supabase
      .from('custom_job_requests')
      .update({
        status,
        assigned_to: assignedTo,
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId)

    if (error) {
      console.error('[CRM] Error updating job status:', error)
      setJobs(prev => prev.map(job => job.id === jobId ? previous : job))
      toast.error('Failed to update job status', error.message)
    }
  }

  const updateOrderStatus = async (orderId: string, status: string, notes?: string) => {
    const previous = orders.find(order => order.id === orderId)
    if (!previous) return

    const internalNotes = notes
      ? `${previous.internalNotes || ''}\n${new Date().toLocaleDateString()}: ${notes}`
      : previous.internalNotes

    setOrders(prev => prev.map(order =>
      order.id === orderId
        ? { ...order, status, internalNotes }
        : order
    ))

    const { error } = await supabase
      .from('orders')
      .update({
        status,
        internal_notes: internalNotes,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)

    if (error) {
      console.error('[CRM] Error updating order status:', error)
      setOrders(prev => prev.map(order => order.id === orderId ? previous : order))
      toast.error('Failed to update order status', error.message)
    }
  }

  const exportToCSV = (data: any[], filename: string) => {
    if (data.length === 0) {
      alert('No data to export')
      return
    }

    // Escape any value for CSV. Defends against:
    //  1. Formula injection in Excel/Sheets — prefix `=`, `+`, `-`, `@`, tab, CR
    //     with a single quote so spreadsheets don't evaluate user data as a formula.
    //  2. Embedded quotes / commas / newlines — wrap in double quotes and double
    //     up any internal quotes per RFC 4180.
    const escapeCsv = (value: unknown): string => {
      if (value === null || value === undefined) return ''
      let s = String(value)
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
      if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
      return s
    }

    const headers = Object.keys(data[0]).map(escapeCsv).join(',')
    const csvContent = [
      headers,
      ...data.map(row =>
        Object.values(row).map(escapeCsv).join(',')
      )
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    try {
      const link = document.createElement('a')
      link.setAttribute('href', url)
      link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  /**
   * Walks the server pages for an export.
   *
   * Export used to serialise whatever was already in memory — which, now that
   * the table is paged, would silently be one page. It also must not become a
   * back door to the full-table fetch this page just removed, so it stops at
   * EXPORT_MAX_ROWS and says so.
   */
  const collectAllPages = async <T,>(
    fetchPage: (page: number) => Promise<{ rows: T[]; total: number }>
  ): Promise<{ rows: T[]; truncated: boolean; total: number }> => {
    const rows: T[] = []
    let page = 1
    let total = 0
    for (;;) {
      const result = await fetchPage(page)
      total = result.total
      rows.push(...result.rows)
      if (result.rows.length < PAGE_SIZE) break
      if (rows.length >= Math.min(total, EXPORT_MAX_ROWS)) break
      page += 1
    }
    return { rows, truncated: rows.length < total, total }
  }

  const exportCustomers = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const { rows, truncated, total } = await collectAllPages<CrmCustomer>(async page => {
        const result = await crmApi.customers({
          page,
          limit: PAGE_SIZE,
          search: debouncedSearch || undefined,
          role: filterTag || undefined,
          sort: customerSort
        })
        return { rows: result.customers, total: result.total }
      })

      exportToCSV(
        rows.map(customer => ({
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          company: customer.company,
          role: customer.role,
          totalOrders: customer.totalOrders,
          totalSpent: customer.totalSpent,
          lastOrderDate: customer.lastOrderDate || 'Never',
          registrationDate: customer.registrationDate || ''
        })),
        'customers'
      )
      if (truncated) {
        toast.error(
          'Export truncated',
          `Exported the first ${rows.length} of ${total} customers. Narrow the search or role filter to export the rest.`
        )
      }
    } catch (err: any) {
      console.error('[CRM] customer export failed:', err)
      toast.error('Export failed', err.message)
    } finally {
      setExporting(false)
    }
  }

  const exportOrders = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const { rows, truncated, total } = await collectAllPages<CrmOrder>(async page => {
        const result = await crmApi.orders({
          page,
          limit: PAGE_SIZE,
          status: orderStatusFilter !== 'all' ? orderStatusFilter : undefined,
          search: debouncedSearch || undefined,
          start: dateRange.start && dateRange.end ? dateRange.start : undefined,
          end: dateRange.start && dateRange.end ? dateRange.end : undefined
        })
        return { rows: result.orders, total: result.total }
      })

      exportToCSV(
        rows.map(order => ({
          orderId: order.id,
          orderNumber: order.orderNumber || '',
          customerName: order.customerName || 'Unknown',
          customerEmail: order.customerEmail || 'Unknown',
          status: order.status,
          paymentStatus: order.paymentStatus || 'unknown',
          paid: order.everPaid ? 'yes' : 'no',
          total: order.total,
          createdAt: new Date(order.createdAt).toLocaleDateString(),
          trackingNumber: order.trackingNumber || 'N/A',
          items: order.items.map(item => `${item.name} (${item.quantity})`).join('; ')
        })),
        'orders'
      )
      if (truncated) {
        toast.error(
          'Export truncated',
          `Exported the first ${rows.length} of ${total} orders. Narrow the filters to export the rest.`
        )
      }
    } catch (err: any) {
      console.error('[CRM] order export failed:', err)
      toast.error('Export failed', err.message)
    } finally {
      setExporting(false)
    }
  }

  // Search, role filter, status filter and the date range are all applied by
  // the server now (backend/routes/admin/crm.ts), so `customers` and `orders`
  // ARE the filtered page. The old client-side memos over the full table are
  // gone with the full table — a filter that only searched the rows the browser
  // happened to hold was never showing the whole answer anyway.
  const filteredCustomers = customers
  const filteredOrders = orders

  // Role options come from the whole-table segment counts, not from the loaded
  // page — otherwise the "All Roles" dropdown could only offer roles that
  // happen to appear on page 1.
  const allTags = useMemo(
    () => (segments?.segments || []).map(s => s.role),
    [segments]
  )

  if (user?.role !== 'admin' && user?.role !== 'manager') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. This page is for admins and managers only.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
          <span className="ml-3 text-muted">Loading CRM data...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Error loading CRM: {error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-purple-600 hover:text-purple-800"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Gradient Header */}
      <div className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">CRM & Order Management</h1>
              <p className="text-purple-100">Manage customer relationships and track orders</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                <span className="text-purple-100 text-xs uppercase tracking-wider">Customers</span>
                <p className="text-white text-xl font-bold">{totals ? totals.customers.toLocaleString() : '—'}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                <span className="text-purple-100 text-xs uppercase tracking-wider">Revenue</span>
                <p className="text-white text-xl font-bold">{totals?.revenue != null ? `$${totals.revenue.toFixed(0)}` : '—'}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                <span className="text-purple-100 text-xs uppercase tracking-wider">Pending</span>
                <p className="text-white text-xl font-bold">{totals ? totals.pendingOrders.toLocaleString() : '—'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Total Customers</p>
                <p className="text-2xl font-bold text-text">{totals ? totals.customers.toLocaleString() : '—'}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-lg shadow-green-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Paid Orders</p>
                <p className="text-2xl font-bold text-text">{totals ? totals.paidOrders.toLocaleString() : '—'}</p>
                {/* Abandoned checkouts write a complete-looking `orders` row.
                    Counting them as orders is what put a Refund button next to
                    a payment that never happened, so they are named, not
                    folded in. */}
                {totals != null && totals.unpaidDrafts > 0 && (
                  <p className="text-xs text-muted mt-0.5">+{totals.unpaidDrafts.toLocaleString()} unpaid drafts</p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl shadow-lg shadow-amber-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Pending Orders</p>
                <p className="text-2xl font-bold text-text">{totals ? totals.pendingOrders.toLocaleString() : '—'}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl shadow-lg shadow-purple-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Total Revenue</p>
                {/* Summed from `orders`, not from the customer rows. Guest
                    checkouts belong to no profile, so a sum over customers
                    reported $0.00 of money that was really taken. */}
                <p className="text-2xl font-bold text-text">
                  {totals?.revenue != null ? `$${totals.revenue.toFixed(2)}` : '—'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-2 mb-6">
          <nav className="flex space-x-2">
            {[
              { id: 'customers', label: 'Customers', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197' },
              { id: 'orders', label: 'Orders', icon: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z' },
              { id: 'jobs', label: 'Custom Jobs', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
              { id: 'analytics', label: 'Analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedTab(tab.id as any)}
                className={`flex items-center px-4 py-2.5 rounded-lg font-medium text-sm transition-all ${
                  selectedTab === tab.id
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/25'
                    : 'text-muted hover:text-text hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                </svg>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Customers Tab */}
        {selectedTab === 'customers' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
              <div className="flex-1 relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search customers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-text"
                />
              </div>
              <select
                value={filterTag}
                onChange={(e) => setFilterTag(e.target.value)}
                className="px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text"
              >
                <option value="">All Roles</option>
                {allTags.map(tag => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
              {/* Sorting is a server concern now: "biggest spenders" has to be
                  ordered by the SQL aggregate over every order, not by the
                  totals that happen to be on this page. */}
              <select
                value={customerSort}
                onChange={(e) => setCustomerSort(e.target.value as typeof customerSort)}
                className="px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text"
                aria-label="Sort customers"
              >
                <option value="recent">Newest first</option>
                <option value="spend">Highest spend</option>
                <option value="orders">Most orders</option>
                <option value="last_order">Most recent order</option>
                <option value="name">Name A–Z</option>
              </select>
              <button
                onClick={exportCustomers}
                disabled={exporting}
                className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl flex items-center shadow-lg shadow-green-500/25 transition-all"
              >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>

            <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider">Customer</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider">Contact</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider">Role</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider">Orders</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider">Total Spent</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider">Last Order</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-100 dark:divide-purple-900/30">
                    {filteredCustomers.map((customer) => (
                      <tr key={customer.id} className="hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
                              {customer.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="ml-3">
                              <div className="text-sm font-medium text-text">{customer.name}</div>
                              <div className="text-xs text-muted">{customer.company || 'Individual'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-text">{customer.email}</div>
                          <div className="text-xs text-muted">{customer.phone || 'No phone'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-wrap gap-1">
                            {customer.tags.map((tag) => (
                              <span key={tag} className={`px-2.5 py-1 inline-flex text-xs font-semibold rounded-lg ${
                                tag === 'admin' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                                tag === 'vendor' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                                tag === 'founder' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                                'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                              }`}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-text">{customer.totalOrders}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-bold text-emerald-600">${customer.totalSpent.toFixed(2)}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                          {customer.lastOrderDate ? new Date(customer.lastOrderDate).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => { void openCustomer(customer) }}
                            className="px-3 py-1.5 bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 text-sm font-medium rounded-lg transition-colors"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredCustomers.length === 0 && !customersBusy && (
                      <tr>
                        <td colSpan={7} className="px-6 py-10 text-center text-sm text-muted">
                          No customers match this search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={customerPage}
                limit={PAGE_SIZE}
                total={customerTotal}
                onPageChange={setCustomerPage}
                busy={customersBusy}
                label="customers"
              />
          </div>
        </div>
      )}

      {/* Orders Tab */}
      {selectedTab === 'orders' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search orders by ID, customer name, or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <select
              value={orderStatusFilter}
              onChange={(e) => setOrderStatusFilter(e.target.value)}
              className="px-4 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="approved">Approved</option>
              <option value="printed">Printed</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="on_hold">On Hold</option>
              <option value="rejected">Rejected</option>
              {/* `cancelled` retained as a legacy filter — the Order type
                  union doesn't list it, but `OrderManagement.tsx` still
                  emits/filters on it, so admins might have cancelled orders
                  in the data they need to find. */}
              <option value="cancelled">Cancelled</option>
            </select>
            <div className="flex gap-2">
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="Start date"
              />
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="End date"
              />
            </div>
            <button
              onClick={exportOrders}
              disabled={exporting}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md flex items-center whitespace-nowrap"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </button>
          </div>

          <div className="bg-card rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Order Management</h3>
              <p className="text-sm text-muted mt-1">Track and manage customer orders with real-time status updates</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-card">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Order ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Items</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Total</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Tracking</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-card divide-y divide-gray-200">
                  {filteredOrders.map((order) => {
                    return (
                    <tr key={order.id} className="hover:bg-card">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-text">{order.id}</div>
                        <div className="text-sm text-muted">Order #{order.orderNumber || order.id.split('-')[1]}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {/* Off the order row itself, so a guest checkout — which
                            has no profile to look up — still shows who bought. */}
                        <div className="text-sm font-medium text-text">{order.customerName || 'Unknown'}</div>
                        <div className="text-sm text-muted">{order.customerEmail || 'Unknown'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-text">
                          {order.items.length === 0 && <span className="text-muted">—</span>}
                          {order.items.map((item, index) => (
                            <div key={index} className="mb-1">
                              {item.name} (x{item.quantity})
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                        ${order.total.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          order.status === 'printed' ? 'bg-blue-100 text-blue-800' :
                          order.status === 'shipped' ? 'bg-purple-100 text-purple-800' :
                          order.status === 'delivered' ? 'bg-green-100 text-green-800' :
                          order.status === 'on_hold' ? 'bg-orange-100 text-orange-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {order.status.replace('_', ' ')}
                        </span>
                        {/* An order row exists from the moment the payment
                            intent is created. Saying so stops an abandoned
                            checkout from being worked as a real order. */}
                        {!order.everPaid && (
                          <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                            unpaid draft
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {order.trackingNumber ? (
                          <a href={`#tracking-${order.trackingNumber}`} className="text-purple-600 hover:text-purple-900">
                            {order.trackingNumber}
                          </a>
                        ) : (
                          'No tracking'
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex space-x-2">
                          {order.status === 'pending' && (
                            <button
                              onClick={() => updateOrderStatus(order.id, 'printed', 'Order marked as printed')}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              Mark Printed
                            </button>
                          )}
                          {order.status === 'printed' && (
                            <button
                              onClick={() => updateOrderStatus(order.id, 'shipped', 'Order shipped to customer')}
                              className="text-purple-600 hover:text-purple-900"
                            >
                              Mark Shipped
                            </button>
                          )}
                          {order.status === 'shipped' && (
                            <button
                              onClick={() => updateOrderStatus(order.id, 'delivered', 'Order delivered successfully')}
                              className="text-green-600 hover:text-green-900"
                            >
                              Mark Delivered
                            </button>
                          )}
                          <button
                            onClick={() => updateOrderStatus(order.id, 'on_hold', 'Order placed on hold for review')}
                            className="text-orange-600 hover:text-orange-900"
                          >
                            Hold
                          </button>
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                  {filteredOrders.length === 0 && !ordersBusy && (
                    <tr>
                      <td colSpan={8} className="px-6 py-10 text-center text-sm text-muted">
                        No orders match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={orderPage}
              limit={PAGE_SIZE}
              total={orderTotal}
              onPageChange={setOrderPage}
              busy={ordersBusy}
              label="orders"
            />
          </div>
        </div>
      )}

      {/* Jobs Tab */}
      {selectedTab === 'jobs' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Custom Job Requests</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-card">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Job Title</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Budget</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Deadline</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Assigned To</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-card divide-y divide-gray-200">
                  {jobs.map((job) => {
                    const customer = customers.find(c => c.id === job.customerId)
                    return (
                      <tr key={job.id} className="hover:bg-card">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-text">{job.title}</div>
                          <div className="text-sm text-muted max-w-xs truncate">{job.description}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                          {customer?.name || 'Unknown'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                          ${job.budget || 'Not specified'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                          {job.deadline ? new Date(job.deadline).toLocaleDateString() : 'Flexible'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            job.status === 'submitted' ? 'bg-blue-100 text-blue-800' :
                            job.status === 'under_review' ? 'bg-yellow-100 text-yellow-800' :
                            job.status === 'approved' ? 'bg-green-100 text-green-800' :
                            job.status === 'in_progress' ? 'bg-purple-100 text-purple-800' :
                            job.status === 'completed' ? 'bg-green-100 text-green-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {job.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                          {job.assignedTo || 'Unassigned'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          {job.status === 'under_review' && (
                            <div className="flex space-x-2">
                              <button
                                onClick={() => updateJobStatus(job.id, 'approved', user?.id || 'unknown')}
                                className="text-green-600 hover:text-green-900"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => updateJobStatus(job.id, 'rejected')}
                                className="text-red-600 hover:text-red-900"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                          {/* "View Details" button removed (was inert with no
                              onClick or modal target). Re-add when there's a
                              real job-details modal to open. */}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {selectedTab === 'analytics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-text mb-4">Customer Segments</h3>
              {/* SQL GROUP BY over every profile. The previous version counted
                  the loaded array, so the bars changed when you paged or
                  filtered the table. */}
              <div className="space-y-3">
                {(segments?.segments || []).map(segment => {
                  const totalCustomers = totals?.customers || 0
                  const percentage = totalCustomers > 0 ? (segment.customers / totalCustomers) * 100 : 0
                  return (
                    <div key={segment.role} className="flex items-center justify-between">
                      <span className="text-sm font-medium text-text">{segment.role}</span>
                      <div className="flex items-center">
                        <div className="w-20 bg-gray-200 rounded-full h-2 mr-2">
                          <div className="bg-purple-600 h-2 rounded-full" style={{ width: `${percentage}%` }}></div>
                        </div>
                        <span className="text-sm text-muted">{segment.customers}</span>
                      </div>
                    </div>
                  )
                })}
                {(segments?.segments || []).length === 0 && (
                  <p className="text-sm text-muted">No customer segments yet.</p>
                )}
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-text mb-4">Top Customers</h3>
              {/* Ranked by the server aggregate over the whole orders table.
                  Sorting the loaded page could only ever name the biggest
                  spender ON THAT PAGE. */}
              <div className="space-y-3">
                {(segments?.topCustomers || []).map((customer, index) => (
                  <div key={customer.id} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-muted mr-2">#{index + 1}</span>
                      <span className="text-sm font-medium text-text">{customer.name}</span>
                    </div>
                    <span className="text-sm font-semibold text-green-600">${customer.totalSpent.toFixed(2)}</span>
                  </div>
                ))}
                {(segments?.topCustomers || []).length === 0 && (
                  <p className="text-sm text-muted">No customer spend recorded yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer Detail Modal */}
      {showCustomerModal && selectedCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-text">Customer Details</h3>
              <button
                onClick={() => setShowCustomerModal(false)}
                className="text-gray-400 hover:text-muted"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <h4 className="font-semibold text-text mb-3">Contact Information</h4>
                <div className="space-y-2 text-sm">
                  <p><span className="font-medium">Name:</span> {selectedCustomer.name}</p>
                  <p><span className="font-medium">Email:</span> {selectedCustomer.email}</p>
                  <p><span className="font-medium">Phone:</span> {selectedCustomer.phone}</p>
                  <p><span className="font-medium">Company:</span> {selectedCustomer.company}</p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-text mb-3">Account Summary</h4>
                <div className="space-y-2 text-sm">
                  <p><span className="font-medium">Total Orders:</span> {selectedCustomer.totalOrders}</p>
                  <p><span className="font-medium">Total Spent:</span> ${selectedCustomer.totalSpent.toFixed(2)}</p>
                  <p><span className="font-medium">Last Order:</span> {selectedCustomer.lastOrderDate ? new Date(selectedCustomer.lastOrderDate).toLocaleDateString() : 'Never'}</p>
                  <p><span className="font-medium">Member Since:</span> {selectedCustomer.registrationDate ? new Date(selectedCustomer.registrationDate).toLocaleDateString() : 'Unknown'}</p>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <h4 className="font-semibold text-text mb-3">Tags</h4>
              <div className="flex flex-wrap gap-2">
                {selectedCustomer.tags.map((tag) => (
                  <span key={tag} className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm flex items-center">
                    {tag}
                    <button
                      onClick={() => removeTag(selectedCustomer.id, tag)}
                      className="ml-2 text-purple-600 hover:text-purple-800"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  onClick={() => addTag(selectedCustomer.id)}
                  className="px-3 py-1 border border-dashed card-border rounded-full text-sm text-muted hover:border-gray-400"
                >
                  + Add Tag
                </button>
              </div>
            </div>

            <div className="mb-6">
              <h4 className="font-semibold text-text mb-3">Notes</h4>
              <div className="space-y-3 mb-4">
                {selectedCustomer.notes.map((note) => (
                  <div key={note.id} className="bg-card rounded-lg p-3">
                    <div className="flex justify-between items-start mb-2">
                      <span className={`px-2 py-1 text-xs rounded ${
                        note.type === 'general' ? 'bg-gray-200 text-text' :
                        note.type === 'order' ? 'bg-blue-200 text-blue-700' :
                        note.type === 'complaint' ? 'bg-red-200 text-red-700' :
                        'bg-yellow-200 text-yellow-700'
                      }`}>
                        {note.type.replace('_', ' ')}
                      </span>
                      <span className="text-xs text-muted">{new Date(note.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="text-sm text-text">{note.content}</p>
                  </div>
                ))}
              </div>

              <div className="flex space-x-2">
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note..."
                  className="flex-1 px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <button
                  onClick={() => addNote(selectedCustomer.id)}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-md"
                >
                  Add Note
                </button>
              </div>
            </div>

            {/* Internal Chat */}
            <div className="mb-6">
              <h4 className="font-semibold text-text mb-3">Internal Team Chat</h4>
              <div className="border rounded-lg">
                <div className="h-64 overflow-y-auto p-4 bg-card">
                  {(chatMessages[selectedCustomer.id] || []).length === 0 ? (
                    <p className="text-muted text-center py-8">No messages yet. Start a conversation with your team about this customer.</p>
                  ) : (
                    <div className="space-y-3">
                      {(chatMessages[selectedCustomer.id] || []).map((msg) => (
                        <div key={msg.id} className="flex items-start space-x-2">
                          <div className="flex-shrink-0">
                            <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                              <span className="text-xs font-medium text-purple-600">
                                {msg.sender.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="bg-card rounded-lg p-3 shadow-sm">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-text">{msg.sender}</span>
                                <span className="text-xs text-muted">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                              </div>
                              <p className="text-sm text-text">{msg.message}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="p-4 border-t bg-card">
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={newChatMessage}
                      onChange={(e) => setNewChatMessage(e.target.value)}
                      placeholder="Send a message to your team..."
                      className="flex-1 px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && newChatMessage.trim()) {
                          const newMessage = {
                            id: Date.now().toString(),
                            message: newChatMessage,
                            sender: user?.email?.split('@')[0] || 'Team Member',
                            timestamp: new Date().toISOString()
                          }
                          setChatMessages(prev => ({
                            ...prev,
                            [selectedCustomer.id]: [...(prev[selectedCustomer.id] || []), newMessage]
                          }))
                          setNewChatMessage('')
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (newChatMessage.trim()) {
                          const newMessage = {
                            id: Date.now().toString(),
                            message: newChatMessage,
                            sender: user?.email?.split('@')[0] || 'Team Member',
                            timestamp: new Date().toISOString()
                          }
                          setChatMessages(prev => ({
                            ...prev,
                            [selectedCustomer.id]: [...(prev[selectedCustomer.id] || []), newMessage]
                          }))
                          setNewChatMessage('')
                        }
                      }}
                      className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-md flex items-center"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Customer Purchase History */}
            <div>
              <h4 className="font-semibold text-text mb-3">Purchase History</h4>
              <div className="bg-card rounded-lg p-4">
                {/* Fetched for THIS customer when the modal opens, rather than
                    filtered out of every order in memory. */}
                <div className="space-y-3">
                  {customerOrders.map((order) => (
                    <div key={order.id} className="flex items-center justify-between bg-card rounded p-3">
                      <div>
                        <div className="text-sm font-medium text-text">{order.orderNumber || order.id}</div>
                        <div className="text-xs text-muted">
                          {order.items.map(item => item.name).join(', ') || order.status}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-green-600">${order.total.toFixed(2)}</div>
                        <div className="text-xs text-muted">{new Date(order.createdAt).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                  {customerOrders.length === 0 && (
                    <p className="text-muted text-center py-4">No paid orders found for this customer</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

export default CRM
