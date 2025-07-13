import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://demo.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'demo-key-replace-with-real-key'

// Create a mock client if no real credentials are provided
export const supabase = (supabaseUrl === 'https://demo.supabase.co' || supabaseUrl === 'your_supabase_url_here') 
  ? null 
  : createClient(supabaseUrl, supabaseAnonKey)