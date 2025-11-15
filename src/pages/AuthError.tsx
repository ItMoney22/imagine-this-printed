import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';

export default function AuthError() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const error = searchParams.get('error') || 'Unknown error';
  const errorDescription = searchParams.get('error_description') || 'Authentication failed. Please try again.';

  useEffect(() => {
    console.error('[auth/error] OAuth error:', { error, errorDescription });
  }, [error, errorDescription]);

  return (
    <div className="min-h-screen bg-card flex items-center justify-center p-6">
      <div className="bg-card rounded-lg shadow-lg p-8 max-w-md w-full">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-text mb-2">Authentication Failed</h1>
          <p className="text-muted mb-6">{errorDescription}</p>

          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-left">
            <p className="text-sm font-medium text-red-800 mb-1">Error Code:</p>
            <p className="text-sm text-red-600 font-mono">{error}</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              Return to Login
            </button>

            <button
              onClick={() => navigate('/', { replace: true })}
              className="w-full bg-gray-200 text-text py-3 px-4 rounded-lg font-medium hover:bg-gray-300 transition-colors"
            >
              Go to Home
            </button>
          </div>

          <div className="mt-6 text-left">
            <p className="text-xs font-semibold text-text mb-2">Common Issues:</p>
            <ul className="text-xs text-muted space-y-1">
              <li>• Check your internet connection</li>
              <li>• Verify your email/password is correct</li>
              <li>• Clear browser cache and try again</li>
              <li>• Try a different browser or incognito mode</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

