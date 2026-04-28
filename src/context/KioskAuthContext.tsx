import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { kioskService } from '../utils/kiosk-service'
import type { Kiosk, User } from '../types'

interface KioskAuthContextType {
  kiosk: Kiosk | null
  kioskUser: User | null
  isKioskMode: boolean
  isLoading: boolean
  initializeKiosk: (kioskId: string) => Promise<boolean>
  resetKioskSession: () => void
}

const KioskAuthContext = createContext<KioskAuthContextType | undefined>(undefined)

export const useKioskAuth = () => {
  const context = useContext(KioskAuthContext)
  if (context === undefined) {
    throw new Error('useKioskAuth must be used within a KioskAuthProvider')
  }
  return context
}

interface KioskAuthProviderProps {
  children: React.ReactNode
}

export const KioskAuthProvider: React.FC<KioskAuthProviderProps> = ({ children }) => {
  const [kiosk, setKiosk] = useState<Kiosk | null>(null)
  const [kioskUser, setKioskUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Hold the kiosk-mode event-listener functions in refs so addEventListener
  // and removeEventListener see THE SAME function reference. The previous
  // implementation declared the handlers locally inside initializeKiosk and
  // again inside resetKioskSession — those are different function objects, so
  // removeEventListener silently no-ops and the listeners accumulate across
  // sessions. Refs fix that, AND it lets us include the keydown handler
  // (which was added but never removed at all) in cleanup.
  const listenersRef = useRef<{
    preventContextMenu?: (e: Event) => void
    preventSelection?: (e: Event) => void
    preventKeyboardShortcuts?: (e: KeyboardEvent) => void
  }>({})

  const isKioskMode = Boolean(kiosk && kioskUser)

  const initializeKiosk = async (kioskId: string): Promise<boolean> => {
    try {
      setIsLoading(true)
      
      // Get kiosk data
      const kioskData = await kioskService.getKiosk(kioskId)
      
      if (!kioskData || !kioskData.isActive) {
        console.error('Kiosk not found or inactive')
        return false
      }

      // Create/get kiosk user for auto-login
      const kioskUserData: User = {
        id: kioskData.kioskUserId,
        email: `kiosk-${kioskId}@kiosk.local`,
        role: 'kiosk',
        firstName: 'Kiosk',
        lastName: 'User',
        points: 0,
        itcBalance: 0,
        createdAt: kioskData.createdAt
      }

      setKiosk(kioskData)
      setKioskUser(kioskUserData)

      // Set kiosk mode styling
      if (kioskData.settings.kioskMode) {
        document.body.classList.add('kiosk-mode')
        
        // Apply kiosk-specific styles
        const style = document.createElement('style')
        style.textContent = `
          .kiosk-mode {
            overflow: hidden;
            user-select: none;
            -webkit-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
          }
          
          .kiosk-mode * {
            cursor: default !important;
          }
          
          .kiosk-mode .touch-manipulation {
            cursor: pointer !important;
            touch-action: manipulation;
          }

          .kiosk-mode input, .kiosk-mode button {
            cursor: pointer !important;
          }

          .kiosk-mode button:hover {
            transform: scale(1.02);
          }

          .kiosk-mode button:active {
            transform: scale(0.98);
          }

          @media (max-width: 768px) {
            .kiosk-mode {
              font-size: 1.25rem;
            }
            
            .kiosk-mode button {
              min-height: 48px;
              min-width: 48px;
            }
            
            .kiosk-mode input {
              min-height: 48px;
            }
          }
        `
        style.id = 'kiosk-styles'
        document.head.appendChild(style)
      }

      // Define the kiosk-mode listeners on the ref so resetKioskSession can
      // remove the SAME function references (was the leak source).
      const preventContextMenu = (e: Event) => e.preventDefault()
      const preventSelection = (e: Event) => e.preventDefault()
      const preventKeyboardShortcuts = (e: KeyboardEvent) => {
        // Note: doesn't read kioskData.settings — handlers are only attached
        // when kioskMode is true, and resetKioskSession removes them on exit.
        if (
          e.key === 'F11' ||
          e.key === 'F12' ||
          (e.ctrlKey && e.shiftKey && e.key === 'I') ||
          (e.ctrlKey && e.shiftKey && e.key === 'C') ||
          (e.ctrlKey && e.key === 'u') ||
          (e.ctrlKey && e.key === 'U')
        ) {
          e.preventDefault()
          e.stopPropagation()
          return false
        }
      }

      if (kioskData.settings.kioskMode) {
        // First clean any prior session's listeners so we don't double-attach
        // if initializeKiosk is called twice without an intervening reset.
        const prior = listenersRef.current
        if (prior.preventContextMenu) document.removeEventListener('contextmenu', prior.preventContextMenu)
        if (prior.preventSelection) {
          document.removeEventListener('selectstart', prior.preventSelection)
          document.removeEventListener('dragstart', prior.preventSelection)
        }
        if (prior.preventKeyboardShortcuts) document.removeEventListener('keydown', prior.preventKeyboardShortcuts)

        // Attach the new ones and store them on the ref.
        document.addEventListener('contextmenu', preventContextMenu)
        document.addEventListener('selectstart', preventSelection)
        document.addEventListener('dragstart', preventSelection)
        document.addEventListener('keydown', preventKeyboardShortcuts)
        listenersRef.current = { preventContextMenu, preventSelection, preventKeyboardShortcuts }
      }

      return true
    } catch (error) {
      console.error('Error initializing kiosk:', error)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const resetKioskSession = () => {
    setKiosk(null)
    setKioskUser(null)
    
    // Clean up kiosk mode
    document.body.classList.remove('kiosk-mode')
    const kioskStyles = document.getElementById('kiosk-styles')
    if (kioskStyles) {
      kioskStyles.remove()
    }

    // Remove event listeners using the SAME references we stored on the ref
    // when initializeKiosk attached them. Previously this code created NEW
    // anonymous functions and called removeEventListener on those, which is
    // a no-op (different references) — listeners stayed attached forever and
    // accumulated on each session reset.
    const refs = listenersRef.current
    if (refs.preventContextMenu) document.removeEventListener('contextmenu', refs.preventContextMenu)
    if (refs.preventSelection) {
      document.removeEventListener('selectstart', refs.preventSelection)
      document.removeEventListener('dragstart', refs.preventSelection)
    }
    if (refs.preventKeyboardShortcuts) document.removeEventListener('keydown', refs.preventKeyboardShortcuts)
    listenersRef.current = {}
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      resetKioskSession()
    }
  }, [])

  // Auto-logout when navigating away from kiosk routes
  useEffect(() => {
    const currentPath = window.location.pathname
    if (!currentPath.startsWith('/kiosk/') && isKioskMode) {
      resetKioskSession()
    }
  }, [isKioskMode])

  const value: KioskAuthContextType = {
    kiosk,
    kioskUser,
    isKioskMode,
    isLoading,
    initializeKiosk,
    resetKioskSession
  }

  return (
    <KioskAuthContext.Provider value={value}>
      {children}
    </KioskAuthContext.Provider>
  )
}

export default KioskAuthProvider
