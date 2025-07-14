import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://demo.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'demo-key-replace-with-real-key'

// Debug logging for configuration
console.log('🔧 Supabase Configuration:', {
  url: supabaseUrl,
  hasAnonKey: !!supabaseAnonKey,
  keyPrefix: supabaseAnonKey?.substring(0, 20) + '...',
  environment: import.meta.env.MODE
})

// Validate configuration
if (supabaseUrl === 'https://demo.supabase.co') {
  console.error('❌ Using demo Supabase URL - authentication will not work')
}

if (supabaseAnonKey === 'demo-key-replace-with-real-key') {
  console.error('❌ Using demo anon key - authentication will not work')
}

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