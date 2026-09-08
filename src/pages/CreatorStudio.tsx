/**
 * Creator Studio — the SAME Step Flow the shop builds on, run by a customer.
 *
 * David 2026-09-08: "look at our step flow which is really good i wanted our
 * customers to have the same flow on design studio but its diff it needs to
 * match and have mrs imagine on it. please look and mimic minus the etsy step
 * ofc."
 *
 * So it is not a mimic — it is literally the same components (Idea, Design,
 * Garment & Color, Mockups, Listing), the same hex tracker, the same Mrs.
 * Imagine phrase pitches and inspiration breakdown. The differences all live
 * in `customerLane` (components/studio/lane.tsx): five hexes instead of six,
 * the creator-gated `/api/studio` rail instead of the admin one, no team-only
 * print-prep or promo panels, and a finish that SUBMITS FOR REVIEW rather
 * than publishing straight to the storefront.
 *
 * The old talk-to-Mr.-Imagine build is still here, one click away, at
 * /creator/studio/voice (pages/CreatorStudioVoice.tsx).
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Mic, Sparkles, Wallet } from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { apiFetch, customerStepFlow } from '../lib/api'
import StepFlowBuilder from '../components/studio/StepFlowBuilder'
import ResumeBuilds from '../components/studio/ResumeBuilds'
import { StudioLaneProvider, customerLane } from '../components/studio/lane'

interface StudioPricing {
  generate: number
  shots: number
  balance: number
}

export default function CreatorStudio() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [creatorChecked, setCreatorChecked] = useState(false)
  const [pricing, setPricing] = useState<StudioPricing | null>(null)

  const productId = searchParams.get('productId')

  // Creator gate — the opt-in is one click, so a non-creator gets the pitch
  // rather than an error. Same check the voice lane makes.
  useEffect(() => {
    let cancelled = false
    if (!user) return
    apiFetch('/api/creators/me')
      .then((me: any) => {
        if (cancelled) return
        if (!me?.isCreator) navigate('/become-creator', { replace: true })
        else setCreatorChecked(true)
      })
      .catch(() => {
        if (!cancelled) navigate('/become-creator', { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [user, navigate])

  // What the flow charges, shown up front — "not enough ITC" should never be
  // a surprise three steps in.
  useEffect(() => {
    if (!creatorChecked) return
    let cancelled = false
    customerStepFlow
      .pricing()
      .then((p) => {
        if (!cancelled) setPricing(p)
      })
      .catch(() => {
        /* the price line just doesn't render */
      })
    return () => {
      cancelled = true
    }
  }, [creatorChecked, productId])

  const openBuild = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams)
      next.set('productId', id)
      setSearchParams(next)
    },
    [searchParams, setSearchParams]
  )

  if (!creatorChecked) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-sm text-muted">Opening the studio…</p>
      </div>
    )
  }

  return (
    <StudioLaneProvider lane={customerLane}>
      <div className="min-h-screen bg-bg">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl sm:text-4xl font-display font-bold text-text flex items-center gap-3">
                <Sparkles className="w-7 h-7 text-primary" />
                Creator Studio
              </h1>
              <p className="text-sm text-muted mt-2 max-w-xl">
                One idea in, a finished product out — you approve every step. Mrs. Imagine pitches the
                words and reads your inspiration; the shop reviews it before it goes on sale.
              </p>
            </div>

            <div className="flex flex-col items-stretch sm:items-end gap-2">
              {pricing && (
                <div className="rounded-xl border border-border-subtle bg-card/60 px-4 py-3 text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted flex items-center justify-end gap-1.5">
                    <Wallet className="w-3.5 h-3.5" /> ITC balance
                  </p>
                  <p className="text-xl font-display font-bold text-text">{Math.floor(pricing.balance)}</p>
                  <p className="text-[11px] text-muted mt-0.5">
                    {pricing.generate} to draw it · {pricing.shots} for the photos
                  </p>
                </div>
              )}
              <Link
                to="/creator/studio/voice"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-card border border-border-subtle text-text text-sm font-medium hover:bg-card-elevated transition-colors"
              >
                <Mic className="w-3.5 h-3.5" />
                Talk it out with Mr. Imagine instead
              </Link>
            </div>
          </div>

          {/* Mid-build the strip is just noise above the step you're on. */}
          {!productId && <ResumeBuilds onResume={openBuild} />}

          <StepFlowBuilder productId={productId} lane={customerLane} />
        </div>
      </div>
    </StudioLaneProvider>
  )
}
