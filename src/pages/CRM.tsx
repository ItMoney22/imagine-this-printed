import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
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

  // Mock data - replace with real PostgreSQL queries
  useEffect(() => {
    const mockCustomers: CustomerContact[] = [
      {
        id: '1',
        userId: 'user1',
        email: 'john.doe@example.com',
        name: 'John Doe',
        phone: '+1-555-0123',
        company: 'Design Studio Inc',
        tags: ['VIP', 'Bulk Orders'],
        notes: [
          {
            id: 'note1',
            content: 'Prefers DTF transfers, always orders in bulk',
            createdBy: user?.id || 'admin',
            createdAt: '2025-01-08T10:00:00Z',
            type: 'general'
          }
        ],
        totalSpent: 1247.89,
        totalOrders: 23,
        lastOrderDate: '2025-01-10T14:30:00Z',
        registrationDate: '2024-11-15T09:00:00Z',
        preferredProducts: ['DTF Transfers', 'Custom T-Shirts']
      },
      {
        id: '2',
        userId: 'user2',
        email: 'sarah.wilson@corp.com',
        name: 'Sarah Wilson',
        phone: '+1-555-0456',
        company: 'Corporate Events Ltd',
        tags: ['Corporate', 'Regular'],
        notes: [
          {
            id: 'note2',
            content: 'Monthly corporate orders for employee swag',
            createdBy: user?.id || 'admin',
            createdAt: '2025-01-05T16:45:00Z',
            type: 'order'
          }
        ],
        totalSpent: 2890.45,
        totalOrders: 12,
        lastOrderDate: '2025-01-09T11:20:00Z',
        registrationDate: '2024-10-20T14:15:00Z',
        preferredProducts: ['Hoodies', 'Tumblers']
      }
    ]

    const mockJobs: CustomJobRequest[] = [
      {
        id: '1',
        customerId: '1',
        title: 'Custom Wedding Favors',
        description: 'Need 200 custom tumblers with wedding date and names',
        requirements: 'Rose gold finish, elegant script font, rush delivery',
        budget: 1500,
        deadline: '2025-02-14T00:00:00Z',
        files: ['wedding-design.png'],
        status: 'under_review',
        estimatedCost: 1350,
        notes: ['Client is flexible on design but firm on deadline'],
        createdAt: '2025-01-10T09:30:00Z',
        updatedAt: '2025-01-10T15:45:00Z'
      },
      {
        id: '2',
        customerId: '2',
        title: 'Corporate Rebrand Package',
        description: '500 shirts, 300 hoodies with new company logo',
        requirements: 'High-quality materials, multiple sizes, branded packaging',
        budget: 8000,
        deadline: '2025-01-25T00:00:00Z',
        files: ['new-logo.svg', 'brand-guidelines.pdf'],
        status: 'approved',
        assignedTo: 'founder1',
        approvedBy: user?.id || 'manager1',
        estimatedCost: 7200,
        finalCost: 7450,
        notes: ['Approved with premium material upgrade', 'Assigned to lead founder'],
        createdAt: '2025-01-08T11:00:00Z',
        updatedAt: '2025-01-10T10:15:00Z'
      }
    ]

    const mockOrders: Order[] = [
      {
        id: 'ORD-001',
        userId: '1',
        status: 'printed',
        items: [
          {
            id: 'item-1',
            product: {
              id: 'shirt-1',
              name: 'Custom T-Shirt',
              description: 'High-quality custom t-shirt',
              price: 24.99,
              images: [],
              category: 'shirts',
              inStock: true
            },
            quantity: 5,
            customDesign: 'Logo design on front'
          }
        ],
        total: 145.73,
        shippingAddress: {
          name: 'John Doe',
          address1: '123 Main St',
          city: 'Portland',
          state: 'OR',
          zip: '97201',
          country: 'US'
        },
        createdAt: '2025-01-08T10:30:00Z',
        trackingNumber: 'MOCK123456789',
        shippingLabelUrl: 'https://example.com/label-001.pdf',
        estimatedDelivery: '2025-01-15T00:00:00Z',
        customerNotes: 'Please handle with care',
        internalNotes: 'VIP customer - priority handling'
      },
      {
        id: 'ORD-002',
        userId: '2',
        status: 'shipped',
        items: [
          {
            id: 'item-2',
            product: {
              id: 'hoodie-1',
              name: 'Custom Hoodie',
              description: 'Premium custom hoodie',
              price: 45.99,
              images: [],
              category: 'hoodies',
              inStock: true
            },
            quantity: 10,
            customDesign: 'Company logo embroidery'
          }
        ],
        total: 513.96,
        shippingAddress: {
          name: 'Sarah Wilson',
          address1: '456 Corporate Blvd',
          city: 'Seattle',
          state: 'WA',
          zip: '98101',
          country: 'US'
        },
        createdAt: '2025-01-05T09:15:00Z',
        trackingNumber: 'MOCK987654321',
        shippingLabelUrl: 'https://example.com/label-002.pdf'
      },
      {
        id: 'ORD-003',
        userId: '1',
        status: 'pending',
        items: [
          {
            id: 'item-3',
            product: {
              id: 'tumbler-1',
              name: 'Custom Tumbler',
              description: 'Insulated custom tumbler',
              price: 29.99,
              images: [],
              category: 'tumblers',
              inStock: true
            },
            quantity: 2,
            customDesign: 'Personalized engraving'
          }
        ],
        total: 73.41,
        shippingAddress: {
          name: 'John Doe',
          address1: '123 Main St',
          city: 'Portland',
          state: 'OR',
          zip: '97201',
          country: 'US'
        },
        createdAt: '2025-01-11T15:22:00Z'
      }
    ]

    setCustomers(mockCustomers)
    setJobs(mockJobs)
    setOrders(mockOrders)
  }, [user?.id])

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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text mb-2">CRM & Order Management</h1>
        <p className="text-muted">Manage customer relationships and custom job requests</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Total Customers</p>
              <p className="text-2xl font-semibold text-text">{customers.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Total Orders</p>
              <p className="text-2xl font-semibold text-text">{orders.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Pending Orders</p>
              <p className="text-2xl font-semibold text-text">{orders.filter(o => o.status === 'pending').length}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Total Revenue</p>
              <p className="text-2xl font-semibold text-text">${customers.reduce((sum, c) => sum + c.totalSpent, 0).toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {['customers', 'orders', 'jobs', 'analytics'].map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                selectedTab === tab
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-muted hover:text-text hover:card-border'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Customers Tab */}
      {selectedTab === 'customers' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search customers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <select
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              className="px-4 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="">All Tags</option>
              {allTags.map(tag => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
            <button
              onClick={exportCustomers}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md flex items-center"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </button>
          </div>

          <div className="bg-card rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-card">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Contact</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Tags</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Orders</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Total Spent</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Last Order</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-card divide-y divide-gray-200">
                  {filteredCustomers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-card">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-text">{customer.name}</div>
                          <div className="text-sm text-muted">{customer.company}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-text">{customer.email}</div>
                        <div className="text-sm text-muted">{customer.phone}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex flex-wrap gap-1">
                          {customer.tags.map((tag) => (
                            <span key={tag} className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text">{customer.totalOrders}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">${customer.totalSpent.toFixed(2)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {customer.lastOrderDate ? new Date(customer.lastOrderDate).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => {
                            setSelectedCustomer(customer)
                            setShowCustomerModal(true)
                          }}
                          className="text-purple-600 hover:text-purple-900 mr-3"
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
  )
}

export default CRM