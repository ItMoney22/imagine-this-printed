// Simple connectivity test that can be run from browser console
import { apiFetch } from '../lib/api'

export const testConnectivity = async () => {
  console.log('🔍 Starting connectivity test...')
  
  const databaseUrl = import.meta.env.DATABASE_URL
  const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  const openaiKey = import.meta.env.VITE_OPENAI_API_KEY
  
  console.log('Environment check:', {
    databaseUrl: databaseUrl ? '[CONFIGURED]' : '[NOT CONFIGURED]',
    hasStripeKey: !!stripeKey,
    hasOpenAIKey: !!openaiKey,
    hasAWSCredentials: !!(import.meta.env.AWS_ACCESS_KEY_ID && import.meta.env.AWS_SECRET_ACCESS_KEY)
  })
  
  // Test 1: API Health Check
  try {
    console.log('🔄 Testing API health check...')
    const data = await apiFetch('/api/health')
    console.log('✅ API health check successful:', data)
  } catch (error) {
    console.error('❌ API health check failed:', error)
  }
  
  // Test 2: Auth token check
  try {
    console.log('🔄 Testing auth token...')
    const data = await apiFetch('/api/users/me')
    console.log('✅ Auth token valid:', {
      data: data.user ? { id: data.user.id, email: data.user.email } : 'No user data'
    })
  } catch (error) {
    console.error('❌ Auth token test failed:', error)
  }
  
  // Test 3: Storage test
  try {
    console.log('🔄 Testing storage configuration...')
    const s3Bucket = import.meta.env.S3_BUCKET_NAME
    const cloudFrontUrl = import.meta.env.CLOUDFRONT_URL
    
    console.log('✅ Storage configuration:', {
      s3Bucket: s3Bucket || 'imagine-this-printed',
      cloudFrontUrl: cloudFrontUrl || 'Not configured',
      hasAWSCredentials: !!(import.meta.env.AWS_ACCESS_KEY_ID && import.meta.env.AWS_SECRET_ACCESS_KEY)
    })
  } catch (error) {
    console.error('❌ Storage test failed:', error)
  }
  
  console.log('🔍 Connectivity test complete')
}

// Make it available globally for manual testing
if (typeof window !== 'undefined') {
  (window as any).testConnectivity = testConnectivity
}
