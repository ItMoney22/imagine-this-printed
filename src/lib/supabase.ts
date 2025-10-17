import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY!;

// Environment sanity check (log on boot, mask secrets)
console.log('[env:frontend]', {
  VITE_SUPABASE_URL: supabaseUrl,
  VITE_SUPABASE_ANON_KEY_tail: supabaseAnonKey ? `...${supabaseAnonKey.slice(-8)}` : 'missing',
  VITE_SITE_URL: import.meta.env.VITE_SITE_URL,
  VITE_API_BASE: import.meta.env.VITE_API_BASE,
  VITE_STRIPE_PUBLISHABLE_KEY_tail: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
    ? `...${import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY.slice(-8)}`
    : 'missing',
});

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[supabase] ❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
  throw new Error("Supabase environment variables are required");
}

console.log("[supabase] 🔧 Initializing Supabase client with URL:", supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // we handle URL explicitly in AuthCallback
    storageKey: 'itp-auth-v1', // unique per environment
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});

console.log("[supabase] ✅ Supabase client initialized");

// Optional: expose for console debugging (safe; anon key is public)
if (typeof window !== "undefined") {
  // @ts-ignore
  window.supabase = supabase;
}
