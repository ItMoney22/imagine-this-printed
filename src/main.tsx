import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import './index.css'
import App from './App.tsx'
import { attachAuthDebug } from './lib/authDebug'
import { ThemeProvider } from './components/ThemeProvider'

// Attach auth debugging hooks
attachAuthDebug()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
