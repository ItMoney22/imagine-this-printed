// "Create a design" inside her store manager (David 2026-10-26: "she should have create a design right there
// where it goes into the my design step flow"). The same Step Flow ITP's own back end uses, in the customer lane
// (Creator Studio, src/pages/CreatorStudio.tsx), mounted on her page instead of sending her away. Each step is
// charged in ITC by /api/studio itself. The flow's one-tap creator opt-in is shown here, never skipped.
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Palette, Sparkles, Wallet } from 'lucide-react'
import { apiFetch, customerStepFlow } from '../../lib/api'
import StepFlowBuilder from '../../components/studio/StepFlowBuilder'
import ResumeBuilds from '../../components/studio/ResumeBuilds'
import { StudioLaneProvider, customerLane } from '../../components/studio/lane'

export default function StoreDesign({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const productId = searchParams.get('productId') || undefined
  const [creator, setCreator] = useState<'checking' | 'yes' | 'no'>('checking')
  const [joining, setJoining] = useState(false)
  const [pricing, setPricing] = useState<{ generate: number; shots: number; balance: number } | null>(null)

  useEffect(() => {
    if (!open) return
    apiFetch('/api/creators/me').then((me: any) => setCreator(me?.isCreator ? 'yes' : 'no')).catch(() => setCreator('no'))
  }, [open])
  useEffect(() => {
    if (creator === 'yes') customerStepFlow.pricing().then(setPricing).catch(() => {})
  }, [creator, productId])

  const openBuild = useCallback((id: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('productId', id)
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  const join = async () => {
    setJoining(true)
    try {
      await apiFetch('/api/creators/signup', { method: 'POST' })
      setCreator('yes')
    } finally {
      setJoining(false)
    }
  }

  return (
    <section id="design" className="rounded-3xl bg-white border border-[var(--vs-line)] p-4 sm:p-6 scroll-mt-44 md:scroll-mt-28">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-10 h-10 rounded-full grid place-items-center text-white" style={{ background: 'linear-gradient(135deg, var(--vs-primary), var(--vs-pink))' }}><Palette className="w-5 h-5" /></span>
        <div className="flex-1 min-w-0 basis-52">
          <h2 className="vs-display text-2xl sm:text-3xl">Create a design</h2>
          <p className="text-sm text-[var(--vs-muted)]">One idea in, a finished shirt design out. You approve every step.</p>
        </div>
        {pricing && (
          <div className="rounded-xl bg-[var(--vs-page)] px-4 py-2 text-right text-sm">
            <p className="flex items-center justify-end gap-1.5 text-xs text-[var(--vs-muted)]"><Wallet className="w-3.5 h-3.5" /> {Math.floor(pricing.balance).toLocaleString()} ITC</p>
            <p className="font-semibold text-[var(--vs-primary)]">{pricing.generate} ITC to draw it · {pricing.shots} for the photos</p>
          </div>
        )}
        {!open && (
          <button onClick={onOpen} className="vs-btn-solid rounded-full px-6 h-12 font-semibold flex items-center gap-2"><Sparkles className="w-5 h-5" /> Create a design</button>
        )}
      </div>

      {open && (
        <div className="mt-5">
          {creator === 'checking' && <p className="flex items-center gap-2 text-sm text-[var(--vs-muted)]"><Loader2 className="w-4 h-4 animate-spin" /> Opening the design studio…</p>}
          {creator === 'no' && (
            <div className="rounded-2xl bg-[var(--vs-page)] p-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <p className="flex-1 text-sm">
                One tap turns on the design studio for your account. Designs you make here are reviewed by Imagine This Printed before they go on sale, and each step costs a few ITC credits.
              </p>
              <button disabled={joining} onClick={join} className="vs-btn-pink rounded-xl px-5 h-11 font-semibold">{joining ? 'Turning it on…' : 'Turn on the design studio'}</button>
            </div>
          )}
          {creator === 'yes' && (
            <StudioLaneProvider lane={customerLane}>
              {!productId && <ResumeBuilds onResume={openBuild} />}
              <StepFlowBuilder productId={productId} lane={customerLane} />
            </StudioLaneProvider>
          )}
        </div>
      )}
    </section>
  )
}
