import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2, Mic, Send, Sparkles, Square, Volume2, VolumeX, Wallet } from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { apiFetch } from '../lib/api'
import { useMrImagineVoice, type TurnAction } from '../hooks/useMrImagineVoice'

/**
 * Creator Studio — build a real product by talking to Mr. Imagine.
 *
 * Voice lane: his own cloned MiniMax voice via POST /api/creator/studio/turn
 * (dictation → brain → speech). NOT xAI Grok realtime — that stays on the
 * ADMIN studio. David 2026-08-10: the MiniMax voice is the fun one, and the
 * per-utterance billing means an idle tab can't quietly drain the API.
 *
 * Everything is reachable without speaking: type to him, tap designs to pick,
 * press the buttons. The voice is the delight, never the dependency.
 *
 * Backend rail: /api/creator/studio/* — creator-gated, ITC-metered,
 * owner-scoped, ending in SUBMIT FOR REVIEW, never a live publish.
 */

type Lane = 'shirt' | 'metal-art' | '3d-print'
type StepKey = 'type' | 'brief' | 'generate' | 'pick' | 'polish' | 'submit'

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: 'type', label: 'Type' },
  { key: 'brief', label: 'Brief' },
  { key: 'generate', label: 'Generate' },
  { key: 'pick', label: 'Pick' },
  { key: 'polish', label: 'Shots' },
  { key: 'submit', label: 'Submit' },
]

interface Candidate { id: string; url: string; label?: string }
interface MockupAsset { id: string; url: string; label: string }
interface ModelShot { url: string; ok: boolean; label?: string }

interface Brief {
  prompt: string
  style?: string
  tone?: string
  shirtColor: 'black' | 'white' | 'gray'
  printPlacement?: 'front-center' | 'left-pocket' | 'back-only' | 'front-back' | 'pocket-front-back-full'
  printSizeInches?: number
}

interface Pricing { generate: number; buildPerProduct: number; balance: number }

interface BuildState {
  lane: Lane | null
  metalSize: '4x6' | '8x10'
  brief: Brief | null
  productId: string | null
  productName: string | null
  candidates: Candidate[]
  selectedAssetId: string | null
  mockups: MockupAsset[]
  modelShots: ModelShot[]
  siblings: Array<{ productId: string; name: string }>
  generating: boolean
  submitted: boolean
  model3dId: string | null
  concept3dUrl: string | null
  glbUrl: string | null
}

const initialBuild: BuildState = {
  lane: null, metalSize: '4x6', brief: null, productId: null, productName: null,
  candidates: [], selectedAssetId: null, mockups: [], modelShots: [], siblings: [],
  generating: false, submitted: false, model3dId: null, concept3dUrl: null, glbUrl: null,
}

type Action =
  | { type: 'PATCH'; patch: Partial<BuildState> }
  | { type: 'SET_LANE'; lane: Lane; metalSize?: '4x6' | '8x10' }
  | { type: 'GENERATE_STARTED'; productId?: string; productName?: string; model3dId?: string }
  | { type: 'SYNC'; candidates: Candidate[]; mockups: MockupAsset[]; modelShots: ModelShot[]; generating: boolean }
  | { type: 'SELECTED'; assetId: string; siblings: Array<{ productId: string; name: string }> }
  | { type: 'SUBMITTED' }
  | { type: 'RESET' }

function reducer(s: BuildState, a: Action): BuildState {
  switch (a.type) {
    case 'PATCH': return { ...s, ...a.patch }
    case 'SET_LANE': return { ...initialBuild, lane: a.lane, metalSize: a.metalSize || s.metalSize }
    case 'GENERATE_STARTED': return {
      ...s, generating: true, candidates: [], mockups: [], modelShots: [], selectedAssetId: null, siblings: [],
      productId: a.productId ?? s.productId, productName: a.productName ?? s.productName, model3dId: a.model3dId ?? s.model3dId,
    }
    case 'SYNC': return { ...s, candidates: a.candidates, mockups: a.mockups, modelShots: a.modelShots, generating: a.generating }
    case 'SELECTED': return { ...s, selectedAssetId: a.assetId, siblings: a.siblings }
    case 'SUBMITTED': return { ...s, submitted: true, generating: false }
    case 'RESET': return initialBuild
    default: return s
  }
}

function stepDone(b: BuildState, key: StepKey): boolean {
  switch (key) {
    case 'type': return !!b.lane
    case 'brief': return !!b.brief
    case 'generate': return b.lane === '3d-print' ? !!b.concept3dUrl : b.candidates.length > 0
    case 'pick': return !!b.selectedAssetId
    case 'polish': return b.mockups.length > 0 || !!b.glbUrl
    case 'submit': return b.submitted
  }
}

/** His face reacts to what he's doing — the whole point of putting it on screen. */
const FACE: Record<string, string> = {
  idle: '/mr-imagine/mr-imagine-waist-up.png',
  recording: '/mr-imagine/mr-imagine-waist-up.png',
  thinking: '/mr-imagine/mr-imagine-waist-up-thinking.png',
  speaking: '/mr-imagine/mr-imagine-waist-up-happy.png',
}

export default function CreatorStudio() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [build, dispatch] = useReducer(reducer, initialBuild)
  const [creatorChecked, setCreatorChecked] = useState(false)
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [manualPicks, setManualPicks] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')

  const buildRef = useRef(build)
  buildRef.current = build
  const announcedRef = useRef<Set<string>>(new Set())

  // Creator gate — non-creators get the (one-click) signup pitch.
  useEffect(() => {
    let cancelled = false
    if (!user) return
    apiFetch('/api/creators/me')
      .then((me: any) => {
        if (cancelled) return
        if (!me?.isCreator) navigate('/become-creator', { replace: true })
        else setCreatorChecked(true)
      })
      .catch(() => { if (!cancelled) navigate('/become-creator', { replace: true }) })
    return () => { cancelled = true }
  }, [user, navigate])

  const refreshPricing = useCallback(async () => {
    try {
      const p = await apiFetch('/api/creator/studio/pricing') as Pricing
      setPricing(p)
      return p
    } catch { return null }
  }, [])
  useEffect(() => { if (creatorChecked) void refreshPricing() }, [creatorChecked, refreshPricing])

  // ---- the money moves Mr. Imagine asks for; the ITC-metered endpoints run them
  const runGenerate = useCallback(async () => {
    const b = buildRef.current
    if (!b.lane || !b.brief) return
    setBusy(true); setPageError(null); announcedRef.current.clear()
    try {
      if (b.lane === '3d-print') {
        const style3d = /cartoon|toy|cute|chibi/i.test(`${b.brief.style || ''} ${b.brief.prompt}`) ? 'cartoon' : 'realistic'
        const data = await apiFetch('/api/3d-models/create', {
          method: 'POST', body: JSON.stringify({ prompt: b.brief.prompt, style: style3d }),
        }) as { model?: { id: string } }
        if (!data?.model?.id) throw new Error('3D concept could not start')
        dispatch({ type: 'GENERATE_STARTED', model3dId: data.model.id })
      } else {
        const res = await apiFetch('/api/creator/studio/create', {
          method: 'POST',
          body: JSON.stringify({
            prompt: b.brief.prompt, style: b.brief.style, tone: b.brief.tone,
            category: b.lane === 'metal-art' ? 'metal-art' : 'shirts',
            productType: 'tshirt', shirtColor: b.brief.shirtColor,
            printPlacement: b.brief.printPlacement, printSizeInches: b.brief.printSizeInches,
            metalSize: b.lane === 'metal-art' ? b.metalSize : undefined,
          }),
        }) as { productId?: string; product?: { name?: string } }
        if (!res?.productId) throw new Error('Generation could not start')
        dispatch({ type: 'GENERATE_STARTED', productId: res.productId, productName: res.product?.name })
      }
      void refreshPricing()
    } catch (e: any) {
      setPageError(e?.message || 'Generation failed')
    } finally { setBusy(false) }
  }, [refreshPricing])

  const runSelect = useCallback(async (assetIds: string[]) => {
    const b = buildRef.current
    if (!b.productId || assetIds.length === 0) return
    setBusy(true); setPageError(null)
    try {
      const response = await apiFetch(`/api/creator/studio/${b.productId}/select-image`, {
        method: 'POST',
        body: JSON.stringify({ selectedAssetId: assetIds[0], selectedAssetIds: assetIds }),
      }) as { siblings?: Array<{ productId: string; name: string }> }
      dispatch({ type: 'SELECTED', assetId: assetIds[0], siblings: Array.isArray(response?.siblings) ? response.siblings : [] })
      setManualPicks([])
      void refreshPricing()
    } catch (e: any) {
      setPageError(e?.message || 'Build failed')
    } finally { setBusy(false) }
  }, [refreshPricing])

  const runSubmit = useCallback(async () => {
    const b = buildRef.current
    if (b.lane === '3d-print') { dispatch({ type: 'SUBMITTED' }); return }
    if (!b.productId || b.mockups.length === 0) return
    setBusy(true); setPageError(null)
    try {
      await apiFetch(`/api/creator/studio/${b.productId}/submit`, { method: 'POST', body: '{}' })
      dispatch({ type: 'SUBMITTED' })
    } catch (e: any) {
      setPageError(e?.message || 'Submit failed')
    } finally { setBusy(false) }
  }, [])

  // ---- the voice
  const getVoiceState = useCallback(() => {
    const b = buildRef.current
    return {
      lane: b.lane, metalSize: b.metalSize, brief: b.brief,
      candidateCount: b.candidates.length,
      selectedAssetId: b.selectedAssetId,
      mockupCount: b.mockups.length,
      modelShotCount: b.modelShots.length,
      submitted: b.submitted, generating: b.generating,
    }
  }, [])

  const onStatePatch = useCallback((patch: Record<string, unknown>) => {
    if (patch.lane) {
      dispatch({ type: 'SET_LANE', lane: patch.lane as Lane, metalSize: patch.metalSize as '4x6' | '8x10' | undefined })
      announcedRef.current.clear()
    }
    if (patch.brief) dispatch({ type: 'PATCH', patch: { brief: patch.brief as Brief } })
    if (patch.metalSize && !patch.lane) dispatch({ type: 'PATCH', patch: { metalSize: patch.metalSize as '4x6' | '8x10' } })
    if (patch.pricing) setPricing(patch.pricing as Pricing)
  }, [])

  const onAction = useCallback(async (action: TurnAction) => {
    if (action.name === 'generate_designs') return runGenerate()
    if (action.name === 'submit_product') return runSubmit()
    if (action.name === 'select_designs') {
      const idxs = Array.isArray(action.args?.indexes) ? (action.args.indexes as unknown[]).map(Number) : []
      const b = buildRef.current
      const ids = Array.from(new Set(idxs))
        .filter((i) => Number.isFinite(i) && i >= 1 && i <= b.candidates.length)
        .map((i) => b.candidates[i - 1].id)
      if (ids.length > 0) return runSelect(ids)
      setPageError(`Pick a number between 1 and ${b.candidates.length}`)
    }
  }, [runGenerate, runSelect, runSubmit])

  const voice = useMrImagineVoice({ getState: getVoiceState, onAction, onStatePatch })

  // ---- polling: 2D pipeline
  const pollPipeline = useCallback(async () => {
    const b = buildRef.current
    if (!b.productId || b.lane === '3d-print') return
    try {
      const data = await apiFetch(`/api/creator/studio/${b.productId}/status`) as {
        product?: { metadata?: Record<string, unknown> }
        assets?: Array<{ id: string; kind: string; url: string; asset_role?: string; metadata?: Record<string, unknown> }>
        jobs?: Array<{ id: string; type: string; status: string }>
      }
      const assets = data.assets || []
      const jobs = data.jobs || []
      const terminal = (j: { status: string }) => ['succeeded', 'failed', 'skipped'].includes(j.status)
      const imageJobs = jobs.filter((j) => j.type.startsWith('replicate_image'))
      const mockupJobs = jobs.filter((j) => j.type.startsWith('replicate_mockup'))

      const candidates: Candidate[] = assets.filter((a) => a.kind === 'source')
        .map((a) => ({ id: a.id, url: a.url, label: String(a.metadata?.model_id ?? '').split('/').pop() || undefined }))
      const mockups: MockupAsset[] = assets.filter((a) => a.kind === 'mockup' || a.asset_role?.startsWith('mockup_'))
        .map((a) => ({
          id: a.id, url: a.url,
          label: a.asset_role === 'mockup_ghost_mannequin' ? 'Product shot'
            : a.asset_role === 'mockup_flat_lay' ? 'Flat lay'
            : a.asset_role === 'mockup_back' ? 'Back view'
            : a.asset_role === 'mockup_pocket' ? 'Pocket scale'
            : a.asset_role === 'mockup_mr_imagine' ? 'Mr. Imagine'
            : a.asset_role?.startsWith('mockup_model') ? 'Model photo' : 'Mockup',
        }))
      const shots = ((data.product?.metadata || {}) as any).etsy_shots as { status?: string; images?: string[]; cast?: string[]; checks?: Array<{ ok?: boolean }> } | undefined
      const modelShots: ModelShot[] = (shots?.images || []).map((url, i) => ({
        url, ok: shots?.checks?.[i]?.ok !== false, label: shots?.cast?.[i],
      }))

      dispatch({
        type: 'SYNC', candidates, mockups, modelShots,
        generating: jobs.some((j) => !terminal(j)) || shots?.status === 'generating',
      })

      const announce = (key: string, text: string) => {
        if (announcedRef.current.has(key)) return
        announcedRef.current.add(key)
        voice.sendText(`[STUDIO UPDATE — react to this in one short line, do not call a tool] ${text}`)
      }

      if (imageJobs.length > 0 && imageJobs.every(terminal)) {
        if (candidates.length > 0) {
          announce('candidates', `The designs just landed — ${candidates.length} of them, numbered 1 to ${candidates.length} on screen. Ask which ones they love; they can pick more than one.`)
        } else {
          announce('genfail', 'Every design model failed this run and their ITC was refunded. Apologise and offer to try again with a tweak.')
        }
      }
      if (mockupJobs.length > 0 && mockupJobs.every(terminal) && mockups.length > 0) {
        announce(`mockups:${mockups.length}`, `The product shots are in — ${mockups.length} of them on the board. React, then tell them they can submit for review.`)
      }
      if (shots?.status === 'ready' && modelShots.length > 0) {
        announce('shots', 'The real-person model photos just landed — actual people wearing their design. Big moment.')
      }
    } catch { /* transient — next tick retries */ }
  }, [voice])

  useEffect(() => {
    if (!build.productId || build.lane === '3d-print' || build.submitted) return
    const iv = setInterval(() => { void pollPipeline() }, 4000)
    return () => clearInterval(iv)
  }, [build.productId, build.lane, build.submitted, pollPipeline])

  // ---- polling: 3D lane
  useEffect(() => {
    if (!build.model3dId || build.lane !== '3d-print' || build.submitted) return
    const iv = setInterval(async () => {
      try {
        const data = await apiFetch(`/api/3d-models/${build.model3dId}`) as { model?: { status: string; concept_image_url?: string; glb_url?: string } }
        const m = data.model
        if (!m) return
        if (m.concept_image_url && !buildRef.current.concept3dUrl) {
          dispatch({ type: 'PATCH', patch: { concept3dUrl: m.concept_image_url, generating: false } })
        }
        if (m.glb_url && !buildRef.current.glbUrl) {
          dispatch({ type: 'PATCH', patch: { glbUrl: m.glb_url, generating: false } })
        }
      } catch { /* transient */ }
    }, 5000)
    return () => clearInterval(iv)
  }, [build.model3dId, build.lane, build.submitted])

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault()
    if (!typed.trim() || voice.isBusy) return
    voice.sendText(typed)
    setTyped('')
  }

  if (!user) {
    return <div className="min-h-[60vh] flex items-center justify-center"><p className="text-muted">Sign in to enter the studio.</p></div>
  }
  if (!creatorChecked) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
  }

  const listening = voice.status === 'recording'
  const lastReply = [...voice.conversation].reverse().find((t) => t.role === 'assistant')?.content
  const buildCost = pricing ? pricing.buildPerProduct * Math.max(1, manualPicks.length) : null

  return (
    <div className="min-h-screen bg-bg text-text py-6 sm:py-8 relative overflow-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px] opacity-50 mix-blend-screen" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-[128px] opacity-50 mix-blend-screen" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-400 to-secondary font-tech tracking-wide">
            CREATOR STUDIO
          </h1>
          <p className="text-muted">Talk it out with Mr. Imagine — shirts, metal art, 3D prints. Your design, your royalty.</p>
          {pricing && (
            <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-2 text-sm text-muted bg-card/50 border border-white/10 rounded-full px-4 py-1.5">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="text-text font-semibold">{Math.floor(pricing.balance)} ITC</span>
              <span>· designs {pricing.generate} · build {pricing.buildPerProduct}/product</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
          {STEPS.map((st) => {
            const done = stepDone(build, st.key)
            return (
              <span key={st.key} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${done ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-card/40 border-white/10 text-muted'}`}>
                {done && <Check className="w-3 h-3" />}{st.label}
              </span>
            )
          })}
        </div>

        <div className="grid lg:grid-cols-[360px_1fr] gap-6">
          {/* ---------- Mr. Imagine, on the side ---------- */}
          <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-5 h-fit lg:sticky lg:top-6">
            <div className="relative flex justify-center mb-3">
              {/* glow reacts to what he's doing */}
              <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-500 ${voice.status === 'idle' ? 'opacity-30' : 'opacity-90'}`}>
                <div className={`w-40 h-40 rounded-full blur-3xl ${
                  listening ? 'bg-emerald-400/50' : voice.status === 'thinking' ? 'bg-amber-400/40' : voice.status === 'speaking' ? 'bg-primary/60' : 'bg-primary/30'
                }`} />
              </div>
              {listening && (
                <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="w-36 h-36 rounded-full border-2 border-emerald-400/60 animate-ping" />
                </span>
              )}
              <img
                src={FACE[voice.status] || FACE.idle}
                alt="Mr. Imagine"
                className={`relative w-44 h-44 object-contain drop-shadow-[0_0_25px_rgba(168,85,247,0.35)] transition-transform duration-300 ${voice.status === 'speaking' ? 'animate-float scale-105' : ''}`}
                onError={(e) => { (e.target as HTMLImageElement).src = '/mr-imagine/mr-imagine-waving.png' }}
              />
            </div>

            {/* what he just said */}
            <div className="min-h-[64px] mb-3">
              {lastReply ? (
                <div className="bg-bg/50 border border-white/10 rounded-2xl px-4 py-3">
                  <p className="text-sm text-text leading-relaxed">{lastReply}</p>
                  {voice.status === 'speaking' && (
                    <span className="inline-flex gap-1 mt-2">
                      {[0, 150, 300].map((d) => (
                        <span key={d} className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted text-center px-2">
                  Tap the mic and tell me what you want to make.
                </p>
              )}
            </div>

            <button
              onClick={voice.toggleRecording}
              disabled={voice.isBusy}
              className={`w-full font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
                listening
                  ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-200'
                  : 'bg-gradient-to-r from-primary to-secondary text-white shadow-lg shadow-primary/30'
              }`}
            >
              {voice.status === 'thinking' ? (<><Loader2 className="w-5 h-5 animate-spin" /> Thinking…</>)
                : voice.status === 'speaking' ? (<><Volume2 className="w-5 h-5" /> Speaking…</>)
                : listening ? (<><Square className="w-4 h-4" /> Tap to send</>)
                : (<><Mic className="w-5 h-5" /> Talk to Mr. Imagine</>)}
            </button>

            {/* typing always works — quiet rooms, denied mics, or preference */}
            <form onSubmit={submitTyped} className="mt-2 flex gap-2">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="…or type to him"
                disabled={voice.isBusy}
                className="flex-1 bg-bg/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-text placeholder:text-muted/70 focus:outline-none focus:border-primary/50 disabled:opacity-50"
              />
              <button type="submit" disabled={voice.isBusy || !typed.trim()}
                className="px-3 rounded-xl bg-bg/60 border border-white/10 text-muted hover:text-text disabled:opacity-40">
                <Send className="w-4 h-4" />
              </button>
            </form>

            <div className="mt-2 flex items-center justify-between text-xs">
              <button onClick={() => voice.setMuted(!voice.muted)} className="inline-flex items-center gap-1.5 text-muted hover:text-text transition-colors">
                {voice.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                {voice.muted ? 'Voice off' : 'Voice on'}
              </button>
              {busy && <span className="text-muted inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> working…</span>}
            </div>

            {(voice.error || pageError) && (
              <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                <p className="text-red-400 text-xs">{voice.error || pageError}</p>
              </div>
            )}
          </div>

          {/* ---------- the board ---------- */}
          <div className="space-y-6">
            {!build.lane && (
              <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-10 text-center">
                <Sparkles className="w-10 h-10 text-primary mx-auto mb-4" />
                <p className="text-lg text-text font-semibold mb-1">Say what you want to make.</p>
                <p className="text-muted text-sm">"A shirt for my fishing club" · "Metal art of a desert sunset" · "A little dragon 3D print"</p>
              </div>
            )}

            {build.brief && (
              <div className="bg-card/30 backdrop-blur-md rounded-2xl border border-white/10 p-4">
                <p className="text-xs text-muted uppercase tracking-wide mb-1">The brief{build.productName ? ` — ${build.productName}` : ''}</p>
                <p className="text-sm text-text">{build.brief.prompt}</p>
                {(build.brief.printPlacement || build.brief.printSizeInches) && (
                  <p className="text-xs text-muted mt-2">
                    {build.brief.printPlacement === 'front-back' ? 'Printed front + back' : build.brief.printPlacement ? `Placement: ${build.brief.printPlacement.replace(/-/g, ' ')}` : ''}
                    {build.brief.printSizeInches ? ` · ${build.brief.printSizeInches}″ print` : ''}
                  </p>
                )}
              </div>
            )}

            {build.generating && build.candidates.length === 0 && !build.concept3dUrl && (
              <div className="bg-card/30 backdrop-blur-md rounded-2xl border border-white/10 p-8 text-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
                <p className="text-muted text-sm">{build.lane === '3d-print' ? 'Sketching the 3D concept…' : 'Four AI models are painting…'}</p>
              </div>
            )}

            {build.candidates.length > 0 && !build.selectedAssetId && (
              <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-5">
                <p className="text-sm text-muted mb-3">Say the numbers you love — or tap them. Every pick becomes its own product.</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {build.candidates.map((c, i) => {
                    const picked = manualPicks.includes(c.id)
                    return (
                      <button key={c.id}
                        onClick={() => setManualPicks((p) => p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id])}
                        className={`relative rounded-2xl overflow-hidden border transition-all text-left ${picked ? 'border-primary ring-2 ring-primary/50' : 'border-white/10 hover:border-primary/40'}`}>
                        <img src={c.url} alt={`Design ${i + 1}`} className="w-full aspect-square object-contain bg-bg/60" />
                        <span className="absolute top-2 left-2 bg-bg/80 text-text text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center border border-white/20">{i + 1}</span>
                        {picked && <span className="absolute top-2 right-2 bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center"><Check className="w-3.5 h-3.5" /></span>}
                      </button>
                    )
                  })}
                </div>
                {manualPicks.length > 0 && (
                  <button onClick={() => void runSelect(manualPicks)} disabled={busy}
                    className="mt-4 w-full bg-gradient-to-r from-primary to-secondary text-white font-bold py-3 rounded-xl shadow-lg shadow-primary/30 disabled:opacity-40 flex items-center justify-center gap-2">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Build {manualPicks.length} product{manualPicks.length > 1 ? 's' : ''}{buildCost ? ` (${buildCost} ITC)` : ''}
                  </button>
                )}
              </div>
            )}

            {build.siblings.length > 0 && (
              <div className="bg-secondary/10 border border-secondary/30 rounded-2xl p-4">
                <p className="text-sm text-text font-semibold mb-1">{build.siblings.length} more product{build.siblings.length > 1 ? 's' : ''} building from your other picks</p>
                <p className="text-xs text-muted">{build.siblings.map((s) => s.name).join(' · ')} — find them in My Designs once their shots land.</p>
              </div>
            )}

            {build.concept3dUrl && (
              <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-5">
                <p className="text-sm text-muted mb-3">{build.glbUrl ? 'Printable model ready!' : 'Your 3D concept'}</p>
                <img src={build.concept3dUrl} alt="3D concept" className="w-full max-w-sm mx-auto rounded-2xl border border-white/10" />
                {/* Approving a concept and picking a print size (each tier has its
                    own ITC price) is a whole flow that already exists — and works —
                    in the Toy Creator. Hand off rather than half-rebuild it here. */}
                {!build.glbUrl && (
                  <button
                    onClick={() => navigate('/toy-creator')}
                    className="mt-4 w-full bg-gradient-to-r from-primary to-secondary text-white font-bold py-3 rounded-xl shadow-lg shadow-primary/30 transition-all"
                  >
                    Finish it in the Toy Creator →
                  </button>
                )}
                <p className="text-xs text-muted mt-2 text-center">
                  That's where you approve the concept and pick a print size.
                </p>
              </div>
            )}

            {(build.mockups.length > 0 || build.modelShots.length > 0) && (
              <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-5">
                <p className="text-sm text-muted mb-3">Your product shots{build.generating ? ' — more still rendering…' : ''}</p>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {build.mockups.map((m) => (
                    <figure key={m.id} className="rounded-2xl overflow-hidden border border-white/10 bg-bg/40">
                      <img src={m.url} alt={m.label} className="w-full aspect-square object-cover" />
                      <figcaption className="text-[11px] text-muted px-2 py-1">{m.label}</figcaption>
                    </figure>
                  ))}
                  {build.modelShots.map((m, i) => (
                    <figure key={`shot-${i}`} className={`rounded-2xl overflow-hidden border bg-bg/40 ${m.ok ? 'border-white/10' : 'border-amber-500/40'}`}>
                      <img src={m.url} alt={m.label || 'Model photo'} className="w-full aspect-square object-cover" />
                      <figcaption className="text-[11px] text-muted px-2 py-1">{m.label || 'Model photo'}{!m.ok ? ' · flagged' : ''}</figcaption>
                    </figure>
                  ))}
                </div>
                {!build.submitted && build.mockups.length > 0 && (
                  <button onClick={() => void runSubmit()} disabled={busy}
                    className="mt-4 w-full bg-gradient-to-r from-emerald-500 to-green-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-emerald-500/30 disabled:opacity-40 flex items-center justify-center gap-2">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Submit for review
                  </button>
                )}
              </div>
            )}

            {build.submitted && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-3xl p-8 text-center">
                <Check className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                <p className="text-lg font-semibold text-text mb-1">
                  {build.lane === '3d-print' ? 'Saved to your 3D library!' : 'Sent to the print shop!'}
                </p>
                <p className="text-muted text-sm mb-4">
                  {build.lane === '3d-print'
                    ? 'Find it under My Designs → 3D models.'
                    : 'A human reviews every product before it goes live — usually within a day. You earn your royalty from the very first sale.'}
                </p>
                <button onClick={() => { announcedRef.current.clear(); dispatch({ type: 'RESET' }) }}
                  className="bg-card/60 border border-white/10 hover:border-primary/40 text-text font-semibold px-6 py-2.5 rounded-xl transition-all">
                  Build another
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
