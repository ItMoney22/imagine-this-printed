// Debug utilities for authentication troubleshooting

export const testSupabaseConnectivity = async () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  
  console.log('🔍 Testing Supabase connectivity...')
  
  // Test 1: Basic URL accessibility
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'GET',
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`
      }
    })
    
    console.log('✅ Supabase REST API accessible:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    })
  } catch (error) {
    console.error('❌ Supabase REST API not accessible:', error)
  }
  
  // Test 2: Auth endpoint accessibility
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      method: 'GET',
      headers: {
        'apikey': supabaseAnonKey
      }
    })
    
    const data = await response.json()
    console.log('✅ Supabase Auth settings accessible:', {
      status: response.status,
      data
    })
  } catch (error) {
    console.error('❌ Supabase Auth settings not accessible:', error)
  }
}

export const logEnvironmentInfo = () => {
  console.log('🔍 Environment Information:', {
    mode: import.meta.env.MODE,
    dev: import.meta.env.DEV,
    prod: import.meta.env.PROD,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    hasSupabaseKey: !!import.meta.env.VITE_SUPABASE_ANON_KEY,
    keyPrefix: import.meta.env.VITE_SUPABASE_ANON_KEY?.substring(0, 20),
    userAgent: navigator.userAgent,
    url: window.location.href
  })
}

// Auto-run diagnostics in development
if (import.meta.env.DEV) {
  logEnvironmentInfo()
  testSupabaseConnectivity()
}