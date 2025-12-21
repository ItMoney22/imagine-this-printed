import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import type { CustomerContact, ContactNote, CustomJobRequest, Order } from '../types'

const CRM: React.FC = () => {
  const { user } = useAuth()
  const [selectedTab, setSelectedTab] = useState<'customers' | 'jobs' | 'analytics' | 'orders'>('customers')
  const [customers, setCustomers] = useState<CustomerContact[]>([])
  const [jobs, setJobs] = useState<CustomJobRequest[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerContact | null>(null)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [chatMessages, setChatMessages] = useState<{[customerId: string]: Array<{id: string, message: string, sender: string, timestamp: string}>}>({})
  const [newChatMessage, setNewChatMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch real data from Supabase
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        // Fetch customers from user_profiles
        const { data: profiles, error: profilesError } = await supabase
          .from('user_profiles')
          .select('*')
          .order('created_at', { ascending: false })

        if (profilesError) throw profilesError

        // Fetch orders
        const { data: ordersData, error: ordersError } = await supabase
          .from('orders')
          .select('*')
          .order('created_at', { ascending: false })

        if (ordersError) throw ordersError

        // Calculate customer stats from orders
        const customerStats: Record<string, { totalSpent: number; totalOrders: number; lastOrderDate: string | null }> = {}

        ordersData?.forEach((order: any) => {
          const userId = order.user_id
          if (!customerStats[userId]) {
            customerStats[userId] = { totalSpent: 0, totalOrders: 0, lastOrderDate: null }
          }
          customerStats[userId].totalSpent += parseFloat(order.total_amount || order.total || 0)
          customerStats[userId].totalOrders += 1
          if (!customerStats[userId].lastOrderDate || order.created_at > customerStats[userId].lastOrderDate) {
            customerStats[userId].lastOrderDate = order.created_at
          }
        })

        // Map user_profiles to CustomerContact format
        const mappedCustomers: CustomerContact[] = (profiles || []).map((profile: any) => {
          const stats = customerStats[profile.id] || { totalSpent: 0, totalOrders: 0, lastOrderDate: null }
          return {
            id: profile.id,
            userId: profile.id,
            email: profile.email || '',
            name: profile.display_name || profile.username || profile.email?.split('@')[0] || 'Unknown',
            phone: profile.phone || '',
            company: profile.company_name || '',
            tags: profile.role ? [profile.role] : [],
            notes: [],
            totalSpent: stats.totalSpent,
            totalOrders: stats.totalOrders,
            lastOrderDate: stats.lastOrderDate,
            registrationDate: profile.created_at,
            preferredProducts: []
          }
        })

        setCustomers(mappedCustomers)

        // Map orders to Order format
        const mappedOrders: Order[] = (ordersData || []).map((order: any) => ({
          id: order.id,
          userId: order.user_id,
          status: order.status || 'pending',
          items: order.items || [],
          total: parseFloat(order.total_amount || order.total || 0),
          shippingAddress: order.shipping_address || {},
          createdAt: order.created_at,
          trackingNumber: order.tracking_number,
          shippingLabelUrl: order.shipping_label_url,
          estimatedDelivery: order.estimated_delivery,
          customerNotes: order.customer_notes,
          internalNotes: order.internal_notes
        }))

        setOrders(mappedOrders)

        // Try to fetch custom job requests (table may not exist yet)
        try {
          const { data: jobsData, error: jobsError } = await supabase
            .from('custom_job_requests')
            .select('*')
            .order('created_at', { ascending: false })

          if (!jobsError && jobsData) {
            const mappedJobs: CustomJobRequest[] = jobsData.map((job: any) => ({
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
            }))
            setJobs(mappedJobs)
          }
        } catch {
          // custom_job_requests table may not exist yet
          console.log('[CRM] custom_job_requests table not found, using empty array')
          setJobs([])
        }

      } catch (err: any) {
        console.error('[CRM] Error fetching data:', err)
        setError(err.message || 'Failed to load CRM data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  const addNote = (customerId: string) => {
    if (!newNote.trim()) return

    const note: ContactNote = {
      id: Date.now().toString(),
      content: newNote,
      createdBy: user?.id || 'admin',
      createdAt: new Date().toISOString(),
      type: 'general'
    }

    setCustomers(prev => prev.map(customer => 
      customer.id === customerId 
        ? { ...customer, notes: [note, ...customer.notes] }
        : customer
    ))

    setNewNote('')
  }


  const removeTag = (customerId: string, tagToRemove: string) => {
    setCustomers(prev => prev.map(customer => 
      customer.id === customerId 
        ? { ...customer, tags: customer.tags.filter(tag => tag !== tagToRemove) }
        : customer
    ))
  }

  const updateJobStatus = (jobId: string, status: CustomJobRequest['status'], assignedTo?: string) => {
    setJobs(prev => prev.map(job => 
      job.id === jobId 
        ? { ...job, status, assignedTo, updatedAt: new Date().toISOString() }
        : job
    ))
  }

  const updateOrderStatus = (orderId: string, status: Order['status'], notes?: string) => {
    setOrders(prev => prev.map(order => 
      order.id === orderId 
        ? { 
            ...order, 
            status, 
            updatedAt: new Date().toISOString(),
            internalNotes: notes ? `${order.internalNotes || ''}\n${new Date().toLocaleDateString()}: ${notes}` : order.internalNotes
          }
        : order
    ))
  }

  const exportToCSV = (data: any[], filename: string) => {
    if (data.length === 0) {
      alert('No data to export')
      return
    }

    const headers = Object.keys(data[0]).join(',')
    const csvContent = [
      headers,
      ...data.map(row => 
        Object.values(row).map(value => 
          typeof value === 'string' && value.includes(',') ? `"${value}"` : value
        ).join(',')
      )
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const exportCustomers = () => {
    const customerData = customers.map(customer => ({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company,
      tags: customer.tags.join('; '),
      totalOrders: customer.totalOrders,
      totalSpent: customer.totalSpent,
      lastOrderDate: customer.lastOrderDate || 'Never',
      registrationDate: customer.registrationDate
    }))
    exportToCSV(customerData, 'customers')
  }

  const exportOrders = () => {
    const orderData = filteredOrders.map(order => {
      const customer = customers.find(c => c.userId === order.userId)
      return {
        orderId: order.id,
        customerName: customer?.name || 'Unknown',
        customerEmail: customer?.email || 'Unknown',
        status: order.status,
        total: order.total,
        createdAt: new Date(order.createdAt).toLocaleDateString(),
        trackingNumber: order.trackingNumber || 'N/A',
        items: order.items.map(item => `${item.product.name} (${item.quantity})`).join('; ')
      }
    })
    exportToCSV(orderData, 'orders')
  }

  const filteredCustomers = customers.filter(customer => {
    const matchesSearch = customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         customer.email.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesTag = !filterTag || customer.tags.includes(filterTag)
    return matchesSearch && matchesTag
  })

  const filteredOrders = orders.filter(order => {
    const customer = customers.find(c => c.userId === order.userId)
    const matchesSearch = (customer?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (customer?.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                         order.id.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = orderStatusFilter === 'all' || order.status === orderStatusFilter
    
    let matchesDate = true
    if (dateRange.start && dateRange.end) {
      const orderDate = new Date(order.createdAt)
      const startDate = new Date(dateRange.start)
      const endDate = new Date(dateRange.end)
      matchesDate = orderDate >= startDate && orderDate <= endDate
    }
    
    return matchesSearch && matchesStatus && matchesDate
  })

  const allTags = Array.from(new Set(customers.flatMap(c => c.tags)))

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
                <p className="text-white text-xl font-bold">{customers.length}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                <span className="text-purple-100 text-xs uppercase tracking-wider">Revenue</span>
                <p className="text-white text-xl font-bold">${customers.reduce((sum, c) => sum + c.totalSpent, 0).toFixed(0)}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                <span className="text-purple-100 text-xs uppercase tracking-wider">Pending</span>
                <p className="text-white text-xl font-bold">{orders.filter(o => o.status === 'pending').length}</p>
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
                <p className="text-2xl font-bold text-text">{customers.length}</p>
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
                <p className="text-sm font-medium text-muted">Total Orders</p>
                <p className="text-2xl font-bold text-text">{orders.length}</p>
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
                <p className="text-2xl font-bold text-text">{orders.filter(o => o.status === 'pending').length}</p>
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
                <p className="text-2xl font-bold text-text">${customers.reduce((sum, c) => sum + c.totalSpent, 0).toFixed(2)}</p>
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
              <button
                onClick={exportCustomers}
                className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-5 py-2.5 rounded-xl flex items-center shadow-lg shadow-green-500/25 transition-all"
              >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
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
                            onClick={() => {
                              setSelectedCustomer(customer)
                              setShowCustomerModal(true)
                            }}
                            className="px-3 py-1.5 bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 text-sm font-medium rounded-lg transition-colors"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              <option value="printed">Printed</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="on_hold">On Hold</option>
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
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md flex items-center whitespace-nowrap"
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
                    const customer = customers.find(c => c.userId === order.userId)
                    return (
                    <tr key={order.id} className="hover:bg-card">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-text">{order.id}</div>
                        <div className="text-sm text-muted">Order #{order.id.split('-')[1]}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-text">{customer?.name || 'Unknown'}</div>
                        <div className="text-sm text-muted">{customer?.email || 'Unknown'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-text">
                          {order.items.map((item, index) => (
                            <div key={index} className="mb-1">
                              {item.product.name} (x{item.quantity})
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
                </tbody>
              </table>
            </div>
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
                                onClick={() => updateJobStatus(job.id, 'approved', 'founder1')}
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
                          <button className="text-purple-600 hover:text-purple-900 ml-2">
                            View Details
                          </button>
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
              <div className="space-y-3">
                {allTags.map(tag => {
                  const count = customers.filter(c => c.tags.includes(tag)).length
                  const percentage = (count / customers.length) * 100
                  return (
                    <div key={tag} className="flex items-center justify-between">
                      <span className="text-sm font-medium text-text">{tag}</span>
                      <div className="flex items-center">
                        <div className="w-20 bg-gray-200 rounded-full h-2 mr-2">
                          <div className="bg-purple-600 h-2 rounded-full" style={{ width: `${percentage}%` }}></div>
                        </div>
                        <span className="text-sm text-muted">{count}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-text mb-4">Top Customers</h3>
              <div className="space-y-3">
                {customers
                  .sort((a, b) => b.totalSpent - a.totalSpent)
                  .slice(0, 5)
                  .map((customer, index) => (
                    <div key={customer.id} className="flex items-center justify-between">
                      <div className="flex items-center">
                        <span className="text-sm font-medium text-muted mr-2">#{index + 1}</span>
                        <span className="text-sm font-medium text-text">{customer.name}</span>
                      </div>
                      <span className="text-sm font-semibold text-green-600">${customer.totalSpent.toFixed(2)}</span>
                    </div>
                  ))}
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
                  <p><span className="font-medium">Member Since:</span> {new Date(selectedCustomer.registrationDate).toLocaleDateString()}</p>
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
                <button className="px-3 py-1 border border-dashed card-border rounded-full text-sm text-muted hover:border-gray-400">
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
                <div className="space-y-3">
                  {orders.filter(order => order.userId === selectedCustomer.userId).map((order) => (
                    <div key={order.id} className="flex items-center justify-between bg-card rounded p-3">
                      <div>
                        <div className="text-sm font-medium text-text">{order.id}</div>
                        <div className="text-xs text-muted">
                          {order.items.map(item => item.product.name).join(', ')}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-green-600">${order.total.toFixed(2)}</div>
                        <div className="text-xs text-muted">{new Date(order.createdAt).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                  {orders.filter(order => order.userId === selectedCustomer.userId).length === 0 && (
                    <p className="text-muted text-center py-4">No orders found for this customer</p>
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
