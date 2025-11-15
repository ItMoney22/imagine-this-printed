// Environment variable diagnostic utility
import { apiFetch } from '../lib/api'

export const checkEnvironment = () => {
  console.log('🔍 ENVIRONMENT DIAGNOSTIC REPORT')
  console.log('================================')
  
  // Basic environment info
  console.log('📍 Runtime Environment:', {
    mode: import.meta.env.MODE,
    dev: import.meta.env.DEV,
    prod: import.meta.env.PROD,
    ssr: import.meta.env.SSR,
    base: import.meta.env.BASE_URL
  })
  
  // Database configuration
  const databaseUrl = import.meta.env.DATABASE_URL
  const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  const openaiKey = import.meta.env.VITE_OPENAI_API_KEY
  
  console.log('🔧 Service Configuration:', {
    databaseUrl: databaseUrl ? '[CONFIGURED]' : '[NOT CONFIGURED]',
    hasStripeKey: !!stripeKey,
    stripeMode: stripeKey?.startsWith('pk_live_') ? 'LIVE' : stripeKey?.startsWith('pk_test_') ? 'TEST' : 'UNKNOWN',
    hasOpenAIKey: !!openaiKey,
    hasAWSCredentials: !!(import.meta.env.AWS_ACCESS_KEY_ID && import.meta.env.AWS_SECRET_ACCESS_KEY)
  })
  
  // All VITE environment variables
  const viteVars = Object.keys(import.meta.env)
    .filter(key => key.startsWith('VITE_'))
    .reduce((acc, key) => {
      acc[key] = import.meta.env[key]?.substring(0, 50) + '...'
      return acc
    }, {} as Record<string, string>)
  
  console.log('🔑 Environment Variables:', viteVars)
  
  // Location info
  console.log('🌐 Browser Location:', {
    origin: window.location.origin,
    hostname: window.location.hostname,
    protocol: window.location.protocol,
    port: window.location.port,
    href: window.location.href
  })
  
  // Network test
  console.log('🔄 Running API health check...')

  apiFetch('/api/health')
    .then(data => {
      console.log('✅ API health check successful:', data)
    })
    .catch(error => {
      console.error('❌ API health check failed:', {
        error,
        message: error.message,
        name: error.name,
        stack: error.stack
      })
    })
  
  console.log('================================')
}

// Make available globally
if (typeof window !== 'undefined') {
  (window as any).checkEnvironment = checkEnvironment
  
  // Auto-run in production to help debug
  if (import.meta.env.PROD) {
    console.log('🚀 Production environment detected - running automatic diagnostic...')
    setTimeout(checkEnvironment, 1000)
  }
}
