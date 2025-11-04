import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { verifyPkceStorage, getPkceDebugInfo } from '@/utils/verifyPkce';

type CallbackStatus = 'parsing' | 'exchanging' | 'verifying' | 'redirecting' | 'error';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<CallbackStatus>('parsing');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        console.log('[callback] 🧭 Starting PKCE auth callback');
        console.log('[callback] 🌐 Current origin:', window.location.origin);
        console.log('[callback] 📍 Full URL:', window.location.href);

        const href = window.location.href;
        const params = new URLSearchParams(window.location.search);

        // QA VERIFICATION: Check PKCE keys are present before exchange
        console.log('[callback] 🔍 Running PKCE verification...');
        console.log('[PKCE QA]', Object.keys(localStorage).filter(k => k.startsWith('sb-')));

        const pkceVerification = verifyPkceStorage();
        console.log(getPkceDebugInfo());

        // CRITICAL: Verify PKCE keys exist
        if (!pkceVerification.hasState || !pkceVerification.hasVerifier) {
          console.error('[callback] ❌ PKCE VERIFICATION FAILED');
          console.error('[callback] Missing keys:', {
            state: pkceVerification.hasState ? '✅' : '❌ MISSING',
            verifier: pkceVerification.hasVerifier ? '✅' : '❌ MISSING',
          });
          throw new Error('PKCE keys not found in localStorage. Auth flow may have been interrupted.');
        }

        console.log('[callback] ✅ PKCE verification passed');

        // Handle OAuth errors first
        const errorParam = params.get('error');
        const errorDescription = params.get('error_description');
        if (errorParam) {
          console.error('[callback] ❌ OAuth error:', errorDescription || errorParam);
          throw new Error(errorDescription || errorParam);
        }

        // PKCE FLOW ONLY - require code parameter
        const code = params.get('code');
        if (!code) {
          console.error('[callback] ❌ No PKCE code in URL - implicit flow is disabled');
          throw new Error('No PKCE code in URL (implicit flow is disabled)');
        }

        console.log('[callback] 🔑 PKCE code found → exchangeCodeForSession');
        setStatus('exchanging');

        // Exchange the authorization code for a session
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(href);

        if (exchangeError) {
          console.error('[callback] ❌ exchangeCodeForSession failed:', exchangeError);
          throw exchangeError;
        }

        console.log('[callback] ✅ Session established:', {
          hasSession: !!data.session,
          userId: data.session?.user?.id,
        });

        // Verify session is actually set
        setStatus('verifying');
        console.log('[callback] 🔍 Verifying session...');

        const { data: verifyData, error: verifyError } = await supabase.auth.getSession();
        if (verifyError) {
          console.error('[callback] ❌ Session verification failed:', verifyError);
          throw verifyError;
        }

        if (!verifyData.session) {
          throw new Error('Session verification failed: no session found after auth exchange');
        }

        console.log('[callback] ✅ Session verified:', {
          userId: verifyData.session.user.id,
          email: verifyData.session.user.email,
        });

        // Clean URL of OAuth parameters
        setStatus('redirecting');
        console.log('[callback] 🧹 Cleaning URL...');
        window.history.replaceState({}, '', window.location.pathname);

        // Determine redirect destination
        const returnTo =
          localStorage.getItem('auth_return_to') ||
          localStorage.getItem('returnTo') ||
          '/';

        console.log('[callback] 🎯 Redirecting to:', returnTo);

        // Clear return path
        localStorage.removeItem('auth_return_to');
        localStorage.removeItem('returnTo');

        // Navigate using React Router
        console.log('[callback] 🚀 Navigating with React Router...');
        navigate(returnTo, { replace: true });

        // Fallback: if router doesn't work, force window navigation
        setTimeout(() => {
          if (window.location.pathname === '/auth/callback') {
            console.warn('[callback] ⚠️ React Router navigation stuck, using window.location');
            window.location.replace(returnTo);
          }
        }, 1000);
      } catch (err: any) {
        console.error('[callback] ❌ Auth callback error:', err);
        setStatus('error');
        setError(err.message || 'Authentication failed');

        // On error, redirect to login after showing error briefly
        setTimeout(() => {
          console.log('[callback] 🔄 Redirecting to login after error...');
          navigate('/login', { replace: true });
        }, 3000);
      }
    })();
  }, [navigate]);

  // Render status-specific UI
  return (
    <div className="min-h-screen bg-card flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        {status === 'error' ? (
          <>
            <div className="text-red-500 text-6xl mb-4">✕</div>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Authentication Error</h2>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <p className="text-xs text-muted">Redirecting to login page...</p>
          </>
        ) : (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">
              {status === 'parsing' && 'Processing authentication...'}
              {status === 'exchanging' && 'Exchanging credentials...'}
              {status === 'verifying' && 'Verifying session...'}
              {status === 'redirecting' && 'Redirecting...'}
            </h2>
            <p className="text-sm text-muted">Please wait while we sign you in</p>
          </>
        )}
      </div>
    </div>
  );
}
