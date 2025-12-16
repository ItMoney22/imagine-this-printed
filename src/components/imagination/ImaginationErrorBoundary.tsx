// src/components/imagination/ImaginationErrorBoundary.tsx

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home, Save } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ImaginationErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ImaginationStation Error:', error, errorInfo);

    // Try to save current state to localStorage before crashing
    try {
      const autosaveKey = 'imagination-station-crash-recovery';
      const existingData = localStorage.getItem(autosaveKey);
      if (existingData) {
        const crashData = {
          error: error.message,
          timestamp: new Date().toISOString(),
          componentStack: errorInfo.componentStack,
        };
        localStorage.setItem(`${autosaveKey}-crash`, JSON.stringify(crashData));
      }
    } catch (e) {
      console.error('Failed to save crash data:', e);
    }

    this.setState({
      error,
      errorInfo,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  handleRecoverWork = () => {
    const autosaveKey = 'imagination-station-autosave';
    const savedData = localStorage.getItem(autosaveKey);

    if (savedData) {
      alert('Your work has been preserved. Reloading the page...');
    }

    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const hasAutosave = !!localStorage.getItem('imagination-station-autosave');

      return (
        <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white rounded-2xl border border-stone-200 shadow-xl p-8">
            {/* Error Icon */}
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-50 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>

            {/* Title */}
            <h2 className="text-2xl font-serif font-bold text-stone-900 text-center mb-3">
              Something Went Wrong
            </h2>

            {/* Description */}
            <p className="text-stone-600 text-center mb-6">
              Imagination Station encountered an unexpected error. Don't worry - your work may have been auto-saved.
            </p>

            {/* Error Details */}
            {this.state.error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-xs font-mono text-red-800 break-words">
                  {this.state.error.message}
                </p>
              </div>
            )}

            {/* Autosave Notice */}
            {hasAutosave && (
              <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl flex items-start gap-3">
                <Save className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-green-800 mb-1">
                    Auto-saved work detected
                  </p>
                  <p className="text-xs text-green-700">
                    We found a recent backup of your work. Click "Recover Work" to restore it.
                  </p>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-3">
              {hasAutosave && (
                <button
                  onClick={this.handleRecoverWork}
                  className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl font-medium hover:from-purple-700 hover:to-purple-800 transition-all flex items-center justify-center gap-2 shadow-lg"
                >
                  <Save className="w-5 h-5" />
                  Recover Work & Reload
                </button>
              )}

              <button
                onClick={this.handleRetry}
                className="w-full px-4 py-3 bg-white border border-stone-200 text-stone-700 rounded-xl font-medium hover:bg-stone-50 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-5 h-5" />
                Try Again
              </button>

              <button
                onClick={this.handleGoHome}
                className="w-full px-4 py-3 bg-white border border-stone-200 text-stone-700 rounded-xl font-medium hover:bg-stone-50 transition-all flex items-center justify-center gap-2"
              >
                <Home className="w-5 h-5" />
                Go to Home
              </button>
            </div>

            {/* Timestamp */}
            <div className="mt-6 text-center text-xs text-stone-400">
              Error occurred at: {new Date().toLocaleString()}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ImaginationErrorBoundary;
