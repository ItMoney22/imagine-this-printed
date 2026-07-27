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


const ciGateNegativeTest: number = "deliberately broken - CI gate negative test - do not merge";
void ciGateNegativeTest;
