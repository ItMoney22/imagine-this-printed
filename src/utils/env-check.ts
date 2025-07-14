// Environment variable diagnostic utility

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
  
  // Supabase configuration
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  
  console.log('🔧 Supabase Configuration:', {
    url: supabaseUrl,
    urlValid: supabaseUrl && supabaseUrl !== 'https://demo.supabase.co',
    hasKey: !!supabaseKey,
    keyValid: supabaseKey && supabaseKey !== 'demo-key-replace-with-real-key',
    keyPrefix: supabaseKey?.substring(0, 30) + '...',
    keyLength: supabaseKey?.length
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
  if (supabaseUrl && supabaseKey) {
    console.log('🔄 Running network test...')
    
    fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: {
        'apikey': supabaseKey,
        'Content-Type': 'application/json'
      }
    })
    .then(response => response.json())
    .then(data => {
      console.log('✅ Network test successful:', data)
    })
    .catch(error => {
      console.error('❌ Network test failed:', {
        error,
        message: error.message,
        name: error.name,
        stack: error.stack
      })
    })
  } else {
    console.error('❌ Cannot run network test - missing environment variables')
  }
  
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