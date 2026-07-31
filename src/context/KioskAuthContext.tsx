import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { API_BASE } from '../lib/api'
import type { Kiosk } from '../types'

// Kiosk terminal auth. A kiosk is NEVER a Supabase Auth user and never gets
// a client-minted `role: 'kiosk'` User object (the previous implementation
// did exactly that from nothing more than the :kioskId URL param — anyone
// who could guess/enumerate a kiosk ID got kiosk UI access, and role:
// 'kiosk' was checked nowhere server-side, so the "security" was purely
// cosmetic). See supabase/migrations/20260728_kiosk_device_sessions.sql and
// backend/routes/kiosk.ts for the server side of this.
//
// Two secrets, two lifetimes, both in this browser's storage and nowhere
// else:
//   - deviceSecret: provisioned ONCE per physical terminal by an admin
//     (backend/routes/admin/kiosk-devices.ts), delivered via a one-time
//     `?provision=<secret>` URL (typed in or scanned as a QR code). Stored
//     in localStorage so it survives terminal reboots — that's the whole
//     point of "per-device" secrets: this browser profile IS the device.
//     Stripped out of the URL/history immediately so it never lingers
//     anywhere visible (browser history, screen-share, etc).
//   - sessionToken: short-lived, minted by POST /api/kiosk/session in
//     exchange for the deviceSecret. Kept in sessionStorage (survives
//     reloads, not full browser/tab restarts) and re-exchanged
//     automatically from the stored deviceSecret whenever it's missing or
//     the backend rejects it as expired/revoked.

const deviceSecretKey = (kioskId: string) => `itp_kiosk_device_secret_${kioskId}`
const sessionTokenKey = (kioskId: string) => `itp_kiosk_session_token_${kioskId}`

interface KioskAuthContextType {
  kiosk: Kiosk | null
  sessionToken: string | null
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
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Hold the kiosk-mode event-listener functions in refs so addEventListener
  // and removeEventListener see THE SAME function reference — otherwise
  // removeEventListener silently no-ops and listeners accumulate.
  const listenersRef = useRef<{
    preventContextMenu?: (e: Event) => void
    preventSelection?: (e: Event) => void
    preventKeyboardShortcuts?: (e: KeyboardEvent) => void
  }>({})

  const isKioskMode = Boolean(kiosk && sessionToken)

  const initializeKiosk = async (kioskId: string): Promise<boolean> => {
    try {
      setIsLoading(true)

      // One-time provisioning: an admin-issued link carries the device
      // secret as ?provision=<secret>. Persist it to this device's
      // localStorage and scrub it from the URL immediately — it must never
      // sit in browser history or be visible if the screen is shared.
      const params = new URLSearchParams(window.location.search)
      const provisionSecret = params.get('provision')
      if (provisionSecret) {
        localStorage.setItem(deviceSecretKey(kioskId), provisionSecret)
        params.delete('provision')
        const cleanQuery = params.toString()
        window.history.replaceState({}, '', window.location.pathname + (cleanQuery ? `?${cleanQuery}` : ''))
      }

      const deviceSecret = localStorage.getItem(deviceSecretKey(kioskId))
      if (!deviceSecret) {
        // No secret on this device — deliberately identical outcome
        // whether the kiosk ID is real or made up, so URL-guessing reveals
        // nothing.
        console.error('Kiosk not provisioned on this device')
        return false
      }

      const res = await fetch(`${API_BASE}/api/kiosk/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kioskId, deviceSecret })
      })

      if (!res.ok) {
        console.error('Kiosk session exchange failed:', res.status)
        return false
      }

      const data = await res.json()
      if (!data.kiosk || !data.sessionToken) {
        return false
      }

      sessionStorage.setItem(sessionTokenKey(kioskId), data.sessionToken)
      setSessionToken(data.sessionToken)
      setKiosk(data.kiosk as Kiosk)

      // Set kiosk mode styling
      if (data.kiosk.settings?.kioskMode) {
        document.body.classList.add('kiosk-mode')

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
      // remove the SAME function references. NOTE: this block is UI-only —
      // it deters casual right-click/devtools access on a physical touch
      // terminal, it does not and cannot secure anything. Real security is
      // the session-token exchange above; this stays purely for the kiosk
      // "look and feel" the touch UI was designed around.
      const preventContextMenu = (e: Event) => e.preventDefault()
      const preventSelection = (e: Event) => e.preventDefault()
      const preventKeyboardShortcuts = (e: KeyboardEvent) => {
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

      if (data.kiosk.settings?.kioskMode) {
        const prior = listenersRef.current
        if (prior.preventContextMenu) document.removeEventListener('contextmenu', prior.preventContextMenu)
        if (prior.preventSelection) {
          document.removeEventListener('selectstart', prior.preventSelection)
          document.removeEventListener('dragstart', prior.preventSelection)
        }
        if (prior.preventKeyboardShortcuts) document.removeEventListener('keydown', prior.preventKeyboardShortcuts)

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
    // Clears the SESSION (work-shift reset / logout), not the device's
    // provisioning secret — the terminal stays provisioned and will
    // silently re-exchange a fresh session next time it loads.
    if (kiosk) sessionStorage.removeItem(sessionTokenKey(kiosk.id))
    setKiosk(null)
    setSessionToken(null)

    document.body.classList.remove('kiosk-mode')
    const kioskStyles = document.getElementById('kiosk-styles')
    if (kioskStyles) {
      kioskStyles.remove()
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-logout when navigating away from kiosk routes
  useEffect(() => {
    const currentPath = window.location.pathname
    if (!currentPath.startsWith('/kiosk/') && isKioskMode) {
      resetKioskSession()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKioskMode])

  const value: KioskAuthContextType = {
    kiosk,
    sessionToken,
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
