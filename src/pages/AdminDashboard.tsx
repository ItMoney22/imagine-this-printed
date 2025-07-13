import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import type { User, VendorProduct, ThreeDModel, SystemMetrics, AuditLog } from '../types'

const AdminDashboard: React.FC = () => {
  const { user } = useAuth()
  const [selectedTab, setSelectedTab] = useState<'overview' | 'users' | 'vendors' | 'products' | 'models' | 'audit'>('overview')
  const [users, setUsers] = useState<User[]>([])
  const [vendorProducts, setVendorProducts] = useState<VendorProduct[]>([])
  const [models, setModels] = useState<ThreeDModel[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>({
    totalUsers: 0,
    totalOrders: 0,
    totalRevenue: 0,
    activeVendors: 0,
    pendingApprovals: 0,
    modelsUploaded: 0,
    pointsDistributed: 0,
    activeSessions: 0
  })

  // Mock data - replace with real Supabase queries
  useEffect(() => {
    const mockUsers: User[] = [
      {
        id: '1',
        email: 'john@example.com',
        role: 'customer',
        firstName: 'John',
        lastName: 'Doe',
        points: 250,
        itcBalance: 15.5,
        createdAt: '2024-11-15T09:00:00Z'
      },
      {
        id: '2',
        email: 'sarah@vendor.com',
        role: 'vendor',
        firstName: 'Sarah',
        lastName: 'Wilson',
        points: 180,
        itcBalance: 45.2,
        stripeAccountId: 'acct_vendor123',
        createdAt: '2024-10-20T14:15:00Z'
      },
      {
        id: '3',
        email: 'pending@vendor.com',
        role: 'customer',
        firstName: 'Mike',
        lastName: 'Johnson',
        points: 0,
        itcBalance: 0,
        createdAt: '2025-01-08T16:30:00Z'
      }
    ]

    const mockVendorProducts: VendorProduct[] = [
      {
        id: '1',
        vendorId: '2',
        title: 'Gaming Mouse Pad Pro',
        description: 'Professional gaming mouse pad with RGB lighting',
        price: 39.99,
        images: ['https://images.unsplash.com/photo-1527814050087-3793815479db?w=300&h=300&fit=crop'],
        category: 'gaming',
        approved: false,
        commissionRate: 15,
        createdAt: '2025-01-10T10:00:00Z'
      },
      {
        id: '2',
        vendorId: '2',
        title: 'Eco Water Bottle',
        description: 'Sustainable bamboo water bottle',
        price: 24.99,
        images: ['https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=300&h=300&fit=crop'],
        category: 'eco',
        approved: true,
        commissionRate: 15,
        createdAt: '2025-01-09T14:30:00Z'
      }
    ]

    const mockModels: ThreeDModel[] = [
      {
        id: '1',
        title: 'Dragon Figurine',
        description: 'Detailed fantasy dragon model',
        fileUrl: '/models/dragon.stl',
        category: 'figurines',
        uploadedBy: '1',
        approved: false,
        votes: 23,
        points: 50,
        createdAt: '2025-01-09T12:00:00Z',
        fileType: 'stl'
      },
      {
        id: '2',
        title: 'Phone Stand',
        description: 'Minimalist phone stand',
        fileUrl: '/models/phone-stand.stl',
        category: 'functional',
        uploadedBy: '3',
        approved: true,
        votes: 45,
        points: 100,
        createdAt: '2025-01-08T15:45:00Z',
        fileType: 'stl'
      }
    ]

    const mockAuditLogs: AuditLog[] = [
      {
        id: '1',
        userId: user?.id || 'admin1',
        action: 'APPROVE_PRODUCT',
        entity: 'VendorProduct',
        entityId: '2',
        changes: { approved: true },
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0...',
        createdAt: '2025-01-10T09:15:00Z'
      },
      {
        id: '2',
        userId: '2',
        action: 'SUBMIT_PRODUCT',
        entity: 'VendorProduct',
        entityId: '1',
        changes: { title: 'Gaming Mouse Pad Pro', price: 39.99 },
        ipAddress: '192.168.1.50',
        userAgent: 'Mozilla/5.0...',
        createdAt: '2025-01-10T10:00:00Z'
      },
      {
        id: '3',
        userId: user?.id || 'admin1',
        action: 'ROLE_CHANGE',
        entity: 'User',
        entityId: '2',
        changes: { role: 'vendor' },
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0...',
        createdAt: '2025-01-09T16:20:00Z'
      }
    ]

    const mockMetrics: SystemMetrics = {
      totalUsers: mockUsers.length,
      totalOrders: 47,
      totalRevenue: 4138.67,
      activeVendors: mockUsers.filter(u => u.role === 'vendor').length,
      pendingApprovals: mockVendorProducts.filter(p => !p.approved).length + mockModels.filter(m => !m.approved).length,
      modelsUploaded: mockModels.length,
      pointsDistributed: mockUsers.reduce((sum, u) => sum + (u.points || 0), 0),
      activeSessions: 12
    }

    setUsers(mockUsers)
    setVendorProducts(mockVendorProducts)
    setModels(mockModels)
    setAuditLogs(mockAuditLogs)
    setSystemMetrics(mockMetrics)
  }, [user?.id])

  const updateUserRole = (userId: string, newRole: User['role']) => {
    setUsers(prev => prev.map(u => 
      u.id === userId ? { ...u, role: newRole } : u
    ))
    
    // Add audit log
    const auditLog: AuditLog = {
      id: Date.now().toString(),
      userId: user?.id || 'admin',
      action: 'ROLE_CHANGE',
      entity: 'User',
      entityId: userId,
      changes: { role: newRole },
      ipAddress: '192.168.1.100',
      userAgent: navigator.userAgent,
      createdAt: new Date().toISOString()
    }
    setAuditLogs(prev => [auditLog, ...prev])
  }

  const approveVendorProduct = (productId: string) => {
    setVendorProducts(prev => prev.map(p => 
      p.id === productId ? { ...p, approved: true } : p
    ))
    
    // Add audit log
    const auditLog: AuditLog = {
      id: Date.now().toString(),
      userId: user?.id || 'admin',
      action: 'APPROVE_PRODUCT',
      entity: 'VendorProduct',
      entityId: productId,
      changes: { approved: true },
      ipAddress: '192.168.1.100',
      userAgent: navigator.userAgent,
      createdAt: new Date().toISOString()
    }
    setAuditLogs(prev => [auditLog, ...prev])
  }

  const rejectVendorProduct = (productId: string) => {
    setVendorProducts(prev => prev.filter(p => p.id !== productId))
    
    // Add audit log
    const auditLog: AuditLog = {
      id: Date.now().toString(),
      userId: user?.id || 'admin',
      action: 'REJECT_PRODUCT',
      entity: 'VendorProduct',
      entityId: productId,
      changes: { rejected: true },
      ipAddress: '192.168.1.100',
      userAgent: navigator.userAgent,
      createdAt: new Date().toISOString()
    }
    setAuditLogs(prev => [auditLog, ...prev])
  }

  const approveModel = (modelId: string) => {
    setModels(prev => prev.map(m => 
      m.id === modelId ? { ...m, approved: true } : m
    ))
    
    // Add audit log
    const auditLog: AuditLog = {
      id: Date.now().toString(),
      userId: user?.id || 'admin',
      action: 'APPROVE_MODEL',
      entity: 'ThreeDModel',
      entityId: modelId,
      changes: { approved: true },
      ipAddress: '192.168.1.100',
      userAgent: navigator.userAgent,
      createdAt: new Date().toISOString()
    }
    setAuditLogs(prev => [auditLog, ...prev])
  }

  const rejectModel = (modelId: string) => {
    setModels(prev => prev.filter(m => m.id !== modelId))
    
    // Add audit log
    const auditLog: AuditLog = {
      id: Date.now().toString(),
      userId: user?.id || 'admin',
      action: 'REJECT_MODEL',
      entity: 'ThreeDModel',
      entityId: modelId,
      changes: { rejected: true },
      ipAddress: '192.168.1.100',
      userAgent: navigator.userAgent,
      createdAt: new Date().toISOString()
    }
    setAuditLogs(prev => [auditLog, ...prev])
  }

  if (user?.role !== 'admin') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. This page is for administrators only.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Dashboard</h1>
        <p className="text-gray-600">Manage users, approvals, and monitor system performance</p>
      </div>

      {/* System Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Users</p>
              <p className="text-2xl font-semibold text-gray-900">{systemMetrics.totalUsers}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Revenue</p>
              <p className="text-2xl font-semibold text-gray-900">${systemMetrics.totalRevenue.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Pending Approvals</p>
              <p className="text-2xl font-semibold text-gray-900">{systemMetrics.pendingApprovals}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Active Sessions</p>
              <p className="text-2xl font-semibold text-gray-900">{systemMetrics.activeSessions}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {['overview', 'users', 'vendors', 'products', 'models', 'audit'].map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                selectedTab === tab
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {selectedTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <button 
                  onClick={() => setSelectedTab('vendors')}
                  className="w-full text-left p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  <div className="font-medium text-blue-900">Review Vendor Products</div>
                  <div className="text-sm text-blue-600">{vendorProducts.filter(p => !p.approved).length} pending approval</div>
                </button>
                <button 
                  onClick={() => setSelectedTab('models')}
                  className="w-full text-left p-3 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
                >
                  <div className="font-medium text-green-900">Review 3D Models</div>
                  <div className="text-sm text-green-600">{models.filter(m => !m.approved).length} pending approval</div>
                </button>
                <button 
                  onClick={() => setSelectedTab('users')}
                  className="w-full text-left p-3 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                >
                  <div className="font-medium text-purple-900">Manage User Roles</div>
                  <div className="text-sm text-purple-600">{users.length} total users</div>
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">System Health</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Database Status</span>
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Healthy</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">API Response Time</span>
                  <span className="text-sm text-gray-600">45ms</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Storage Usage</span>
                  <span className="text-sm text-gray-600">68% of 100GB</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Active Vendors</span>
                  <span className="text-sm text-gray-600">{systemMetrics.activeVendors}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
            <div className="space-y-3">
              {auditLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{log.action.replace('_', ' ')}</p>
                    <p className="text-xs text-gray-500">{log.entity} #{log.entityId}</p>
                  </div>
                  <span className="text-xs text-gray-500">{new Date(log.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {selectedTab === 'users' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">User Management</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Points</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ITC Balance</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{user.firstName} {user.lastName}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.email}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={user.role}
                        onChange={(e) => updateUserRole(user.id, e.target.value as User['role'])}
                        className="text-sm border border-gray-300 rounded px-2 py-1"
                      >
                        <option value="customer">Customer</option>
                        <option value="vendor">Vendor</option>
                        <option value="founder">Founder</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.points || 0}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.itcBalance || 0} ITC</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button className="text-blue-600 hover:text-blue-900 mr-3">Edit</button>
                      <button className="text-red-600 hover:text-red-900">Suspend</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vendor Products Tab */}
      {selectedTab === 'vendors' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Vendor Product Approvals</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
            {vendorProducts.map((product) => {
              const vendor = users.find(u => u.id === product.vendorId)
              return (
                <div key={product.id} className="border rounded-lg overflow-hidden">
                  <img 
                    src={product.images[0]} 
                    alt={product.title}
                    className="w-full h-48 object-cover"
                  />
                  <div className="p-4">
                    <h4 className="font-semibold text-gray-900 mb-2">{product.title}</h4>
                    <p className="text-gray-600 text-sm mb-3">{product.description}</p>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-lg font-bold text-gray-900">${product.price}</span>
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        product.approved 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {product.approved ? 'Approved' : 'Pending'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mb-3">
                      Vendor: {vendor?.firstName} {vendor?.lastName}
                    </p>
                    
                    {!product.approved && (
                      <div className="flex space-x-2">
                        <button 
                          onClick={() => approveVendorProduct(product.id)}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm py-2 px-3 rounded"
                        >
                          Approve
                        </button>
                        <button 
                          onClick={() => rejectVendorProduct(product.id)}
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-2 px-3 rounded"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 3D Models Tab */}
      {selectedTab === 'models' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">3D Model Approvals</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
            {models.map((model) => {
              const uploader = users.find(u => u.id === model.uploadedBy)
              return (
                <div key={model.id} className="border rounded-lg overflow-hidden">
                  <div className="h-48 bg-gray-100 flex items-center justify-center">
                    <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <div className="p-4">
                    <h4 className="font-semibold text-gray-900 mb-2">{model.title}</h4>
                    <p className="text-gray-600 text-sm mb-3">{model.description}</p>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-gray-600">{model.fileType.toUpperCase()}</span>
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        model.approved 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {model.approved ? 'Approved' : 'Pending'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-sm text-gray-500">👍 {model.votes} votes</span>
                      <span className="text-sm text-gray-500">⭐ {model.points} points</span>
                    </div>
                    <p className="text-sm text-gray-500 mb-3">
                      By: {uploader?.firstName} {uploader?.lastName}
                    </p>
                    
                    {!model.approved && (
                      <div className="flex space-x-2">
                        <button 
                          onClick={() => approveModel(model.id)}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm py-2 px-3 rounded"
                        >
                          Approve
                        </button>
                        <button 
                          onClick={() => rejectModel(model.id)}
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-2 px-3 rounded"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Audit Logs Tab */}
      {selectedTab === 'audit' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Audit Logs</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Entity</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Changes</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {auditLogs.map((log) => {
                  const logUser = users.find(u => u.id === log.userId)
                  return (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {logUser ? `${logUser.firstName} ${logUser.lastName}` : 'System'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          log.action.includes('APPROVE') ? 'bg-green-100 text-green-800' :
                          log.action.includes('REJECT') ? 'bg-red-100 text-red-800' :
                          log.action.includes('CREATE') ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {log.action.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {log.entity} #{log.entityId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {Object.keys(log.changes || {}).join(', ')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {log.ipAddress}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminDashboard