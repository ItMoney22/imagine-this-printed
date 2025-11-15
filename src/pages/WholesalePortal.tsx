import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useNavigate } from 'react-router-dom'
import type { WholesaleAccount, WholesaleProduct } from '../types'

const WholesalePortal: React.FC = () => {
  const { user } = useAuth()
  const [selectedTab, setSelectedTab] = useState<'dashboard' | 'products' | 'orders' | 'vendors' | 'account' | 'apply'>('dashboard')
  const [isLoading, setIsLoading] = useState(true)
  const [wholesaleAccount, setWholesaleAccount] = useState<WholesaleAccount | null>(null)

  useEffect(() => {
    // Check if user has wholesale access or needs to apply
    checkWholesaleAccess()
  }, [user])

  const checkWholesaleAccess = async () => {
    setIsLoading(true)
    try {
      // Mock check - in real app, this would query the database
      if (user?.role === 'wholesale') {
        // User has wholesale access, load their account
        const mockAccount: WholesaleAccount = {
          id: 'ws_account_1',
          userId: user.id,
          companyName: (user as any).companyName || 'ABC Retail Inc.',
          businessType: 'retailer',
          taxId: '12-3456789',
          address: {
            company: 'ABC Retail Inc.',
            address1: '123 Business St',
            city: 'Business City',
            state: 'CA',
            zip: '90210',
            country: 'US',
            phone: '(555) 123-4567',
            email: 'wholesale@abcretail.com'
          },
          contactPerson: {
            firstName: (user as any).firstName || 'John',
            lastName: (user as any).lastName || 'Doe',
            title: 'Purchasing Manager',
            email: user.email || '',
            phone: '(555) 123-4567'
          },
          tier: (user as any).wholesaleTier || 'bronze',
          status: (user as any).wholesaleStatus || 'approved',
          creditLimit: (user as any).creditLimit || 10000,
          paymentTerms: (user as any).paymentTerms || 30,
          discountRate: 0.15,
          totalOrders: 45,
          totalSpent: 87500.50,
          averageOrderValue: 1944.45,
          lastOrderDate: '2025-01-10T10:30:00Z',
          registrationDate: '2024-06-15T00:00:00Z',
          approvedDate: '2024-06-18T00:00:00Z',
          approvedBy: 'admin_user',
          notes: ['Excellent payment history', 'High volume customer'],
          documents: []
        }
        setWholesaleAccount(mockAccount)
      } else {
        // User needs to apply for wholesale access
        setSelectedTab('apply')
      }
    } catch (error) {
      console.error('Error checking wholesale access:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <p className="text-yellow-800">Please sign in to access the wholesale portal.</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      </div>
    )
  }

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊', available: !!wholesaleAccount },
    { id: 'products', label: 'Products', icon: '📦', available: !!wholesaleAccount },
    { id: 'orders', label: 'Orders', icon: '📋', available: !!wholesaleAccount },
    { id: 'vendors', label: 'Vendors', icon: '🏢', available: !!wholesaleAccount },
    { id: 'account', label: 'Account', icon: '⚙️', available: !!wholesaleAccount },
    { id: 'apply', label: 'Apply', icon: '📝', available: !wholesaleAccount }
  ].filter(tab => tab.available)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text mb-2">Wholesale Portal</h1>
        <p className="text-muted">
          {wholesaleAccount 
            ? `Welcome back, ${wholesaleAccount.companyName}` 
            : 'Apply for wholesale access to unlock exclusive pricing and features'
          }
        </p>
      </div>

      {/* Account Status Banner */}
      {wholesaleAccount && (
        <div className="mb-8 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="w-8 h-8 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-lg font-medium text-green-900">
                  {wholesaleAccount.tier.charAt(0).toUpperCase() + wholesaleAccount.tier.slice(1)} Tier Account
                </h3>
                <p className="text-green-700">
                  {wholesaleAccount.discountRate * 100}% wholesale discount • ${wholesaleAccount.creditLimit.toLocaleString()} credit limit
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted">Total Spent</p>
              <p className="text-2xl font-bold text-green-600">${wholesaleAccount.totalSpent.toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                selectedTab === tab.id
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-muted hover:text-text hover:card-border'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {selectedTab === 'dashboard' && wholesaleAccount && (
        <WholesaleDashboard account={wholesaleAccount} />
      )}

      {selectedTab === 'products' && wholesaleAccount && (
        <WholesaleProducts account={wholesaleAccount} />
      )}

      {selectedTab === 'orders' && wholesaleAccount && (
        <WholesaleOrders account={wholesaleAccount} />
      )}

      {selectedTab === 'vendors' && wholesaleAccount && (
        <WholesaleVendors />
      )}

      {selectedTab === 'account' && wholesaleAccount && (
        <WholesaleAccount account={wholesaleAccount} />
      )}

      {selectedTab === 'apply' && !wholesaleAccount && (
        <WholesaleApplication onApplicationSubmit={() => {
          // Handle application submission
          alert('Application submitted! We will review your application within 2-3 business days.')
        }} />
      )}
    </div>
  )
}

// Dashboard Component
const WholesaleDashboard: React.FC<{ account: WholesaleAccount }> = ({ account }) => {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Total Orders</p>
              <p className="text-2xl font-semibold text-text">{account.totalOrders}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Total Spent</p>
              <p className="text-2xl font-semibold text-text">${account.totalSpent.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Avg Order Value</p>
              <p className="text-2xl font-semibold text-text">${account.averageOrderValue.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Credit Available</p>
              <p className="text-2xl font-semibold text-text">${(account.creditLimit - (account.totalSpent * 0.1)).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="bg-card rounded-lg shadow">
        <div className="px-6 py-4 border-b card-border">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-text">Recent Orders</h3>
            <button
              onClick={() => navigate('/wholesale/orders')}
              className="text-purple-600 hover:text-purple-700 font-medium text-sm"
            >
              View All →
            </button>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            {[
              { id: 'WO-2025-001', date: '2025-01-10', items: 25, total: 2450.00, status: 'delivered' },
              { id: 'WO-2025-002', date: '2025-01-08', items: 12, total: 1320.00, status: 'shipped' },
              { id: 'WO-2025-003', date: '2025-01-05', items: 35, total: 3850.00, status: 'processing' }
            ].map((order) => (
              <div key={order.id} className="flex items-center justify-between p-4 bg-card rounded-lg">
                <div>
                  <p className="font-medium text-text">{order.id}</p>
                  <p className="text-sm text-muted">{new Date(order.date).toLocaleDateString()} • {order.items} items</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-text">${order.total.toLocaleString()}</p>
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    order.status === 'delivered' ? 'bg-green-100 text-green-800' :
                    order.status === 'shipped' ? 'bg-blue-100 text-blue-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {order.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-text mb-4">Browse Products</h3>
          <p className="text-muted mb-4">Explore our wholesale catalog with exclusive pricing</p>
          <button
            onClick={() => navigate('/wholesale/products')}
            className="btn-primary w-full"
          >
            View Catalog
          </button>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-text mb-4">Place Quick Order</h3>
          <p className="text-muted mb-4">Reorder your most popular items quickly</p>
          <button className="btn-secondary w-full">
            Quick Reorder
          </button>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-text mb-4">Find Vendors</h3>
          <p className="text-muted mb-4">Discover new suppliers and vendors</p>
          <button
            onClick={() => navigate('/wholesale/vendors')}
            className="btn-secondary w-full"
          >
            Browse Vendors
          </button>
        </div>
      </div>
    </div>
  )
}

// Products Component
const WholesaleProducts: React.FC<{ account: WholesaleAccount }> = ({ account }) => {
  const [products] = useState<WholesaleProduct[]>([
    {
      id: 'wp_1',
      name: 'Premium Cotton T-Shirt - Bulk Pack',
      description: 'High-quality 100% cotton t-shirts, perfect for custom printing',
      retailPrice: 24.99,
      wholesalePricing: [
        { tier: 'bronze', price: 18.74, minimumQuantity: 12 },
        { tier: 'silver', price: 17.49, minimumQuantity: 24 },
        { tier: 'gold', price: 16.24, minimumQuantity: 48 },
        { tier: 'platinum', price: 14.99, minimumQuantity: 96 }
      ],
      images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&h=600&fit=crop'],
      category: 'shirts',
      inStock: true,
      minimumOrderQuantity: 12,
      leadTime: 3,
      specifications: [
        { name: 'Material', value: '100% Cotton', type: 'material' },
        { name: 'Weight', value: '180 GSM', type: 'measurement' },
        { name: 'Sizes Available', value: 'XS-5XL', type: 'text' }
      ],
      bulkDiscounts: [
        { minimumQuantity: 100, discountPercentage: 5, description: '5% off orders of 100+' },
        { minimumQuantity: 250, discountPercentage: 10, description: '10% off orders of 250+' }
      ],
      customizationOptions: [
        {
          id: 'size',
          name: 'Size',
          type: 'size',
          options: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
          required: true
        },
        {
          id: 'color',
          name: 'Color',
          type: 'color',
          options: ['White', 'Black', 'Navy', 'Red', 'Royal Blue'],
          required: true
        }
      ],
      createdAt: '2025-01-01T00:00:00Z'
    }
  ])

  const getMyPrice = (product: WholesaleProduct): number => {
    const pricing = product.wholesalePricing.find((p: any) => p.tier === account.tier)
    return pricing?.price || product.retailPrice
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-card rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-text mb-4">Filter Products</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <select className="form-select">
            <option>All Categories</option>
            <option>T-Shirts</option>
            <option>Hoodies</option>
            <option>DTF Transfers</option>
            <option>Tumblers</option>
          </select>
          <select className="form-select">
            <option>All Vendors</option>
            <option>Premium Apparel Co</option>
            <option>Quality Prints Ltd</option>
          </select>
          <select className="form-select">
            <option>Sort by Price</option>
            <option>Sort by Name</option>
            <option>Sort by Lead Time</option>
          </select>
          <input
            type="text"
            placeholder="Search products..."
            className="form-input"
          />
        </div>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {products.map((product) => (
          <div key={product.id} className="bg-card rounded-lg shadow overflow-hidden">
            <img
              src={product.images[0]}
              alt={product.name}
              className="w-full h-48 object-cover"
            />
            <div className="p-6">
              <h3 className="text-lg font-medium text-text mb-2">{product.name}</h3>
              <p className="text-muted text-sm mb-4 line-clamp-2">{product.description}</p>
              
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-muted line-through">${product.retailPrice}</p>
                  <p className="text-xl font-bold text-green-600">${getMyPrice(product)}</p>
                  <p className="text-xs text-muted">Your {account.tier} price</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted">MOQ</p>
                  <p className="font-medium">{product.minimumOrderQuantity}</p>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Lead Time:</span>
                  <span>{product.leadTime} days</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Stock:</span>
                  <span className="text-green-600">In Stock</span>
                </div>
              </div>

              <div className="space-y-2">
                <button className="btn-primary w-full text-sm">
                  View Details
                </button>
                <button className="btn-secondary w-full text-sm">
                  Add to Quote
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Placeholder components for other tabs
const WholesaleOrders: React.FC<{ account: WholesaleAccount }> = () => (
  <div className="bg-card rounded-lg shadow p-6">
    <h3 className="text-lg font-medium text-text mb-4">Order Management</h3>
    <p className="text-muted">Order management interface will be implemented here.</p>
  </div>
)

const WholesaleVendors: React.FC = () => (
  <div className="bg-card rounded-lg shadow p-6">
    <h3 className="text-lg font-medium text-text mb-4">Vendor Directory</h3>
    <p className="text-muted">Vendor discovery and management interface will be implemented here.</p>
  </div>
)

const WholesaleAccount: React.FC<{ account: WholesaleAccount }> = () => (
  <div className="bg-card rounded-lg shadow p-6">
    <h3 className="text-lg font-medium text-text mb-4">Account Settings</h3>
    <p className="text-muted">Account management interface will be implemented here.</p>
  </div>
)

const WholesaleApplication: React.FC<{ onApplicationSubmit: () => void }> = ({ onApplicationSubmit }) => (
  <div className="bg-card rounded-lg shadow p-6">
    <h3 className="text-lg font-medium text-text mb-4">Apply for Wholesale Access</h3>
    <p className="text-muted mb-6">
      Join our wholesale program to access exclusive pricing, bulk discounts, and priority support.
    </p>
    
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div>
        <label className="block text-sm font-medium text-text mb-2">Company Name</label>
        <input type="text" className="form-input w-full" />
      </div>
      <div>
        <label className="block text-sm font-medium text-text mb-2">Business Type</label>
        <select className="form-select w-full">
          <option>Select...</option>
          <option>Retailer</option>
          <option>Distributor</option>
          <option>Reseller</option>
          <option>Manufacturer</option>
        </select>
      </div>
    </div>
    
    <div className="mt-6">
      <button
        onClick={onApplicationSubmit}
        className="btn-primary"
      >
        Submit Application
      </button>
    </div>
  </div>
)

export default WholesalePortal
