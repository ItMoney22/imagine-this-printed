import React, { useState, useEffect } from 'react'
import { systemValidator, type ValidationResult } from '../utils/system-validation'

const SystemStatusWidget: React.FC = () => {
  const [results, setResults] = useState<ValidationResult[]>([])
  const [loading, setLoading] = useState(false)
  const [lastCheck, setLastCheck] = useState<Date | null>(null)

  const runValidation = async () => {
    setLoading(true)
    try {
      const validationResults = await systemValidator.validateAll()
      setResults(validationResults)
      setLastCheck(new Date())
    } catch (error) {
      console.error('System validation failed:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    runValidation()
  }, [])

  const getStatusIcon = (status: ValidationResult['status']) => {
    switch (status) {
      case 'success': return '✅'
      case 'warning': return '⚠️'
      case 'error': return '❌'
      default: return '❓'
    }
  }

  const getStatusColor = (status: ValidationResult['status']) => {
    switch (status) {
      case 'success': return 'text-green-600'
      case 'warning': return 'text-yellow-600'
      case 'error': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const systemStatus = results.length > 0 ? systemValidator.getSystemStatus(results) : 'unknown'

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold">System Status</h3>
        <div className="flex items-center space-x-2">
          <span className={`px-2 py-1 rounded text-sm font-medium ${
            systemStatus === 'healthy' ? 'bg-green-100 text-green-800' :
            systemStatus === 'degraded' ? 'bg-yellow-100 text-yellow-800' :
            systemStatus === 'critical' ? 'bg-red-100 text-red-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {systemStatus.toUpperCase()}
          </span>
          <button
            onClick={runValidation}
            disabled={loading}
            className="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600 disabled:bg-gray-300"
          >
            {loading ? 'Checking...' : 'Refresh'}
          </button>
        </div>
      </div>

      {lastCheck && (
        <p className="text-sm text-gray-500 mb-4">
          Last checked: {lastCheck.toLocaleString()}
        </p>
      )}

      <div className="space-y-3">
        {results.map((result, index) => (
          <div key={index} className="flex items-center justify-between p-3 border rounded">
            <div className="flex items-center space-x-3">
              <span className="text-lg">{getStatusIcon(result.status)}</span>
              <div>
                <span className="font-medium">{result.service}</span>
                <p className={`text-sm ${getStatusColor(result.status)}`}>
                  {result.message}
                </p>
              </div>
            </div>
            
            {result.details && (
              <div className="text-xs text-gray-500 max-w-xs">
                <pre className="whitespace-pre-wrap">
                  {typeof result.details === 'string' 
                    ? result.details 
                    : JSON.stringify(result.details, null, 2)
                  }
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>

      {results.length === 0 && !loading && (
        <p className="text-gray-500 text-center py-4">
          Click "Refresh" to run system validation
        </p>
      )}

      {loading && (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
        </div>
      )}

      <div className="mt-4 p-3 bg-gray-50 rounded text-sm">
        <h4 className="font-medium mb-2">Service Overview:</h4>
        <ul className="space-y-1 text-gray-600">
          <li>• <strong>PostgreSQL:</strong> Database with Prisma ORM</li>
          <li>• <strong>Auth:</strong> User authentication status</li>
          <li>• <strong>Stripe:</strong> Payment processing (Live mode active)</li>
          <li>• <strong>OpenAI:</strong> Chatbot and AI features</li>
          <li>• <strong>AWS S3:</strong> File storage and CDN</li>
          <li>• <strong>Storage:</strong> AWS S3 with CloudFront CDN</li>
        </ul>
      </div>
    </div>
  )
}

export default SystemStatusWidget