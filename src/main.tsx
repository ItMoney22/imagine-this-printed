import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import './index.css'
import App from './App.tsx'
import { attachAuthDebug } from './lib/authDebug'
import { ThemeProvider } from './components/ThemeProvider'
import { forceRefreshSession, hardResetAuth } from './utils/forceRefreshSession'

// Attach auth debugging hooks
attachAuthDebug()

// Session utilities on `window` are development-only. They are auth handles —
// hardResetAuth wipes stored credentials and signs the user out — so shipping
// them to production hands any injected script a ready-made lever. DEV is
// statically false in the production build, so this is dropped at build time.
declare global {
  interface Window {
    refreshSession?: typeof forceRefreshSession
    hardResetAuth?: typeof hardResetAuth
  }
}

if (import.meta.env.DEV) {
  window.refreshSession = forceRefreshSession
  window.hardResetAuth = hardResetAuth

  console.log('[Debug] 🛠️ Session utilities available:')
  console.log('  • window.refreshSession() - Force refresh user session')
  console.log('  • window.hardResetAuth() - Clear all auth data and sign out')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)

