import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
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
      <div className="min-h-screen bg-bg text-text py-8 flex items-center justify-center">
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 max-w-md text-center backdrop-blur-md shadow-[0_0_30px_rgba(239,68,68,0.2)]">
          <div className="text-5xl mb-4">🚫</div>
          <h2 className="text-2xl font-bold text-red-400 mb-2">Access Denied</h2>
          <p className="text-muted">You do not have permission to view this page.</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg text-text py-8 flex items-center justify-center">
        <div className="relative w-24 h-24">
          <div className="absolute inset-0 border-4 border-white/10 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-t-primary rounded-full animate-spin shadow-[0_0_15px_rgba(168,85,247,0.5)]"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-text py-8 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[128px] animate-pulse-slow"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/20 rounded-full blur-[128px] animate-pulse-slow delay-1000"></div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="mb-10">
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-400 to-secondary drop-shadow-[0_0_15px_rgba(168,85,247,0.5)] mb-3">
            Admin Cost Override
          </h1>
          <p className="text-muted text-lg">View and override manager cost settings across the organization</p>
        </div>

        {/* Managers Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {managers.map((manager) => (
            <div key={manager.id} className="group bg-card/30 backdrop-blur-md rounded-3xl p-1 border border-white/10 shadow-xl hover:shadow-2xl hover:shadow-primary/10 transition-all duration-300 hover:-translate-y-1">
              <div className="bg-bg/40 rounded-[22px] p-6 h-full flex flex-col">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-text group-hover:text-primary transition-colors">{manager.name}</h3>
                    <p className="text-sm text-muted">{manager.email}</p>
                  </div>
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center border border-white/10 shadow-inner">
                    <span className="text-lg">👤</span>
                  </div>
                </div>

                <div className="flex-grow space-y-6">
                  {/* Cost Variables Summary */}
                  <div className="bg-bg/50 rounded-xl p-4 border border-white/5">
                    <h4 className="font-bold text-text mb-3 text-sm uppercase tracking-wider text-primary/80">Current Settings</h4>
                    {manager.costVariables ? (
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-muted">Filament/gram</span>
                          <span className="font-mono font-medium text-text bg-white/5 px-2 py-0.5 rounded">${manager.costVariables.filamentPricePerGram.toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted">Electricity/hour</span>
                          <span className="font-mono font-medium text-text bg-white/5 px-2 py-0.5 rounded">${manager.costVariables.electricityCostPerHour.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted">Labor/hour</span>
                          <span className="font-mono font-medium text-text bg-white/5 px-2 py-0.5 rounded">${manager.costVariables.laborRatePerHour.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted">Default margin</span>
                          <span className="font-mono font-medium text-green-400 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">{manager.costVariables.defaultMarginPercentage}%</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted italic text-center py-2">No cost variables set</div>
                    )}
                  </div>

                  {/* Analytics Summary */}
                  {manager.analytics && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-blue-400 mb-1">{manager.analytics.totalProducts}</p>
                        <p className="text-xs text-blue-300/70 uppercase font-bold tracking-wider">Products</p>
                      </div>
                      <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-green-400 mb-1">{manager.analytics.averageMargin.toFixed(1)}%</p>
                        <p className="text-xs text-green-300/70 uppercase font-bold tracking-wider">Avg Margin</p>
                      </div>
                    </div>
                  )}

                  {/* Recent Activity */}
                  <div className="flex items-center justify-between text-xs text-muted px-2">
                    <span>Recent Activity</span>
                    <span className="flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-2 ${manager.recentBreakdowns.length > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
                      {manager.recentBreakdowns.length > 0 ? `${manager.recentBreakdowns.length} calculations` : 'None'}
                    </span>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-white/10">
                  <button
                    onClick={() => openOverrideModal(manager)}
                    className="w-full group/btn relative overflow-hidden rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-3 transition-all duration-300 hover:shadow-lg hover:shadow-primary/20 hover:border-primary/50"
                  >
                    <div className="relative z-10 flex items-center justify-center space-x-2">
                      <span className="font-bold text-text group-hover/btn:text-primary transition-colors">Override Settings</span>
                      <svg className="w-4 h-4 text-muted group-hover/btn:text-primary transition-colors group-hover/btn:translate-x-1 transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Override Modal */}
        {showOverrideModal && selectedManager && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowOverrideModal(false)}></div>
            <div className="relative bg-card/90 backdrop-blur-xl rounded-3xl max-w-2xl w-full border border-white/10 shadow-2xl overflow-hidden ring-1 ring-white/10 animate-in fade-in zoom-in duration-200">

              {/* Modal Header */}
              <div className="px-8 py-6 border-b border-white/10 bg-white/5 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-text">Override Cost Variables</h3>
                  <p className="text-muted text-sm mt-1">Editing settings for <span className="text-primary font-semibold">{selectedManager.name}</span></p>
                </div>
                <button
                  onClick={() => setShowOverrideModal(false)}
                  className="p-2 rounded-full hover:bg-white/10 text-muted hover:text-text transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-muted">
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
                      className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-muted">
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
                      className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-muted">
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
                      className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-muted">
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
                      className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-muted">
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
                      className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-muted">
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
                      className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                    />
                  </div>
                </div>

                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-5 flex items-start space-x-4">
                  <div className="p-2 bg-yellow-500/20 rounded-lg">
                    <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-yellow-400 mb-1">Admin Override Warning</h4>
                    <p className="text-sm text-yellow-200/80 leading-relaxed">
                      This will override the manager's cost settings. The manager will be notified of this change. Please ensure these values are accurate.
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-8 py-6 border-t border-white/10 bg-white/5 flex items-center justify-end space-x-4">
                <button
                  onClick={() => setShowOverrideModal(false)}
                  className="px-6 py-3 rounded-xl font-bold text-muted hover:text-text hover:bg-white/5 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={saveOverride}
                  className="px-8 py-3 rounded-xl bg-gradient-to-r from-primary to-purple-600 hover:from-purple-500 hover:to-primary text-white font-bold shadow-lg hover:shadow-primary/50 hover:scale-105 transition-all duration-300"
                >
                  Save Override
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminCostOverride
