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
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-card/95 backdrop-blur-sm border-t border-primary/20 shadow-lg animate-slideUp">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex-1 text-center sm:text-left">
          <p className="text-text text-sm">
            We use cookies to track referrals and improve your experience.
            Referral cookies are stored for 90 days to ensure you get credit for sharing ImagineThisPrinted.
          </p>
          <a
            href="/privacy"
            className="text-primary hover:text-primary/80 text-sm underline"
          >
            Learn more in our Privacy Policy
          </a>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleDecline}
            className="px-4 py-2 text-sm text-muted hover:text-text border border-muted/30 rounded-lg transition-colors"
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            className="px-4 py-2 text-sm bg-primary text-bg font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            Accept Cookies
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
