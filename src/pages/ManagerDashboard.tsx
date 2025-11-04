import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { costManagementService } from '../utils/cost-management'
import type { CostVariables, ProductCostBreakdown, GPTCostQuery, CostAnalytics } from '../types'

const ManagerDashboard: React.FC = () => {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'variables' | 'calculator' | 'assistant' | 'analytics'>('variables')
  const [isLoading, setIsLoading] = useState(true)
  const [costVariables, setCostVariables] = useState<CostVariables | null>(null)
  const [costBreakdown, setCostBreakdown] = useState<ProductCostBreakdown | null>(null)
  const [analytics, setAnalytics] = useState<CostAnalytics | null>(null)

  // Cost Variables State
  const [variablesForm, setVariablesForm] = useState({
    filamentPricePerGram: 0.025,
    electricityCostPerHour: 0.12,
    averagePackagingCost: 2.50,
    monthlyRent: 3500,
    overheadPercentage: 15,
    defaultMarginPercentage: 25,
    laborRatePerHour: 25.00
  })

  // Cost Calculator State
  const [calculatorForm, setCalculatorForm] = useState({
    printTimeHours: 0,
    materialUsageGrams: 0,
    customLaborHours: 0
  })

  // GPT Assistant State
  const [chatQuery, setChatQuery] = useState('')
  const [chatHistory, setChatHistory] = useState<Array<{ query: string; response: string; timestamp: string }>>([])
  const [isQueryLoading, setIsQueryLoading] = useState(false)

  useEffect(() => {
    if (user && (user.role === 'manager' || user.role === 'admin' || user.role === 'founder')) {
      loadData()
    }
  }, [user])

  const loadData = async () => {
    try {
      setIsLoading(true)
      const [variables, _breakdowns, analyticsData] = await Promise.all([
        costManagementService.getCostVariables(user?.id || ''),
        costManagementService.getCostBreakdowns(user?.id || ''),
        costManagementService.getCostAnalytics(user?.id || '')
      ])

      if (variables) {
        setCostVariables(variables)
        setVariablesForm({
          filamentPricePerGram: variables.filamentPricePerGram,
          electricityCostPerHour: variables.electricityCostPerHour,
          averagePackagingCost: variables.averagePackagingCost,
          monthlyRent: variables.monthlyRent,
          overheadPercentage: variables.overheadPercentage,
          defaultMarginPercentage: variables.defaultMarginPercentage,
          laborRatePerHour: variables.laborRatePerHour
        })
      }

      setAnalytics(analyticsData)
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const saveCostVariables = async () => {
    try {
      const updatedVariables: Partial<CostVariables> = {
        managerId: user?.id || '',
        ...variablesForm,
        lastUpdated: new Date().toISOString()
      }

      const saved = await costManagementService.saveCostVariables(updatedVariables)
      setCostVariables(saved)
      alert('Cost variables saved successfully!')
    } catch (error) {
      console.error('Error saving cost variables:', error)
      alert('Failed to save cost variables')
    }
  }

  const calculateCost = () => {
    if (!costVariables) return

    const breakdown = costManagementService.calculateProductCost(
      costVariables,
      calculatorForm.printTimeHours,
      calculatorForm.materialUsageGrams,
      calculatorForm.customLaborHours || undefined
    )

    setCostBreakdown(breakdown)
  }

  const submitChatQuery = async () => {
    if (!chatQuery.trim()) return

    try {
      setIsQueryLoading(true)
      const response = await costManagementService.queryGPTAssistant(
        chatQuery,
        costVariables || undefined,
        { breakdown: costBreakdown }
      )

      const newEntry = {
        query: chatQuery,
        response,
        timestamp: new Date().toISOString()
      }

      setChatHistory(prev => [...prev, newEntry])
      setChatQuery('')

      // Save query for history
      const gptQuery: GPTCostQuery = {
        id: `query_${Date.now()}`,
        userId: user?.id || '',
        query: chatQuery,
        response,
        context: { costVariables: costVariables || undefined },
        timestamp: new Date().toISOString()
      }
      await costManagementService.saveGPTQuery(gptQuery)
    } catch (error) {
      console.error('Error submitting query:', error)
      alert('Failed to process query')
    } finally {
      setIsQueryLoading(false)
    }
  }

  if (!user || (user.role !== 'manager' && user.role !== 'admin' && user.role !== 'founder')) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. Manager access required.</p>
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
        <h1 className="text-3xl font-bold text-text">Manager Dashboard</h1>
        <p className="text-muted">Cost Controls & AI Assistant</p>
      </div>

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'variables', label: 'Cost Variables', icon: '💰' },
            { id: 'calculator', label: 'Cost Calculator', icon: '🧮' },
            { id: 'assistant', label: 'AI Assistant', icon: '🤖' },
            { id: 'analytics', label: 'Analytics', icon: '📊' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                activeTab === tab.id
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

      {/* Cost Variables Tab */}
      {activeTab === 'variables' && (
        <div className="bg-card rounded-lg shadow">
          <div className="px-6 py-4 border-b card-border">
            <h3 className="text-lg font-medium text-text">Cost Input System</h3>
            <p className="text-sm text-muted">Configure your pricing variables</p>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Filament Price per Gram ($)
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={variablesForm.filamentPricePerGram}
                  onChange={(e) => setVariablesForm(prev => ({
                    ...prev,
                    filamentPricePerGram: parseFloat(e.target.value) || 0
                  }))}
                  className="form-input w-full"
                  placeholder="0.025"
                />
                <p className="text-xs text-muted mt-1">Cost of filament material per gram</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Electricity Cost per Hour ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={variablesForm.electricityCostPerHour}
                  onChange={(e) => setVariablesForm(prev => ({
                    ...prev,
                    electricityCostPerHour: parseFloat(e.target.value) || 0
                  }))}
                  className="form-input w-full"
                  placeholder="0.12"
                />
                <p className="text-xs text-muted mt-1">Printer electricity usage cost per hour</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Average Packaging Cost ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={variablesForm.averagePackagingCost}
                  onChange={(e) => setVariablesForm(prev => ({
                    ...prev,
                    averagePackagingCost: parseFloat(e.target.value) || 0
                  }))}
                  className="form-input w-full"
                  placeholder="2.50"
                />
                <p className="text-xs text-muted mt-1">Cost of packaging materials per order</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Monthly Rent/Location ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={variablesForm.monthlyRent}
                  onChange={(e) => setVariablesForm(prev => ({
                    ...prev,
                    monthlyRent: parseFloat(e.target.value) || 0
                  }))}
                  className="form-input w-full"
                  placeholder="3500"
                />
                <p className="text-xs text-muted mt-1">Monthly facility/workspace cost</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Overhead Percentage (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={variablesForm.overheadPercentage}
                  onChange={(e) => setVariablesForm(prev => ({
                    ...prev,
                    overheadPercentage: parseFloat(e.target.value) || 0
                  }))}
                  className="form-input w-full"
                  placeholder="15"
                />
                <p className="text-xs text-muted mt-1">Additional overhead costs as percentage</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Default Margin Percentage (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={variablesForm.defaultMarginPercentage}
                  onChange={(e) => setVariablesForm(prev => ({
                    ...prev,
                    defaultMarginPercentage: parseFloat(e.target.value) || 0
                  }))}
                  className="form-input w-full"
                  placeholder="25"
                />
                <p className="text-xs text-muted mt-1">Default profit margin for pricing</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Labor Rate per Hour ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={variablesForm.laborRatePerHour}
                  onChange={(e) => setVariablesForm(prev => ({
                    ...prev,
                    laborRatePerHour: parseFloat(e.target.value) || 0
                  }))}
                  className="form-input w-full"
                  placeholder="25.00"
                />
                <p className="text-xs text-muted mt-1">Cost of labor per hour</p>
              </div>
            </div>

            <div className="pt-4 border-t card-border">
              <button
                onClick={saveCostVariables}
                className="btn-primary"
              >
                Save Cost Variables
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cost Calculator Tab */}
      {activeTab === 'calculator' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Product Cost Builder</h3>
              <p className="text-sm text-muted">Calculate detailed cost breakdown for products</p>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Print Time (Hours)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={calculatorForm.printTimeHours}
                    onChange={(e) => setCalculatorForm(prev => ({
                      ...prev,
                      printTimeHours: parseFloat(e.target.value) || 0
                    }))}
                    className="form-input w-full"
                    placeholder="3.5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Material Usage (Grams)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={calculatorForm.materialUsageGrams}
                    onChange={(e) => setCalculatorForm(prev => ({
                      ...prev,
                      materialUsageGrams: parseFloat(e.target.value) || 0
                    }))}
                    className="form-input w-full"
                    placeholder="85"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Custom Labor Hours (Optional)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={calculatorForm.customLaborHours}
                    onChange={(e) => setCalculatorForm(prev => ({
                      ...prev,
                      customLaborHours: parseFloat(e.target.value) || 0
                    }))}
                    className="form-input w-full"
                    placeholder="0"
                  />
                </div>
              </div>

              <button
                onClick={calculateCost}
                disabled={!costVariables || calculatorForm.printTimeHours <= 0 || calculatorForm.materialUsageGrams <= 0}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Calculate Cost Breakdown
              </button>
            </div>
          </div>

          {/* Cost Breakdown Display */}
          {costBreakdown && (
            <div className="bg-card rounded-lg shadow">
              <div className="px-6 py-4 border-b card-border">
                <h3 className="text-lg font-medium text-text">Cost Breakdown Results</h3>
              </div>
              
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <p className="text-sm text-blue-600 font-medium">Material Cost</p>
                    <p className="text-2xl font-bold text-blue-800">
                      ${costBreakdown.materialCost.toFixed(2)}
                    </p>
                  </div>
                  
                  <div className="bg-yellow-50 p-4 rounded-lg">
                    <p className="text-sm text-yellow-600 font-medium">Electricity Cost</p>
                    <p className="text-2xl font-bold text-yellow-800">
                      ${costBreakdown.electricityCost.toFixed(2)}
                    </p>
                  </div>
                  
                  <div className="bg-green-50 p-4 rounded-lg">
                    <p className="text-sm text-green-600 font-medium">Labor Cost</p>
                    <p className="text-2xl font-bold text-green-800">
                      ${costBreakdown.laborCost.toFixed(2)}
                    </p>
                  </div>
                  
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <p className="text-sm text-purple-600 font-medium">Packaging Cost</p>
                    <p className="text-2xl font-bold text-purple-800">
                      ${costBreakdown.packagingCost.toFixed(2)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-card p-4 rounded-lg">
                    <p className="text-sm text-muted font-medium">Overhead ({costVariables?.overheadPercentage}%)</p>
                    <p className="text-xl font-bold text-gray-800">
                      ${costBreakdown.overheadCost.toFixed(2)}
                    </p>
                  </div>
                  
                  <div className="bg-red-50 p-4 rounded-lg">
                    <p className="text-sm text-red-600 font-medium">Total Cost</p>
                    <p className="text-xl font-bold text-red-800">
                      ${costBreakdown.totalCost.toFixed(2)}
                    </p>
                  </div>
                  
                  <div className="bg-indigo-50 p-4 rounded-lg">
                    <p className="text-sm text-indigo-600 font-medium">Suggested Price ({costBreakdown.suggestedMargin}% margin)</p>
                    <p className="text-xl font-bold text-indigo-800">
                      ${costBreakdown.suggestedPrice.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Assistant Tab */}
      {activeTab === 'assistant' && (
        <div className="bg-card rounded-lg shadow">
          <div className="px-6 py-4 border-b card-border">
            <h3 className="text-lg font-medium text-text">GPT Cost Assistant</h3>
            <p className="text-sm text-muted">Ask questions about pricing and cost strategy</p>
          </div>
          
          <div className="p-6">
            {/* Chat History */}
            <div className="mb-6 space-y-4 max-h-96 overflow-y-auto">
              {chatHistory.length === 0 ? (
                <div className="text-center py-8 text-muted">
                  <div className="text-4xl mb-2">🤖</div>
                  <p>Ask me anything about cost calculations and pricing strategy!</p>
                  <div className="mt-4 text-sm">
                    <p className="font-medium mb-2">Example questions:</p>
                    <ul className="space-y-1 text-left max-w-md mx-auto">
                      <li>• "What should I price a product that costs $15 with 30% margin?"</li>
                      <li>• "Calculate cost for 2.5h print with 60g filament"</li>
                      <li>• "What margins do you recommend for premium products?"</li>
                    </ul>
                  </div>
                </div>
              ) : (
                chatHistory.map((entry, index) => (
                  <div key={index} className="space-y-3">
                    <div className="flex justify-end">
                      <div className="bg-purple-600 text-white p-3 rounded-lg max-w-2xl">
                        <p>{entry.query}</p>
                      </div>
                    </div>
                    <div className="flex justify-start">
                      <div className="bg-card p-3 rounded-lg max-w-2xl">
                        <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ 
                          __html: entry.response.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>') 
                        }} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Chat Input */}
            <div className="flex space-x-4">
              <input
                type="text"
                value={chatQuery}
                onChange={(e) => setChatQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && submitChatQuery()}
                className="form-input flex-1"
                placeholder="Ask about costs, pricing, margins..."
                disabled={isQueryLoading}
              />
              <button
                onClick={submitChatQuery}
                disabled={!chatQuery.trim() || isQueryLoading}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isQueryLoading ? 'Thinking...' : 'Ask'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && analytics && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Cost Analytics Dashboard</h3>
              <p className="text-sm text-muted">{analytics.period}</p>
            </div>
            
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-blue-600 font-medium">Total Products</p>
                  <p className="text-2xl font-bold text-blue-800">{analytics.totalProducts}</p>
                </div>
                
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm text-green-600 font-medium">Average Cost</p>
                  <p className="text-2xl font-bold text-green-800">${analytics.averageCost.toFixed(2)}</p>
                </div>
                
                <div className="bg-purple-50 p-4 rounded-lg">
                  <p className="text-sm text-purple-600 font-medium">Average Margin</p>
                  <p className="text-2xl font-bold text-purple-800">{analytics.averageMargin.toFixed(1)}%</p>
                </div>
                
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <p className="text-sm text-yellow-600 font-medium">Profitable Products</p>
                  <p className="text-2xl font-bold text-yellow-800">{analytics.profitableProducts}</p>
                </div>
              </div>

              {/* Low Margin Products */}
              {analytics.lowMarginProducts.length > 0 && (
                <div className="mb-8">
                  <h4 className="text-lg font-medium text-text mb-4">Products Needing Attention</h4>
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                    <div className="space-y-3">
                      {analytics.lowMarginProducts.map((product, index) => (
                        <div key={index} className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-text">{product.productName}</p>
                            <p className="text-sm text-muted">Current margin: {product.currentMargin.toFixed(1)}%</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-orange-600">Suggested: {product.suggestedMargin.toFixed(1)}%</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Cost Trends */}
              <div>
                <h4 className="text-lg font-medium text-text mb-4">Recent Cost Trends</h4>
                <div className="bg-card rounded-lg p-4">
                  <div className="space-y-2">
                    {analytics.costTrends.map((trend, index) => (
                      <div key={index} className="flex items-center justify-between">
                        <p className="text-sm text-muted">{new Date(trend.date).toLocaleDateString()}</p>
                        <div className="flex space-x-4">
                          <span className="text-sm">Cost: ${trend.averageCost.toFixed(2)}</span>
                          <span className="text-sm">Margin: {trend.averageMargin.toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ManagerDashboard