import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        console.log('[callback] 🧭 Starting auth callback');
        const search = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));

        const code = search.get('code');
        const access_token =
          hashParams.get('access_token') || search.get('access_token');
        const refresh_token =
          hashParams.get('refresh_token') || search.get('refresh_token');

        if (code) {
          console.log('[callback] 🔑 PKCE code found → exchangeCodeForSession');
          await supabase.auth.exchangeCodeForSession(code);
        } else if (access_token && refresh_token) {
          console.log('[callback] 🎫 Implicit tokens found → setSession');
          await supabase.auth.setSession({ access_token, refresh_token });
        } else {
          console.log('[callback] 📦 No tokens; trying getSession()');
          await supabase.auth.getSession();
        }

        // Verify session was set
        const { data } = await supabase.auth.getSession();
        console.log('[callback] ✅ Session established:', !!data.session, 'user:', data.session?.user?.id);

        // Verify localStorage persistence
        const storageKey = 'itp-auth-v1';
        const storedAuth = localStorage.getItem(storageKey);
        console.log('[callback] 💾 localStorage check:', {
          key: storageKey,
          hasData: !!storedAuth,
          hasToken: storedAuth ? !!JSON.parse(storedAuth).access_token : false
        });

        // Clean URL
        window.history.replaceState({}, '', '/');
        console.log('[callback] 🧹 URL cleaned');

        // Determine where to redirect
        const returnTo = localStorage.getItem('returnTo') || localStorage.getItem('auth_return_to') || '/';
        console.log('[callback] 🎯 Navigating to:', returnTo);

        // Clear return path
        localStorage.removeItem('returnTo');
        localStorage.removeItem('auth_return_to');

        // Try router navigation first
        navigate(returnTo, { replace: true });

        // Hard fallback: force window.location.replace if router doesn't fire
        setTimeout(() => {
          if (window.location.pathname === '/auth/callback') {
            console.log('[callback] ⚠️ Router navigation stuck, forcing window.location.replace');
            window.location.replace(returnTo);
          }
        }, 2000);

      } catch (e) {
        console.error('[callback] ❌ Error:', e);
        // On error, force navigate to home after delay
        setTimeout(() => {
          console.log('[callback] ⏱️ Error recovery: redirecting to login');
          window.location.replace('/login');
        }, 3000);
      }
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-gray-800">Completing sign in…</h2>
        <p className="text-sm text-gray-600 mt-2">Please wait while we redirect you</p>
      </div>
    </div>
  );
}
