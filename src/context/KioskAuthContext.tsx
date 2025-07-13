import React, { createContext, useContext, useEffect, useState } from 'react'
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

      // Prevent context menu and text selection
      const preventContextMenu = (e: Event) => e.preventDefault()
      const preventSelection = (e: Event) => e.preventDefault()
      
      if (kioskData.settings.kioskMode) {
        document.addEventListener('contextmenu', preventContextMenu)
        document.addEventListener('selectstart', preventSelection)
        document.addEventListener('dragstart', preventSelection)
      }

      // Disable F11, F12, Ctrl+Shift+I, etc. in kiosk mode
      const preventKeyboardShortcuts = (e: KeyboardEvent) => {
        if (kioskData.settings.kioskMode) {
          // Disable F11 (fullscreen), F12 (dev tools), Ctrl+Shift+I, etc.
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
      }

      if (kioskData.settings.kioskMode) {
        document.addEventListener('keydown', preventKeyboardShortcuts)
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

    // Remove event listeners
    const preventContextMenu = (e: Event) => e.preventDefault()
    const preventSelection = (e: Event) => e.preventDefault()
    
    document.removeEventListener('contextmenu', preventContextMenu)
    document.removeEventListener('selectstart', preventSelection)
    document.removeEventListener('dragstart', preventSelection)
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