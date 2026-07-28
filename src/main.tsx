import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import './index.css'
import App from './App.tsx'
import { attachAuthDebug } from './lib/authDebug'
import { ThemeProvider } from './components/ThemeProvider'
import { forceRefreshSession, hardResetAuth } from './utils/forceRefreshSession'
import { captureLandingUtms } from './utils/utm'

// Capture ?utm_* BEFORE React mounts and the router rewrites the URL — social
// links carry attribution only on the very first url of a visit.
captureLandingUtms()

// Attach auth debugging hooks
attachAuthDebug()

// Expose session refresh utilities to browser console for debugging
declare global {
  interface Window {
    refreshSession: typeof forceRefreshSession
    hardResetAuth: typeof hardResetAuth
  }
}

window.refreshSession = forceRefreshSession
window.hardResetAuth = hardResetAuth

console.log('[Debug] 🛠️ Session utilities available:')
console.log('  • window.refreshSession() - Force refresh user session')
console.log('  • window.hardResetAuth() - Clear all auth data and sign out')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)

