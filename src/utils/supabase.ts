import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://demo.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'demo-key-replace-with-real-key'

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey)