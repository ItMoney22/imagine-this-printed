import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Sparkles, X } from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { GUEST_GATE_COPY, rememberReturnPath, type GuestGateReason } from '../lib/guest-gate'

// One place that asks a guest for an account — and only at the step that saves
// or spends (task 8c67fe67). Pages call requireAccount('toy-mix') right before
// the server call; it returns true for a signed-in visitor and otherwise opens
// the explained sign-up card and returns false.

interface GuestGateApi {
  /** True when signed in. Otherwise opens the account card and returns false. */
  requireAccount: (reason: GuestGateReason) => boolean
  /** Straight to sign-up / sign-in (for a page's own button), coming back here after. */
  startAccount: (reason: GuestGateReason, to?: '/signup' | '/login') => void
  isGuest: boolean
}

const GuestGateContext = createContext<GuestGateApi | null>(null)

export function GuestGateProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [reason, setReason] = useState<GuestGateReason | null>(null)

  const isGuest = !loading && !user

  const requireAccount = useCallback(
    (next: GuestGateReason) => {
      if (user) return true
      setReason(next)
      return false
    },
    [user],
  )

  // Signing in from another tab closes the card here too.
  useEffect(() => {
    if (user) setReason(null)
  }, [user])

  const startAccount = useCallback(
    (why: GuestGateReason, to: '/signup' | '/login' = '/signup') => {
      rememberReturnPath(location.pathname + location.search)
      setReason(null)
      navigate(to, { state: { from: location, reason: why } })
    },
    [location, navigate],
  )

  const go = useCallback(
    (to: '/signup' | '/login') => {
      if (reason) startAccount(reason, to)
    },
    [reason, startAccount],
  )

  const api = useMemo(() => ({ requireAccount, startAccount, isGuest }), [requireAccount, startAccount, isGuest])

  return (
    <GuestGateContext.Provider value={api}>
      {children}
      {reason && (
        <GuestGateCard
          reason={reason}
          onSignUp={() => go('/signup')}
          onSignIn={() => go('/login')}
          onClose={() => setReason(null)}
        />
      )}
    </GuestGateContext.Provider>
  )
}

export function useGuestGate(): GuestGateApi {
  const ctx = useContext(GuestGateContext)
  if (!ctx) throw new Error('useGuestGate must be used inside <GuestGateProvider>')
  return ctx
}

interface GuestGateCardProps {
  reason: GuestGateReason
  onSignUp: () => void
  onSignIn: () => void
  onClose: () => void
}

export function GuestGateCard({ reason, onSignUp, onSignIn, onClose }: GuestGateCardProps) {
  const copy = GUEST_GATE_COPY[reason]
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    primaryRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 sm:pb-0"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-gate-title"
        className="relative w-full max-w-md bg-card text-text rounded-3xl shadow-soft-xl border border-border overflow-hidden animate-[slideUp_0.25s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1.5 w-full bg-gradient-to-r from-primary via-secondary to-accent" />
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-primary/10 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="px-6 pt-7 pb-6 sm:px-8">
          <div className="flex items-center gap-3 mb-4">
            <img
              src="/mr-imagine/mr-imagine-waving.png"
              alt=""
              className="w-14 h-14 object-contain shrink-0"
            />
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              Free to join
            </span>
          </div>

          <h2 id="guest-gate-title" className="font-display text-2xl leading-tight text-text mb-3 pr-8">
            {copy.title}
          </h2>
          <p className="text-muted leading-relaxed">{copy.why}</p>
          {copy.keep && <p className="text-muted leading-relaxed mt-2">{copy.keep}</p>}

          <div className="mt-6 flex flex-col gap-3">
            <button ref={primaryRef} type="button" onClick={onSignUp} className="btn-primary w-full">
              Create free account
            </button>
            <button type="button" onClick={onSignIn} className="btn-secondary w-full !py-3">
              I already have an account
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-muted hover:text-text transition-colors py-1"
            >
              Keep looking around
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The "why" panel the sign-in and sign-up pages show for a visitor sent there. */
export function GateBanner({ title, why }: { title: string; why: string }) {
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-left">
      <p className="font-semibold text-text text-sm">{title}</p>
      <p className="text-muted text-sm mt-1 leading-relaxed">{why}</p>
    </div>
  )
}
