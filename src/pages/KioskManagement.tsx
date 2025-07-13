import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { kioskService } from '../utils/kiosk-service'
import type { Kiosk, KioskSettings, User } from '../types'

const KioskManagement: React.FC = () => {
  const { user } = useAuth()
  const [kiosks, setKiosks] = useState<Kiosk[]>([])
  const [selectedTab, setSelectedTab] = useState<'list' | 'create' | 'analytics'>('list')
  const [isLoading, setIsLoading] = useState(true)
  const [selectedKiosk, setSelectedKiosk] = useState<Kiosk | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)

  // Create kiosk form state
  const [createForm, setCreateForm] = useState({
    name: '',
    vendorId: '',
    location: '',
    commissionRate: 15,
    partnerCommissionRate: 5,
    settings: {
      allowCash: true,
      allowStripeTerminal: true,
      allowITCWallet: true,
      requireCustomerInfo: false,
      touchOptimized: true,
      kioskMode: true,
      autoLoginEnabled: true,
      sessionTimeout: 30,
      primaryColor: '#6B46C1',
      logoUrl: '',
      welcomeMessage: 'Welcome! Browse and order custom prints'
    } as KioskSettings
  })

  // Mock vendors for dropdown
  const [vendors] = useState<User[]>([
    { id: 'vendor_123', email: 'john@printshop.com', role: 'vendor', firstName: 'John', lastName: 'Smith' },
    { id: 'vendor_456', email: 'sarah@customprints.com', role: 'vendor', firstName: 'Sarah', lastName: 'Johnson' },
    { id: 'vendor_789', email: 'mike@mallkiosk.com', role: 'vendor', firstName: 'Mike', lastName: 'Chen' }
  ])

  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'founder')) {
      loadKiosks()
    }
  }, [user])

  const loadKiosks = async () => {
    try {
      setIsLoading(true)
      const kioskData = await kioskService.getAllKiosks()
      setKiosks(kioskData)
    } catch (error) {
      console.error('Error loading kiosks:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const createKiosk = async () => {
    try {
      const kioskData: Partial<Kiosk> = {
        name: createForm.name,
        vendorId: createForm.vendorId,
        location: createForm.location,
        commissionRate: createForm.commissionRate / 100,
        partnerCommissionRate: createForm.partnerCommissionRate / 100,
        settings: createForm.settings
      }

      const newKiosk = await kioskService.createKiosk(kioskData)
      setKiosks(prev => [...prev, newKiosk])
      setShowCreateModal(false)
      resetCreateForm()
      alert('Kiosk created successfully!')
    } catch (error) {
      console.error('Error creating kiosk:', error)
      alert('Failed to create kiosk')
    }
  }

  const resetCreateForm = () => {
    setCreateForm({
      name: '',
      vendorId: '',
      location: '',
      commissionRate: 15,
      partnerCommissionRate: 5,
      settings: {
        allowCash: true,
        allowStripeTerminal: true,
        allowITCWallet: true,
        requireCustomerInfo: false,
        touchOptimized: true,
        kioskMode: true,
        autoLoginEnabled: true,
        sessionTimeout: 30,
        primaryColor: '#6B46C1',
        logoUrl: '',
        welcomeMessage: 'Welcome! Browse and order custom prints'
      }
    })
  }


  const toggleKioskStatus = async (kioskId: string) => {
    try {
      const kiosk = kiosks.find(k => k.id === kioskId)
      if (!kiosk) return

      // In real app, this would call an API to toggle status
      const updatedKiosk = { ...kiosk, isActive: !kiosk.isActive }
      setKiosks(prev => prev.map(k => k.id === kioskId ? updatedKiosk : k))
      
      console.log(`Kiosk ${kioskId} ${updatedKiosk.isActive ? 'activated' : 'deactivated'}`)
    } catch (error) {
      console.error('Error toggling kiosk status:', error)
    }
  }

  const generateKioskAccess = (kioskId: string) => {
    const { url, pwaManifest, qrCode: _qrCode } = kioskService.generateKioskAccess(kioskId)
    
    // Show access information modal
    const accessInfo = `
Kiosk Access Information:

URL: ${url}
QR Code: Available for download
PWA Manifest: Generated

Setup Instructions:
1. Navigate to the URL on the target device
2. Add to home screen for PWA installation
3. Enable fullscreen mode for kiosk operation
4. Configure touch settings as needed

PWA Manifest: ${JSON.stringify(pwaManifest, null, 2)}
    `
    
    alert(accessInfo)
  }

  const getVendorName = (vendorId: string) => {
    const vendor = vendors.find(v => v.id === vendorId)
    return vendor ? `${vendor.firstName} ${vendor.lastName}` : 'Unknown Vendor'
  }

  const getStatusColor = (isActive: boolean) => {
    return isActive ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  if (!user || (user.role !== 'admin' && user.role !== 'founder')) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. Admin access required.</p>
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Kiosk Management</h1>
        <p className="text-gray-600">Manage point of sale kiosks and generate access</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'list', label: 'Kiosks', icon: '🖥️' },
            { id: 'create', label: 'Create Kiosk', icon: '➕' },
            { id: 'analytics', label: 'Analytics', icon: '📊' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                selectedTab === tab.id
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Kiosks List */}
      {selectedTab === 'list' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium text-gray-900">Active Kiosks</h3>
              <p className="text-sm text-gray-600">{kiosks.length} total kiosks</p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary"
            >
              Create New Kiosk
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {kiosks.map((kiosk) => (
              <div key={kiosk.id} className="bg-white rounded-lg shadow">
                <div className="px-6 py-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-medium text-gray-900">{kiosk.name}</h3>
                      <p className="text-sm text-gray-600">{kiosk.location}</p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(kiosk.isActive)}`}>
                      {kiosk.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
                
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Vendor</p>
                      <p className="font-medium">{getVendorName(kiosk.vendorId)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Commission</p>
                      <p className="font-medium">{((kiosk.commissionRate || 0) * 100).toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Total Sales</p>
                      <p className="font-medium text-green-600">{formatCurrency(kiosk.totalSales)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Orders</p>
                      <p className="font-medium">{kiosk.totalOrders}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs text-gray-500">
                      <p>Last Activity: {kiosk.lastActivity ? new Date(kiosk.lastActivity).toLocaleDateString() : 'Never'}</p>
                      <p>Created: {new Date(kiosk.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>

                  <div className="flex space-x-2">
                    <button
                      onClick={() => generateKioskAccess(kiosk.id)}
                      className="btn-secondary text-sm flex-1"
                    >
                      Access Info
                    </button>
                    <button
                      onClick={() => {
                        setSelectedKiosk(kiosk)
                        setShowSettingsModal(true)
                      }}
                      className="btn-secondary text-sm flex-1"
                    >
                      Settings
                    </button>
                    <button
                      onClick={() => toggleKioskStatus(kiosk.id)}
                      className={`text-sm px-3 py-2 rounded ${
                        kiosk.isActive 
                          ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                          : 'bg-green-100 text-green-700 hover:bg-green-200'
                      }`}
                    >
                      {kiosk.isActive ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {kiosks.length === 0 && (
            <div className="text-center py-12">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No kiosks created</h3>
              <p className="text-gray-600 mb-4">Create your first kiosk to enable in-store sales</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="btn-primary"
              >
                Create First Kiosk
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create Kiosk Form */}
      {selectedTab === 'create' && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Create New Kiosk</h3>
            <p className="text-sm text-gray-600">Set up a new point of sale kiosk</p>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Kiosk Name *
                </label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                  className="form-input w-full"
                  placeholder="Downtown Print Shop Kiosk"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Vendor *
                </label>
                <select
                  value={createForm.vendorId}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, vendorId: e.target.value }))}
                  className="form-select w-full"
                >
                  <option value="">Select a vendor</option>
                  {vendors.map(vendor => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.firstName} {vendor.lastName} ({vendor.email})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Location *
                </label>
                <input
                  type="text"
                  value={createForm.location}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, location: e.target.value }))}
                  className="form-input w-full"
                  placeholder="Downtown Print Shop - Main Counter"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Commission Rate (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={createForm.commissionRate}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, commissionRate: parseFloat(e.target.value) || 0 }))}
                  className="form-input w-full"
                />
                <p className="text-xs text-gray-500 mt-1">Platform commission on kiosk sales</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Partner Commission Rate (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={createForm.partnerCommissionRate}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, partnerCommissionRate: parseFloat(e.target.value) || 0 }))}
                  className="form-input w-full"
                />
                <p className="text-xs text-gray-500 mt-1">Commission for location partner (optional)</p>
              </div>
            </div>

            {/* Kiosk Settings */}
            <div>
              <h4 className="text-lg font-medium text-gray-900 mb-4">Kiosk Settings</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Primary Color
                  </label>
                  <input
                    type="color"
                    value={createForm.settings.primaryColor}
                    onChange={(e) => setCreateForm(prev => ({
                      ...prev,
                      settings: { ...prev.settings, primaryColor: e.target.value }
                    }))}
                    className="form-input w-full h-12"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Session Timeout (minutes)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="120"
                    value={createForm.settings.sessionTimeout}
                    onChange={(e) => setCreateForm(prev => ({
                      ...prev,
                      settings: { ...prev.settings, sessionTimeout: parseInt(e.target.value) || 30 }
                    }))}
                    className="form-input w-full"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Welcome Message
                  </label>
                  <textarea
                    value={createForm.settings.welcomeMessage}
                    onChange={(e) => setCreateForm(prev => ({
                      ...prev,
                      settings: { ...prev.settings, welcomeMessage: e.target.value }
                    }))}
                    rows={2}
                    className="form-input w-full"
                    placeholder="Welcome! Browse and order custom prints"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Logo URL (optional)
                  </label>
                  <input
                    type="url"
                    value={createForm.settings.logoUrl || ''}
                    onChange={(e) => setCreateForm(prev => ({
                      ...prev,
                      settings: { ...prev.settings, logoUrl: e.target.value }
                    }))}
                    className="form-input w-full"
                    placeholder="https://example.com/logo.png"
                  />
                </div>
              </div>

              {/* Checkboxes */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                {[
                  { key: 'allowCash', label: 'Allow Cash Payments' },
                  { key: 'allowStripeTerminal', label: 'Allow Card Payments' },
                  { key: 'allowITCWallet', label: 'Allow ITC Wallet' },
                  { key: 'requireCustomerInfo', label: 'Require Customer Info' },
                  { key: 'touchOptimized', label: 'Touch Optimized UI' },
                  { key: 'kioskMode', label: 'Full Kiosk Mode' },
                  { key: 'autoLoginEnabled', label: 'Auto Login' }
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={createForm.settings[key as keyof KioskSettings] as boolean}
                      onChange={(e) => setCreateForm(prev => ({
                        ...prev,
                        settings: { ...prev.settings, [key]: e.target.checked }
                      }))}
                      className="form-checkbox"
                    />
                    <span className="ml-2 text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-gray-200 flex justify-between">
              <button
                onClick={resetCreateForm}
                className="btn-secondary"
              >
                Reset Form
              </button>
              <button
                onClick={createKiosk}
                disabled={!createForm.name || !createForm.vendorId || !createForm.location}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Kiosk
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {selectedTab === 'analytics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-gray-500">Total Kiosks</h3>
              <p className="text-2xl font-bold text-purple-600">{kiosks.length}</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-gray-500">Active Kiosks</h3>
              <p className="text-2xl font-bold text-green-600">{kiosks.filter(k => k.isActive).length}</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-gray-500">Total Sales</h3>
              <p className="text-2xl font-bold text-blue-600">
                {formatCurrency(kiosks.reduce((sum, k) => sum + k.totalSales, 0))}
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-gray-500">Total Orders</h3>
              <p className="text-2xl font-bold text-indigo-600">
                {kiosks.reduce((sum, k) => sum + k.totalOrders, 0)}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Kiosk Performance</h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {kiosks.map((kiosk) => (
                  <div key={kiosk.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0">
                    <div>
                      <h4 className="font-medium text-gray-900">{kiosk.name}</h4>
                      <p className="text-sm text-gray-600">{kiosk.location}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-gray-900">{formatCurrency(kiosk.totalSales)}</p>
                      <p className="text-sm text-gray-600">{kiosk.totalOrders} orders</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Kiosk Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Create New Kiosk</h3>
            </div>
            <div className="p-6">
              <p className="text-gray-600 mb-4">
                Use the Create Kiosk tab for the full form, or this quick setup for basic configuration.
              </p>
              <div className="flex justify-between">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowCreateModal(false)
                    setSelectedTab('create')
                  }}
                  className="btn-primary"
                >
                  Go to Create Form
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && selectedKiosk && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Kiosk Settings</h3>
              <p className="text-sm text-gray-600">{selectedKiosk.name}</p>
            </div>
            <div className="p-6">
              <p className="text-gray-600 mb-4">
                Settings management would be implemented here with the same form fields as the create form.
              </p>
              <div className="flex justify-between">
                <button
                  onClick={() => setShowSettingsModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowSettingsModal(false)
                    alert('Settings updated successfully!')
                  }}
                  className="btn-primary"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default KioskManagement