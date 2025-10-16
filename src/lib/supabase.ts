import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // we handle URL explicitly in AuthCallback
    },
  }
);

// Optional: expose for console debugging (safe; anon key is public)
if (typeof window !== "undefined") {
  // @ts-ignore
  window.supabase = supabase;
}
