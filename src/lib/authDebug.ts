// src/lib/authDebug.ts
import { supabase } from './supabase';

export function attachAuthDebug() {
  console.log('[authDebug] 🔧 Attaching auth state change listener...');

  // Listen to all auth state changes
  supabase.auth.onAuthStateChange((event, session) => {
    console.log('[AUTH]', {
      event,
      user: session?.user?.id,
      email: session?.user?.email,
      hasSession: !!session,
      accessToken: session?.access_token ? `${session.access_token.substring(0, 20)}...` : null,
      expiresAt: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    });
  });

  // Catch unhandled promise rejections that might break auth
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[UNHANDLED PROMISE]', e.reason);
  });

  console.log('[authDebug] ✅ Auth debug listeners attached');
}

