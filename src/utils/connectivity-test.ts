// Simple connectivity test that can be run from browser console

export const testConnectivity = async () => {
  console.log('🔍 Starting connectivity test...')
  
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  
  console.log('Environment check:', {
    url: supabaseUrl,
    hasKey: !!supabaseKey,
    keyPrefix: supabaseKey?.substring(0, 30) + '...'
  })
  
  // Test 1: Simple fetch to Supabase
  try {
    console.log('🔄 Testing basic fetch to Supabase...')
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    })
    
    console.log('✅ Basic fetch successful:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    })
  } catch (error) {
    console.error('❌ Basic fetch failed:', error)
  }
  
  // Test 2: Auth settings
  try {
    console.log('🔄 Testing auth settings...')
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: {
        'apikey': supabaseKey
      }
    })
    
    const data = await response.json()
    console.log('✅ Auth settings fetch successful:', data)
  } catch (error) {
    console.error('❌ Auth settings fetch failed:', error)
  }
  
  // Test 3: Signup test
  try {
    console.log('🔄 Testing signup endpoint...')
    const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'testpass123',
        data: { role: 'customer' }
      })
    })
    
    const data = await response.json()
    console.log('✅ Signup endpoint response:', {
      status: response.status,
      data
    })
  } catch (error) {
    console.error('❌ Signup endpoint failed:', error)
  }
  
  console.log('🔍 Connectivity test complete')
}

// Make it available globally for manual testing
if (typeof window !== 'undefined') {
  (window as any).testConnectivity = testConnectivity
}