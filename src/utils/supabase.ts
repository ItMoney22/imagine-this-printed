import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://demo.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'demo-key-replace-with-real-key'

// Debug logging for configuration
console.log('🔧 Supabase Configuration:', {
  url: supabaseUrl,
  hasAnonKey: !!supabaseAnonKey,
  keyPrefix: supabaseAnonKey?.substring(0, 20) + '...',
  environment: import.meta.env.MODE,
  prod: import.meta.env.PROD,
  dev: import.meta.env.DEV,
  allEnvVars: Object.keys(import.meta.env).filter(key => key.startsWith('VITE_'))
})

// Validate configuration
if (supabaseUrl === 'https://demo.supabase.co') {
  console.error('❌ CRITICAL: Using demo Supabase URL - authentication will not work')
  alert('Environment Error: Demo Supabase URL detected. Check Vercel environment variables.')
}

if (supabaseAnonKey === 'demo-key-replace-with-real-key') {
  console.error('❌ CRITICAL: Using demo anon key - authentication will not work')
  alert('Environment Error: Demo anon key detected. Check Vercel environment variables.')
}

// Test if we can reach the URL
console.log('🔄 Testing Supabase URL accessibility...')
fetch(`${supabaseUrl}/rest/v1/`, {
  method: 'HEAD',
  headers: { 'apikey': supabaseAnonKey }
}).then(response => {
  console.log('✅ Supabase URL is accessible:', {
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries())
  })
}).catch(error => {
  console.error('❌ CRITICAL: Cannot reach Supabase URL:', {
    error,
    url: supabaseUrl,
    message: error.message
  })
})

// Create Supabase client with debug options
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    debug: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})

// Log successful client creation
console.log('✅ Supabase client created successfully')