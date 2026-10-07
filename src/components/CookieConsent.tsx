import { useState, useEffect } from 'react'

const COOKIE_CONSENT_KEY = 'itp_cookie_consent'

interface CookieConsentProps {
  onAccept?: () => void
  onDecline?: () => void
}

export function CookieConsent({ onAccept, onDecline }: CookieConsentProps) {
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    // Check if user has already made a choice
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY)
    if (!consent) {
      // Show banner after a short delay for better UX
      const timer = setTimeout(() => setShowBanner(true), 1000)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleAccept = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'accepted')
    setShowBanner(false)
    onAccept?.()
  }

  const handleDecline = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, 'declined')
    // Clear any existing tracking cookies
    document.cookie = 'itp_referral=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    document.cookie = 'itp_referral_ts=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    setShowBanner(false)
    onDecline?.()
  }

  if (!showBanner) return null

  return (
    // One slim, solid row on phones (the old stacked banner sat over the Add to
    // Cart button); a small card beside the chat bubble on desktop. bg-card/95
    // never rendered (a var colour takes no alpha here), so the bar was clear.
    <div className="fixed z-50 bottom-0 inset-x-0 lg:inset-x-auto lg:bottom-6 lg:right-28 lg:max-w-md px-3 py-2 sm:p-4 bg-card border-t lg:border border-border lg:rounded-2xl shadow-soft-lg animate-slideUp">
      <div className="max-w-7xl mx-auto flex flex-row items-center justify-between gap-3">
        <p className="flex-1 text-text text-xs sm:text-sm">
          We use cookies for referral credit.{' '}
          <a href="/privacy" className="text-primary hover:text-primary/80 underline">Privacy</a>
        </p>
        <div className="flex gap-2 sm:gap-3 shrink-0">
          <button
            onClick={handleDecline}
            className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm text-muted hover:text-text border border-muted/30 rounded-lg transition-colors"
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            className="px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm bg-primary text-bg font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}

// Helper to check if cookies are accepted
export function hasAcceptedCookies(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(COOKIE_CONSENT_KEY) === 'accepted'
}

// Helper to check if user has made any choice
export function hasCookieConsent(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(COOKIE_CONSENT_KEY) !== null
}

export default CookieConsent
