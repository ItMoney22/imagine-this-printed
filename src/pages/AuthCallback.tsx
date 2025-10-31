import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';

type CallbackStatus = 'parsing' | 'exchanging' | 'verifying' | 'redirecting' | 'error';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<CallbackStatus>('parsing');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        console.log('[callback] 🧭 Starting auth callback');
        const href = window.location.href;
        const params = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.slice(1));

        // Log what we received
        console.log('[callback] 🔍 Params detected:', {
          hasCode: !!params.get('code'),
          hasAccessToken: !!hashParams.get('access_token'),
          hasRefreshToken: !!hashParams.get('refresh_token'),
          hasError: !!params.get('error'),
        });

        // Handle OAuth errors first
        const errorParam = params.get('error');
        const errorDescription = params.get('error_description');
        if (errorParam) {
          throw new Error(errorDescription || errorParam);
        }

        // PKCE FLOW ONLY - This is the recommended Supabase v2+ approach
        // Supabase OAuth should be configured to use PKCE (code flow), not implicit (token in hash)
        const code = params.get('code');
        if (code) {
          console.log('[callback] 🔑 PKCE code found → exchangeCodeForSession');
          setStatus('exchanging');

          // Exchange the code for a session
          // Pass the full URL so Supabase can extract code and code_verifier
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(href);

          if (exchangeError) {
            console.error('[callback] ❌ exchangeCodeForSession failed:', exchangeError);
            throw exchangeError;
          }

          console.log('[callback] ✅ Session established:', {
            hasSession: !!data.session,
            userId: data.session?.user?.id,
          });
        } else {
          // No code parameter - this shouldn't happen with PKCE flow
          // If you see implicit tokens (access_token in hash), your OAuth config needs updating
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');

          if (accessToken && refreshToken) {
            console.warn(
              '[callback] ⚠️ IMPLICIT TOKENS DETECTED - Your OAuth is not using PKCE flow!'
            );
            console.warn('[callback] ⚠️ Please update Supabase Auth settings to use PKCE (code flow)');
            console.warn('[callback] ⚠️ Attempting to handle anyway, but this may be unreliable...');

            setStatus('exchanging');

            // Fallback: handle implicit flow if it somehow arrives
            const { error: setSessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (setSessionError) {
              console.error('[callback] ❌ setSession failed:', setSessionError);
              throw setSessionError;
            }

            console.log('[callback] ⚠️ Implicit session set (not recommended)');
          } else {
            // No code and no tokens - check if session already exists
            console.log('[callback] 📦 No OAuth params, checking existing session...');
            const { data: sessionData } = await supabase.auth.getSession();

            if (!sessionData.session) {
              throw new Error(
                'No OAuth code or tokens found in callback URL. Please try signing in again.'
              );
            }

            console.log('[callback] ℹ️ Existing session found:', sessionData.session.user.id);
          }
        }

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

        // Check localStorage persistence
        const storageKey = 'itp-auth-v1';
        const storedAuth = localStorage.getItem(storageKey);
        console.log('[callback] 💾 localStorage check:', {
          key: storageKey,
          hasData: !!storedAuth,
          hasToken: storedAuth ? !!JSON.parse(storedAuth).access_token : false,
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        {status === 'error' ? (
          <>
            <div className="text-red-500 text-6xl mb-4">✕</div>
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Authentication Error</h2>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <p className="text-xs text-gray-500">Redirecting to login page...</p>
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
            <p className="text-sm text-gray-600">Please wait while we sign you in</p>
          </>
        )}
      </div>
    </div>
  );
}
