import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle, AlertCircle, Loader2, Package } from 'lucide-react'
import { API_BASE } from '../lib/api'
import { useAuth } from '../context/SupabaseAuthContext'

// Opt-in account claim, reached from the signed link in an order confirmation
// (/claim-account/:orderId?t=…). Guest checkout means the buyer has no account;
// this turns that one buyer into an account holder if THEY choose to, and pulls
// their past orders in with them. Nothing here runs unless they click.

interface ClaimPreview {
  orderNumber: string | null
  customerName: string | null
  emailMasked: string
  alreadyHasAccount: boolean
}

export default function ClaimAccount() {
  const { orderId } = useParams<{ orderId: string }>()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t') || ''
  const navigate = useNavigate()
  const { signIn } = useAuth()

  const [preview, setPreview] = useState<ClaimPreview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState<{ linkedOrders: number } | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/account/claim/${encodeURIComponent(orderId || '')}?t=${encodeURIComponent(token)}`
        )
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setLoadError(body.error || 'This link is not valid.')
          return
        }
        setPreview(body)
      } catch {
        if (!cancelled) setLoadError('We could not reach the server. Please try again.')
      }
    }

    void load()
    return () => { cancelled = true }
  }, [orderId, token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setFormError('Those passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/api/account/claim/${encodeURIComponent(orderId || '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token, password })
      })
      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        setFormError(body.error || 'We could not create your account.')
        return
      }

      // The account exists and its email is already verified, so sign them
      // straight in — making someone log in again right after choosing a
      // password is the kind of friction that loses the customer we just won.
      setDone({ linkedOrders: body.linkedOrders ?? 0 })
      const result = await signIn(body.email, password)
      if (!result.error) {
        setTimeout(() => navigate('/account/orders'), 1800)
      }
    } catch {
      setFormError('We could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="min-h-screen bg-bg py-12 px-4">
      <div className="max-w-md mx-auto">
        <div className="bg-card rounded-2xl shadow-soft border border-slate-200/60 p-8">
          {children}
        </div>
      </div>
    </div>
  )

  if (loadError) {
    return (
      <Shell>
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-display font-bold text-text mb-2">This link won't work</h1>
          <p className="text-muted text-sm mb-6">{loadError}</p>
          <Link
            to="/"
            className="inline-block px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
          >
            Back to the shop
          </Link>
        </div>
      </Shell>
    )
  }

  if (!preview) {
    return (
      <Shell>
        <div className="text-center py-8">
          <Loader2 className="w-8 h-8 text-primary mx-auto animate-spin mb-3" />
          <p className="text-muted text-sm">Checking your link…</p>
        </div>
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell>
        <div className="text-center">
          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h1 className="text-xl font-display font-bold text-text mb-2">You're all set</h1>
          <p className="text-muted text-sm mb-2">
            Your account is ready and we're signing you in.
          </p>
          {done.linkedOrders > 0 && (
            <p className="text-sm text-primary font-medium mb-6">
              {done.linkedOrders} order{done.linkedOrders === 1 ? '' : 's'} moved into your account.
            </p>
          )}
          <Link
            to="/account/orders"
            className="inline-block px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
          >
            View my orders
          </Link>
        </div>
      </Shell>
    )
  }

  if (preview.alreadyHasAccount) {
    return (
      <Shell>
        <div className="text-center">
          <CheckCircle className="w-12 h-12 text-primary mx-auto mb-4" />
          <h1 className="text-xl font-display font-bold text-text mb-2">You already have an account</h1>
          <p className="text-muted text-sm mb-6">
            {preview.emailMasked} is already registered. Sign in and your orders will be waiting.
          </p>
          <Link
            to="/login"
            className="inline-block px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
          >
            Sign in
          </Link>
        </div>
      </Shell>
    )
  }

  const firstName = (preview.customerName || '').trim().split(/\s+/)[0]

  return (
    <Shell>
      <div className="text-center mb-6">
        <Package className="w-10 h-10 text-primary mx-auto mb-3" />
        <h1 className="text-2xl font-display font-bold text-text mb-2">
          {firstName ? `Welcome back, ${firstName}` : 'Set up your account'}
        </h1>
        <p className="text-muted text-sm">
          Pick a password and order{preview.orderNumber ? ` ${preview.orderNumber}` : ''} moves
          straight into your new account.
        </p>
      </div>

      <div className="bg-bg rounded-xl border border-slate-200/60 px-4 py-3 mb-5">
        <p className="text-xs text-muted uppercase tracking-wide mb-1">Your email</p>
        <p className="text-sm font-medium text-text">{preview.emailMasked}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="claim-password" className="block text-sm font-medium text-text mb-1.5">
            Choose a password
          </label>
          <input
            id="claim-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-card text-text focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            placeholder="At least 8 characters"
            required
          />
        </div>

        <div>
          <label htmlFor="claim-confirm" className="block text-sm font-medium text-text mb-1.5">
            Confirm password
          </label>
          <input
            id="claim-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-card text-text focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            placeholder="Type it again"
            required
          />
        </div>

        {formError && (
          <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full px-5 py-3 bg-primary text-white rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {submitting ? 'Creating your account…' : 'Create my account'}
        </button>
      </form>

      <p className="text-xs text-muted text-center mt-5">
        Your email is already confirmed — you clicked through from your order email.
      </p>
    </Shell>
  )
}
