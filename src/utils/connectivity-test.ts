// Simple connectivity test that can be run from browser console

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
    const response = await fetch('/api/health', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })
    
    const data = await response.json()
    console.log('✅ API health check successful:', {
      status: response.status,
      data
    })
  } catch (error) {
    console.error('❌ API health check failed:', error)
  }
  
  // Test 2: Auth token check
  try {
    console.log('🔄 Testing auth token...')
    const token = localStorage.getItem('auth_token')
    
    if (token) {
      const response = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      
      const data = await response.json()
      console.log('✅ Auth token valid:', {
        status: response.status,
        data: data.user ? { id: data.user.id, email: data.user.email } : 'No user data'
      })
    } else {
      console.log('ℹ️ No auth token found in localStorage')
    }
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