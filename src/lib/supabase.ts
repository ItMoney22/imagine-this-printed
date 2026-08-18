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

// Generate unified storage key from project URL to ensure consistency
const PROJECT_REF_HOST = new URL(supabaseUrl).host;
export const STORAGE_KEY = `sb-${PROJECT_REF_HOST}-auth-token`; // Export for use in auth handlers

console.log("[supabase] 🔑 Using storage key:", STORAGE_KEY);

// Clean up any legacy keys with a different prefix to prevent PKCE mismatch
if (typeof window !== "undefined") {
  try {
    const keys = Object.keys(localStorage);
    const legacyKeys = keys.filter(k => k.startsWith('sb-') && !k.startsWith(STORAGE_KEY));

    if (legacyKeys.length > 0) {
      console.log("[supabase] 🧹 Cleaning up legacy storage keys:", legacyKeys);
      legacyKeys.forEach(k => localStorage.removeItem(k));
    }
  } catch (err) {
    console.warn("[supabase] ⚠️ Could not clean up legacy keys:", err);
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // Required for PKCE callback detection
    storageKey: STORAGE_KEY, // Unified storage key across all clients
  },
});

console.log("[supabase] ✅ Supabase client initialized");

// Console debugging handle — development builds only.
//
// The anon key itself is public, but this handle is not just the key: it is a
// live client already holding the signed-in user's session. Anything that can
// run script in the page (an XSS, a malicious extension, a pasted "fix",
// self-XSS in the console) can call window.supabase and read or write every
// row that user's RLS policies allow. Gating it on DEV means production ships
// no such handle; `import.meta.env.DEV` is statically false in the production
// build, so the whole block is dropped at build time.
if (import.meta.env.DEV && typeof window !== "undefined") {
  // @ts-ignore
  window.supabase = supabase;
}

