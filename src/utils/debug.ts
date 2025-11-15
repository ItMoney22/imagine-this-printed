// Debug utilities for authentication troubleshooting
import { apiFetch } from '../lib/api'

export const testDatabaseConnectivity = async () => {
  console.log('🔍 Testing database connectivity...')

  // Test database connection by checking if we can access the API
  try {
    const data = await apiFetch('/api/health', {
      method: 'GET',
    })

    console.log('✅ Database connection healthy:', { data })
  } catch (error) {
    console.error('❌ Database connectivity test failed:', error)
  }
}

export const logEnvironmentInfo = () => {
  console.log('🔍 Environment Information:', {
    mode: import.meta.env.MODE,
    dev: import.meta.env.DEV,
    prod: import.meta.env.PROD,
    databaseUrl: import.meta.env.DATABASE_URL ? '[CONFIGURED]' : '[NOT CONFIGURED]',
    hasStripeKey: !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY,
    hasOpenAIKey: !!import.meta.env.VITE_OPENAI_API_KEY,
    hasAWSCredentials: !!(import.meta.env.AWS_ACCESS_KEY_ID && import.meta.env.AWS_SECRET_ACCESS_KEY),
    userAgent: navigator.userAgent,
    url: window.location.href
  })
}

// Auto-run diagnostics in development
if (import.meta.env.DEV) {
  logEnvironmentInfo()
  testDatabaseConnectivity()
}

// Make functions available globally for manual testing
if (typeof window !== 'undefined') {
  (window as any).testDatabaseConnectivity = testDatabaseConnectivity;
  (window as any).logEnvironmentInfo = logEnvironmentInfo;
}
