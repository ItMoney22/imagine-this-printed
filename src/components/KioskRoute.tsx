import React, { useEffect, useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { useKioskAuth } from '../context/KioskAuthContext'
import KioskInterface from '../pages/KioskInterface'

const KioskRoute: React.FC = () => {
  const { kioskId } = useParams<{ kioskId: string }>()
  const { initializeKiosk, isKioskMode, isLoading, kiosk } = useKioskAuth()
  const [initializationComplete, setInitializationComplete] = useState(false)
  const [initializationFailed, setInitializationFailed] = useState(false)

  useEffect(() => {
    const initKiosk = async () => {
      if (!kioskId) {
        setInitializationFailed(true)
        return
      }

      try {
        const success = await initializeKiosk(kioskId)
        if (success) {
          setInitializationComplete(true)
        } else {
          setInitializationFailed(true)
        }
      } catch (error) {
        console.error('Failed to initialize kiosk:', error)
        setInitializationFailed(true)
      }
    }

    if (!initializationComplete && !initializationFailed) {
      initKiosk()
    }
  }, [kioskId, initializeKiosk, initializationComplete, initializationFailed])

  // Redirect if no kiosk ID
  if (!kioskId) {
    return <Navigate to="/" replace />
  }

  // Show loading state
  if (isLoading || (!initializationComplete && !initializationFailed)) {
    return (
      <div className="min-h-screen bg-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <h2 className="text-2xl font-bold text-purple-800 mb-2">Initializing Kiosk</h2>
          <p className="text-purple-600">Setting up your point of sale terminal...</p>
        </div>
      </div>
    )
  }

  // Show error state if initialization failed
  if (initializationFailed || !isKioskMode || !kiosk) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <svg className="w-16 h-16 text-red-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <h2 className="text-2xl font-bold text-red-800 mb-2">Kiosk Unavailable</h2>
          <p className="text-red-600 mb-4">
            This kiosk is currently offline, inactive, or does not exist.
          </p>
          <div className="text-sm text-red-500">
            <p>Possible reasons:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Kiosk has been deactivated</li>
              <li>Invalid kiosk ID</li>
              <li>Network connectivity issues</li>
              <li>Kiosk configuration error</li>
            </ul>
          </div>
          <div className="mt-6 p-4 bg-white rounded border text-left">
            <p className="text-xs text-gray-600 font-mono">
              Kiosk ID: {kioskId}
            </p>
            <p className="text-xs text-gray-600 font-mono">
              Time: {new Date().toISOString()}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Apply fullscreen for kiosk mode if enabled
  useEffect(() => {
    if (kiosk?.settings.kioskMode && kiosk.settings.touchOptimized) {
      // Request fullscreen for kiosk mode
      const requestFullscreen = () => {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(err => {
            console.log('Fullscreen request failed:', err)
          })
        }
      }

      // Auto-fullscreen after a short delay to ensure proper initialization
      const timer = setTimeout(requestFullscreen, 1000)
      
      return () => clearTimeout(timer)
    }
  }, [kiosk?.settings.kioskMode, kiosk?.settings.touchOptimized])

  // Vendor lock verification - ensure products are from the correct vendor
  useEffect(() => {
    if (kiosk && !kiosk.vendorId) {
      console.warn('Kiosk has no associated vendor - this may cause issues')
    }
  }, [kiosk])

  // Session management and auto-logout
  useEffect(() => {
    if (!kiosk?.settings.autoLoginEnabled) {
      return
    }

    let sessionTimer: NodeJS.Timeout
    let warningTimer: NodeJS.Timeout

    const resetSessionTimer = () => {
      // Clear existing timers
      if (sessionTimer) clearTimeout(sessionTimer)
      if (warningTimer) clearTimeout(warningTimer)

      // Set new timers
      const sessionTimeout = (kiosk.settings.sessionTimeout || 30) * 60 * 1000
      const warningTime = sessionTimeout - 60 * 1000 // 1 minute before timeout

      warningTimer = setTimeout(() => {
        // Show warning notification
        console.log('Session will expire in 1 minute due to inactivity')
      }, warningTime)

      sessionTimer = setTimeout(() => {
        // Auto-logout due to inactivity
        window.location.reload()
      }, sessionTimeout)
    }

    // Track user activity
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'touchmove']
    
    const handleActivity = () => {
      resetSessionTimer()
    }

    // Add event listeners
    activityEvents.forEach(event => {
      document.addEventListener(event, handleActivity, true)
    })

    // Initialize timer
    resetSessionTimer()

    // Cleanup
    return () => {
      if (sessionTimer) clearTimeout(sessionTimer)
      if (warningTimer) clearTimeout(warningTimer)
      
      activityEvents.forEach(event => {
        document.removeEventListener(event, handleActivity, true)
      })
    }
  }, [kiosk?.settings.autoLoginEnabled, kiosk?.settings.sessionTimeout])

  // Disable browser features in kiosk mode
  useEffect(() => {
    if (kiosk?.settings.kioskMode) {
      // Disable right-click context menu
      const disableContextMenu = (e: MouseEvent) => {
        e.preventDefault()
        return false
      }

      // Disable text selection
      const disableSelection = (e: Event) => {
        e.preventDefault()
        return false
      }

      // Disable drag and drop
      const disableDrag = (e: DragEvent) => {
        e.preventDefault()
        return false
      }

      document.addEventListener('contextmenu', disableContextMenu)
      document.addEventListener('selectstart', disableSelection)
      document.addEventListener('dragstart', disableDrag)

      // Disable certain keyboard shortcuts
      const disableShortcuts = (e: KeyboardEvent) => {
        // Disable F11 (fullscreen toggle), F12 (dev tools), Ctrl+Shift+I (dev tools), etc.
        if (
          e.key === 'F11' ||
          e.key === 'F12' ||
          (e.ctrlKey && e.shiftKey && e.key === 'I') ||
          (e.ctrlKey && e.shiftKey && e.key === 'C') ||
          (e.ctrlKey && e.key === 'u') ||
          (e.ctrlKey && e.key === 'U') ||
          (e.ctrlKey && e.key === 'r') ||
          (e.ctrlKey && e.key === 'R') ||
          e.key === 'F5'
        ) {
          e.preventDefault()
          return false
        }
      }

      document.addEventListener('keydown', disableShortcuts)

      // Cleanup
      return () => {
        document.removeEventListener('contextmenu', disableContextMenu)
        document.removeEventListener('selectstart', disableSelection)
        document.removeEventListener('dragstart', disableDrag)
        document.removeEventListener('keydown', disableShortcuts)
      }
    }
  }, [kiosk?.settings.kioskMode])

  // Render the kiosk interface
  return <KioskInterface />
}

export default KioskRoute