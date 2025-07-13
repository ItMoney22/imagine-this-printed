import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { costManagementService } from '../utils/cost-management'
import type { CostVariables, ProductCostBreakdown, CostAnalytics } from '../types'

interface ManagerData {
  id: string
  name: string
  email: string
  costVariables: CostVariables | null
  recentBreakdowns: ProductCostBreakdown[]
  analytics: CostAnalytics | null
}

const AdminCostOverride: React.FC = () => {
  const { user } = useAuth()
  const [managers, setManagers] = useState<ManagerData[]>([])
  const [selectedManager, setSelectedManager] = useState<ManagerData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [overrideForm, setOverrideForm] = useState<Partial<CostVariables>>({})
  const [showOverrideModal, setShowOverrideModal] = useState(false)

  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'founder')) {
      loadManagersData()
    }
  }, [user])

  const loadManagersData = async () => {
    try {
      setIsLoading(true)
      
      // Mock manager data - in real app, this would fetch from database
      const mockManagers: ManagerData[] = [
        {
          id: 'manager_1',
          name: 'John Smith',
          email: 'john.smith@company.com',
          costVariables: await costManagementService.getCostVariables('manager_1'),
          recentBreakdowns: await costManagementService.getCostBreakdowns('manager_1'),
          analytics: await costManagementService.getCostAnalytics('manager_1')
        },
        {
          id: 'manager_2',
          name: 'Sarah Johnson',
          email: 'sarah.johnson@company.com',
          costVariables: await costManagementService.getCostVariables('manager_2'),
          recentBreakdowns: await costManagementService.getCostBreakdowns('manager_2'),
          analytics: await costManagementService.getCostAnalytics('manager_2')
        },
        {
          id: 'manager_3',
          name: 'Mike Chen',
          email: 'mike.chen@company.com',
          costVariables: await costManagementService.getCostVariables('manager_3'),
          recentBreakdowns: await costManagementService.getCostBreakdowns('manager_3'),
          analytics: await costManagementService.getCostAnalytics('manager_3')
        }
      ]

      setManagers(mockManagers)
    } catch (error) {
      console.error('Error loading managers data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const openOverrideModal = (manager: ManagerData) => {
    setSelectedManager(manager)
    setOverrideForm(manager.costVariables || {})
    setShowOverrideModal(true)
  }

  const saveOverride = async () => {
    if (!selectedManager) return

    try {
      const updatedVariables: Partial<CostVariables> = {
        ...overrideForm,
        managerId: selectedManager.id,
        lastUpdated: new Date().toISOString()
      }

      await costManagementService.saveCostVariables(updatedVariables)
      
      // Update local state
      setManagers(prev => prev.map(manager => 
        manager.id === selectedManager.id
          ? { ...manager, costVariables: updatedVariables as CostVariables }
          : manager
      ))

      setShowOverrideModal(false)
      alert('Cost variables overridden successfully!')
    } catch (error) {
      console.error('Error saving override:', error)
      alert('Failed to save override')
    }
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
        <h1 className="text-3xl font-bold text-gray-900">Admin Cost Override</h1>
        <p className="text-gray-600">View and override manager cost settings</p>
      </div>

      {/* Managers Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {managers.map((manager) => (
          <div key={manager.id} className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{manager.name}</h3>
                  <p className="text-sm text-gray-600">{manager.email}</p>
                </div>
                <button
                  onClick={() => openOverrideModal(manager)}
                  className="btn-secondary text-sm"
                >
                  Override
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-4">
              {/* Cost Variables Summary */}
              {manager.costVariables ? (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Current Settings</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Filament/gram:</span>
                      <span className="font-medium">${manager.costVariables.filamentPricePerGram.toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Electricity/hour:</span>
                      <span className="font-medium">${manager.costVariables.electricityCostPerHour.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Labor/hour:</span>
                      <span className="font-medium">${manager.costVariables.laborRatePerHour.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Default margin:</span>
                      <span className="font-medium">{manager.costVariables.defaultMarginPercentage}%</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500">No cost variables set</div>
              )}

              {/* Analytics Summary */}
              {manager.analytics && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Analytics</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-center bg-blue-50 p-2 rounded">
                      <p className="text-blue-600 font-medium">{manager.analytics.totalProducts}</p>
                      <p className="text-xs text-blue-500">Products</p>
                    </div>
                    <div className="text-center bg-green-50 p-2 rounded">
                      <p className="text-green-600 font-medium">{manager.analytics.averageMargin.toFixed(1)}%</p>
                      <p className="text-xs text-green-500">Avg Margin</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Recent Activity */}
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Recent Breakdowns</h4>
                <div className="text-sm text-gray-600">
                  {manager.recentBreakdowns.length > 0 ? (
                    <p>{manager.recentBreakdowns.length} recent calculations</p>
                  ) : (
                    <p>No recent activity</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Override Modal */}
      {showOverrideModal && selectedManager && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Override Cost Variables</h3>
                  <p className="text-sm text-gray-600">{selectedManager.name}</p>
                </div>
                <button
                  onClick={() => setShowOverrideModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Filament Price per Gram ($)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={overrideForm.filamentPricePerGram || 0}
                    onChange={(e) => setOverrideForm(prev => ({
                      ...prev,
                      filamentPricePerGram: parseFloat(e.target.value) || 0
                    }))}
                    className="form-input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Electricity Cost per Hour ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={overrideForm.electricityCostPerHour || 0}
                    onChange={(e) => setOverrideForm(prev => ({
                      ...prev,
                      electricityCostPerHour: parseFloat(e.target.value) || 0
                    }))}
                    className="form-input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Labor Rate per Hour ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={overrideForm.laborRatePerHour || 0}
                    onChange={(e) => setOverrideForm(prev => ({
                      ...prev,
                      laborRatePerHour: parseFloat(e.target.value) || 0
                    }))}
                    className="form-input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Default Margin Percentage (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={overrideForm.defaultMarginPercentage || 0}
                    onChange={(e) => setOverrideForm(prev => ({
                      ...prev,
                      defaultMarginPercentage: parseFloat(e.target.value) || 0
                    }))}
                    className="form-input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Overhead Percentage (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={overrideForm.overheadPercentage || 0}
                    onChange={(e) => setOverrideForm(prev => ({
                      ...prev,
                      overheadPercentage: parseFloat(e.target.value) || 0
                    }))}
                    className="form-input w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Average Packaging Cost ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={overrideForm.averagePackagingCost || 0}
                    onChange={(e) => setOverrideForm(prev => ({
                      ...prev,
                      averagePackagingCost: parseFloat(e.target.value) || 0
                    }))}
                    className="form-input w-full"
                  />
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                <div className="flex">
                  <svg className="w-5 h-5 text-yellow-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-medium text-yellow-800">Admin Override Warning</h4>
                    <p className="text-sm text-yellow-700 mt-1">
                      This will override the manager's cost settings. The manager will be notified of this change.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <button
                onClick={() => setShowOverrideModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={saveOverride}
                className="btn-primary"
              >
                Save Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminCostOverride