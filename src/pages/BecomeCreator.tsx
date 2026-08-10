import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Shirt, Box, Frame, Mic, BadgeDollarSign, ShieldCheck, Loader2 } from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { apiFetch } from '../lib/api'

/**
 * Become a Creator — instant opt-in (David 2026-08-09). No application, no
 * waiting: accept the deal, start creating. The product approval queue is the
 * real quality gate, so membership itself is one click.
 */
export default function BecomeCreator() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [joining, setJoining] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Already a creator? Straight to the studio.
  useEffect(() => {
    let cancelled = false
    if (!user) { setChecking(false); return }
    apiFetch('/api/creators/me')
      .then((me: any) => {
        if (!cancelled && me?.isCreator) navigate('/creator/studio', { replace: true })
      })
      .catch(() => { /* not fatal — show the pitch */ })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [user, navigate])

  const handleJoin = async () => {
    setJoining(true)
    setError(null)
    try {
      await apiFetch('/api/creators/signup', { method: 'POST', body: '{}' })
      navigate('/creator/studio')
    } catch (e: any) {
      setError(e.message || 'Signup failed — try again')
      setJoining(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 sm:py-16">
      <div className="bg-card/30 backdrop-blur-md rounded-3xl shadow-2xl p-6 sm:p-10 border border-white/10 ring-1 ring-white/5">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-full px-4 py-1.5 text-sm text-primary font-semibold mb-4">
            <Sparkles className="w-4 h-4" /> Creator Program
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-primary via-purple-400 to-secondary bg-clip-text text-transparent mb-3">
            Design it. We print it. You get paid.
          </h1>
          <p className="text-muted text-base sm:text-lg">
            Join free in one click and start putting YOUR designs on real products.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          {[
            { icon: Shirt, title: 'Shirts & apparel', text: 'Front, back, pocket — even both sides.' },
            { icon: Frame, title: 'Metal art', text: 'Your art on gallery-grade metal panels.' },
            { icon: Box, title: '3D prints', text: 'Turn an idea into a printable model.' },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-bg/40 border border-white/10 rounded-2xl p-4 text-center">
              <Icon className="w-7 h-7 text-primary mx-auto mb-2" />
              <p className="font-semibold text-text text-sm mb-1">{title}</p>
              <p className="text-xs text-muted">{text}</p>
            </div>
          ))}
        </div>

        <div className="space-y-3 mb-8">
          <div className="flex items-start gap-3 bg-bg/30 border border-white/10 rounded-xl p-4">
            <Mic className="w-5 h-5 text-secondary flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted">
              <span className="text-text font-semibold">Build live with Mr. Imagine.</span>{' '}
              Talk your idea out loud and watch designs, mockups, and real model photos appear — or use the classic tools if you'd rather click.
            </p>
          </div>
          <div className="flex items-start gap-3 bg-bg/30 border border-white/10 rounded-xl p-4">
            <BadgeDollarSign className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted">
              <span className="text-text font-semibold">15% of every sale is yours,</span>{' '}
              paid in ITC to your wallet. Your name rides with your product.
            </p>
          </div>
          <div className="flex items-start gap-3 bg-bg/30 border border-white/10 rounded-xl p-4">
            <ShieldCheck className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted">
              <span className="text-text font-semibold">Every product gets a human review</span>{' '}
              before it goes live — usually within a day. You must own or have rights to the ideas you submit; no copyrighted characters, logos, or hateful content.
            </p>
          </div>
        </div>

        <button
          onClick={handleJoin}
          disabled={joining || !user}
          className="w-full bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90 text-white font-bold py-4 rounded-xl shadow-lg shadow-primary/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center text-lg"
        >
          {joining ? (
            <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Joining…</>
          ) : (
            <><Sparkles className="w-5 h-5 mr-2" /> I agree — start creating</>
          )}
        </button>
        <p className="text-xs text-muted text-center mt-3">
          By joining you accept the creator terms above (v2026-08-09). Generating designs costs ITC from your wallet.
        </p>
        {error && (
          <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3.5">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
