/**
 * StepFlowStudio — the step flow, as a drop-in component.
 *
 * The shape it keeps, because this is the part that works: a step rail so the
 * person always knows where they are, a mascot who talks them through it, and
 * ONE board that only ever shows the thing they have to deal with next.
 *
 *   Type -> Brief -> Generate -> Pick -> Shots -> Submit
 *
 * Everything specific to a site — the mascot, the words, the lanes, the API —
 * arrives as props. See types.ts for the three contracts and README.md for a
 * worked example.
 *
 * Two rules this component enforces on every host:
 *   1. Never spend without saying the cost first. The mascot's reply is spoken
 *      BEFORE his action runs, and the build button carries its own price.
 *   2. No spinners. Every wait is a progress bar with a stage and elapsed time.
 */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import ProgressBar from './ProgressBar'
import { useStudioVoice } from './useStudioVoice'
import {
  CheckIcon, MicIcon, SendIcon, SparkleIcon, SpeakerOffIcon, SpeakerOnIcon, StopIcon, WalletIcon,
} from './icons'
import type {
  StepFlowStudioProps,
  StudioBrief,
  StudioCandidate,
  StudioLane,
  StudioPricing,
  StudioShot,
  StudioStep,
  StudioTurnAction,
} from './types'

const DEFAULT_STEPS: StudioStep[] = [
  { key: 'type', label: 'Type' },
  { key: 'brief', label: 'Brief' },
  { key: 'generate', label: 'Generate' },
  { key: 'pick', label: 'Pick' },
  { key: 'shots', label: 'Shots' },
  { key: 'submit', label: 'Submit' },
]

interface BuildState {
  lane: string | null
  /** Lane-level choices the mascot set, e.g. a panel size. Passed to create. */
  options: Record<string, unknown>
  brief: StudioBrief | null
  id: string | null
  name: string | null
  candidates: StudioCandidate[]
  selectedAssetId: string | null
  shots: StudioShot[]
  siblings: Array<{ id: string; name: string }>
  generating: boolean
  submitted: boolean
  /** preview-handoff lanes */
  previewId: string | null
  previewUrl: string | null
  previewDone: boolean
  /** Drives the elapsed clock on every progress bar. */
  startedAt: number | null
}

const initialBuild: BuildState = {
  lane: null, options: {}, brief: null, id: null, name: null,
  candidates: [], selectedAssetId: null, shots: [], siblings: [],
  generating: false, submitted: false,
  previewId: null, previewUrl: null, previewDone: false, startedAt: null,
}

type Action =
  | { type: 'PATCH'; patch: Partial<BuildState> }
  | { type: 'SET_LANE'; lane: string; options?: Record<string, unknown> }
  | { type: 'GENERATE_STARTED'; id?: string; name?: string; previewId?: string }
  | { type: 'SYNC'; candidates: StudioCandidate[]; shots: StudioShot[]; generating: boolean; name?: string }
  | { type: 'SELECTED'; assetId: string; siblings: Array<{ id: string; name: string }> }
  | { type: 'SUBMITTED' }
  | { type: 'RESET' }

function reducer(s: BuildState, a: Action): BuildState {
  switch (a.type) {
    case 'PATCH': return { ...s, ...a.patch }
    // A new product type restarts the build — anything on the board belonged
    // to the old one.
    case 'SET_LANE': return { ...initialBuild, lane: a.lane, options: { ...s.options, ...(a.options || {}) } }
    case 'GENERATE_STARTED': return {
      ...s, generating: true, candidates: [], shots: [], selectedAssetId: null, siblings: [],
      startedAt: Date.now(),
      id: a.id ?? s.id, name: a.name ?? s.name, previewId: a.previewId ?? s.previewId,
    }
    case 'SYNC': return {
      ...s, candidates: a.candidates, shots: a.shots, generating: a.generating,
      name: a.name ?? s.name,
    }
    case 'SELECTED': return { ...s, selectedAssetId: a.assetId, siblings: a.siblings, startedAt: Date.now() }
    case 'SUBMITTED': return { ...s, submitted: true, generating: false }
    case 'RESET': return initialBuild
    default: return s
  }
}

export function StepFlowStudio({
  brand,
  lanes,
  adapter,
  steps = DEFAULT_STEPS,
  pollMs = 4000,
  maxPicks = 4,
  footer,
  onSubmitted,
  onBuildStarted,
}: StepFlowStudioProps) {
  const [build, dispatch] = useReducer(reducer, initialBuild)
  const [pricing, setPricing] = useState<StudioPricing | null>(null)
  const [manualPicks, setManualPicks] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')

  const buildRef = useRef(build)
  buildRef.current = build
  const announcedRef = useRef<Set<string>>(new Set())
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter

  const copy = brand.copy || {}
  const lane: StudioLane | null = useMemo(
    () => lanes.find((l) => l.key === build.lane) || null,
    [lanes, build.lane],
  )
  const isHandoffLane = lane?.kind === 'preview-handoff'

  const money = useCallback(
    (n: number) => (brand.currency ? `${n} ${brand.currency}` : String(n)),
    [brand.currency],
  )

  const stepDone = useCallback((key: string): boolean => {
    const b = buildRef.current
    switch (key) {
      case 'type': return !!b.lane
      case 'brief': return !!b.brief
      case 'generate': return isHandoffLane ? !!b.previewUrl : b.candidates.length > 0
      case 'pick': return !!b.selectedAssetId
      case 'shots': return b.shots.length > 0 || b.previewDone
      case 'submit': return b.submitted
      default: return false
    }
  }, [isHandoffLane])

  const refreshPricing = useCallback(async () => {
    if (!adapterRef.current.getPricing) return null
    try {
      const p = await adapterRef.current.getPricing()
      setPricing(p)
      return p
    } catch { return null }
  }, [])
  useEffect(() => { void refreshPricing() }, [refreshPricing])

  // ---- the money moves the mascot asks for
  const runGenerate = useCallback(async () => {
    const b = buildRef.current
    if (!b.lane || !b.brief) return
    const laneCfg = lanes.find((l) => l.key === b.lane)
    setBusy(true); setPageError(null); announcedRef.current.clear()
    try {
      const input = { lane: b.lane, brief: b.brief, options: b.options }
      if (laneCfg?.kind === 'preview-handoff') {
        if (!adapterRef.current.createPreview) throw new Error('This lane is not wired up yet')
        const res = await adapterRef.current.createPreview(input)
        if (!res?.id) throw new Error('Generation could not start')
        dispatch({ type: 'GENERATE_STARTED', previewId: res.id })
      } else {
        const res = await adapterRef.current.create(input)
        if (!res?.id) throw new Error('Generation could not start')
        dispatch({ type: 'GENERATE_STARTED', id: res.id, name: res.name })
        onBuildStarted?.(res.id)
      }
      void refreshPricing()
    } catch (e: any) {
      setPageError(e?.message || 'Generation failed')
    } finally { setBusy(false) }
  }, [lanes, onBuildStarted, refreshPricing])

  const runSelect = useCallback(async (assetIds: string[]) => {
    const b = buildRef.current
    if (!b.id || assetIds.length === 0) return
    setBusy(true); setPageError(null)
    try {
      const res = await adapterRef.current.select(b.id, assetIds)
      dispatch({
        type: 'SELECTED',
        assetId: assetIds[0],
        siblings: Array.isArray(res?.siblings) ? res.siblings : [],
      })
      setManualPicks([])
      void refreshPricing()
    } catch (e: any) {
      setPageError(e?.message || 'Build failed')
    } finally { setBusy(false) }
  }, [refreshPricing])

  const runSubmit = useCallback(async () => {
    const b = buildRef.current
    const laneCfg = lanes.find((l) => l.key === b.lane)
    // A handoff lane has nothing of its own to submit — the person finishes it
    // wherever the handoff sent them.
    if (laneCfg?.kind === 'preview-handoff') { dispatch({ type: 'SUBMITTED' }); return }
    if (!b.id || b.shots.length === 0) return
    setBusy(true); setPageError(null)
    try {
      await adapterRef.current.submit(b.id)
      dispatch({ type: 'SUBMITTED' })
      onSubmitted?.(b.id)
    } catch (e: any) {
      setPageError(e?.message || 'Submit failed')
    } finally { setBusy(false) }
  }, [lanes, onSubmitted])

  // ---- the voice
  const getVoiceState = useCallback(() => {
    const b = buildRef.current
    return {
      lane: b.lane,
      ...b.options,
      brief: b.brief,
      candidateCount: b.candidates.length,
      selectedAssetId: b.selectedAssetId,
      mockupCount: b.shots.length,
      submitted: b.submitted,
      generating: b.generating,
    }
  }, [])

  const onStatePatch = useCallback((patch: Record<string, unknown>) => {
    const { lane: nextLane, brief, pricing: nextPricing, ...rest } = patch
    if (nextLane) {
      dispatch({ type: 'SET_LANE', lane: String(nextLane), options: rest })
      announcedRef.current.clear()
    } else if (Object.keys(rest).length > 0) {
      dispatch({ type: 'PATCH', patch: { options: { ...buildRef.current.options, ...rest } } })
    }
    if (brief) dispatch({ type: 'PATCH', patch: { brief: brief as StudioBrief } })
    if (nextPricing) setPricing(nextPricing as StudioPricing)
  }, [])

  const onAction = useCallback(async (action: StudioTurnAction) => {
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

  const voice = useStudioVoice({
    adapter,
    getState: getVoiceState,
    onAction,
    onStatePatch,
    mutePreferenceKey: brand.mutePreferenceKey,
  })
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  /** Have the mascot react to a board moment, at most once per key. */
  const announce = useCallback((key: string, text: string) => {
    if (announcedRef.current.has(key)) return
    announcedRef.current.add(key)
    voiceRef.current.nudge(`[STUDIO UPDATE — react to this in one short line, do not call a tool] ${text}`)
  }, [])

  // ---- polling: the standard pipeline
  const pollPipeline = useCallback(async () => {
    const b = buildRef.current
    if (!b.id) return
    try {
      const s = await adapterRef.current.status(b.id)
      dispatch({
        type: 'SYNC',
        candidates: s.candidates || [],
        shots: s.shots || [],
        generating: !!s.generating,
        name: s.productName,
      })

      if (!s.generating) {
        if (s.candidates.length > 0) {
          announce('candidates', `The designs just landed — ${s.candidates.length} of them, numbered 1 to ${s.candidates.length} on screen. Ask which ones they love; they can pick more than one.`)
        } else if (!b.selectedAssetId) {
          announce('genfail', 'Every design model failed this run and their credits were refunded. Apologise and offer to try again with a tweak.')
        }
      }
      if (s.shots.length > 0) {
        announce(`shots:${s.shots.length}`, `The product shots are in — ${s.shots.length} of them on the board. React, then tell them they can submit.`)
      }
      for (const a of s.announcements || []) announce(a.key, a.text)
    } catch { /* transient — the next tick retries */ }
  }, [announce])

  useEffect(() => {
    if (!build.id || build.submitted) return
    const iv = setInterval(() => { void pollPipeline() }, pollMs)
    return () => clearInterval(iv)
  }, [build.id, build.submitted, pollMs, pollPipeline])

  // ---- polling: a preview-handoff lane
  useEffect(() => {
    if (!build.previewId || build.submitted || !adapter.pollPreview) return
    const iv = setInterval(async () => {
      try {
        const p = await adapterRef.current.pollPreview!(build.previewId!)
        if (p.imageUrl && !buildRef.current.previewUrl) {
          dispatch({ type: 'PATCH', patch: { previewUrl: p.imageUrl, generating: false } })
        }
        if (p.done && !buildRef.current.previewDone) {
          dispatch({ type: 'PATCH', patch: { previewDone: true, generating: false } })
        }
      } catch { /* transient */ }
    }, Math.max(pollMs, 5000))
    return () => clearInterval(iv)
  }, [build.previewId, build.submitted, adapter.pollPreview, pollMs])

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault()
    if (!typed.trim() || voice.isBusy) return
    voice.sendText(typed)
    setTyped('')
  }

  const listening = voice.status === 'recording'
  const lastReply = [...voice.conversation].reverse().find((t) => t.role === 'assistant')?.content
  const buildCost = pricing ? pricing.buildPerProduct * Math.max(1, manualPicks.length) : null
  const mascotSrc = brand.mascotImages[voice.status] || brand.mascotImages.idle

  const micLabel = voice.status === 'thinking' ? (copy.micThinking || 'Thinking…')
    : voice.status === 'speaking' ? (copy.micSpeaking || 'Speaking…')
    : listening ? (copy.micRecording || 'Tap to send')
    : (copy.micIdle || `Talk to ${brand.mascotName}`)

  return (
    <div className="relative">
      <div className="mb-6 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-400 to-secondary font-tech tracking-wide">
          {brand.title}
        </h1>
        {brand.tagline && <p className="text-muted">{brand.tagline}</p>}
        {pricing && (
          <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-2 text-sm text-muted bg-card/50 border border-white/10 rounded-full px-4 py-1.5">
            <WalletIcon className="w-4 h-4 text-primary" />
            <span className="text-text font-semibold">{money(Math.floor(pricing.balance))}</span>
            <span>· designs {pricing.generate} · build {pricing.buildPerProduct}/product</span>
          </div>
        )}
      </div>

      {/* the rail */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
        {steps.map((st) => {
          const done = stepDone(st.key)
          return (
            <span
              key={st.key}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
                done ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-card/40 border-white/10 text-muted'
              }`}
            >
              {done && <CheckIcon className="w-3 h-3" />}{st.label}
            </span>
          )
        })}
      </div>

      <div className="grid lg:grid-cols-[360px_1fr] gap-6">
        {/* ---------- the mascot, on the side ---------- */}
        <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-5 h-fit lg:sticky lg:top-6">
          <div className="relative flex justify-center mb-3">
            {/* the glow reacts to what he is doing */}
            <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-500 ${voice.status === 'idle' ? 'opacity-30' : 'opacity-90'}`}>
              <div className={`w-40 h-40 rounded-full blur-3xl ${
                listening ? 'bg-emerald-400/50'
                  : voice.status === 'thinking' ? 'bg-amber-400/40'
                  : voice.status === 'speaking' ? 'bg-primary/60'
                  : 'bg-primary/30'
              }`} />
            </div>
            {listening && (
              <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="w-36 h-36 rounded-full border-2 border-emerald-400/60 animate-ping" />
              </span>
            )}
            <img
              src={mascotSrc}
              alt={brand.mascotName}
              className={`relative w-44 h-44 object-contain drop-shadow-[0_0_25px_rgba(168,85,247,0.35)] transition-transform duration-300 ${voice.status === 'speaking' ? 'scale-105' : ''}`}
              onError={(e) => {
                if (brand.mascotFallbackImage) (e.target as HTMLImageElement).src = brand.mascotFallbackImage
              }}
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
                {copy.idlePrompt || `Tap the mic and tell ${brand.mascotName} what you want to make.`}
              </p>
            )}
          </div>

          {voice.supported && (
            <button
              onClick={voice.toggleRecording}
              disabled={voice.isBusy}
              className={`w-full font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
                listening
                  ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-200'
                  : 'bg-gradient-to-r from-primary to-secondary text-white shadow-lg shadow-primary/30'
              }`}
            >
              {listening ? <StopIcon className="w-4 h-4" /> : <MicIcon className="w-5 h-5" />}
              {micLabel}
            </button>
          )}

          {/* typing always works — quiet rooms, denied mics, or preference */}
          <form onSubmit={submitTyped} className="mt-2 flex gap-2">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={copy.typePlaceholder || `…or type to ${brand.mascotName}`}
              disabled={voice.isBusy}
              aria-label={`Type to ${brand.mascotName}`}
              className="flex-1 bg-bg/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-text placeholder:text-muted/70 focus:outline-none focus:border-primary/50 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={voice.isBusy || !typed.trim()}
              aria-label="Send"
              className="px-3 rounded-xl bg-bg/60 border border-white/10 text-muted hover:text-text disabled:opacity-40"
            >
              <SendIcon className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-2 flex items-center justify-between text-xs">
            {voice.supported ? (
              <button
                onClick={() => voice.setMuted(!voice.muted)}
                className="inline-flex items-center gap-1.5 text-muted hover:text-text transition-colors"
              >
                {voice.muted ? <SpeakerOffIcon className="w-3.5 h-3.5" /> : <SpeakerOnIcon className="w-3.5 h-3.5" />}
                {voice.muted ? (copy.voiceOff || 'Voice off') : (copy.voiceOn || 'Voice on')}
              </button>
            ) : <span />}
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
              <SparkleIcon className="w-10 h-10 text-primary mx-auto mb-4" />
              <p className="text-lg text-text font-semibold mb-1">{copy.emptyTitle || 'Say what you want to make.'}</p>
              {(copy.emptyExamples?.length ?? 0) > 0 && (
                <p className="text-muted text-sm">{copy.emptyExamples!.map((x) => `"${x}"`).join(' · ')}</p>
              )}
            </div>
          )}

          {build.brief && (
            <div className="bg-card/30 backdrop-blur-md rounded-2xl border border-white/10 p-4">
              <p className="text-xs text-muted uppercase tracking-wide mb-1">
                {copy.briefLabel || 'The brief'}{build.name ? ` — ${build.name}` : ''}
              </p>
              <p className="text-sm text-text">{build.brief.prompt}</p>
              {build.brief.summary && <p className="text-xs text-muted mt-2">{build.brief.summary}</p>}
            </div>
          )}

          {busy && !build.generating && (
            <div className="bg-card/30 backdrop-blur-md rounded-2xl border border-white/10 p-5">
              <ProgressBar label="Setting that up…" startedAt={build.startedAt ?? undefined} expectedMs={6000} />
            </div>
          )}

          {build.generating && build.candidates.length === 0 && !build.previewUrl && (
            <div className="bg-card/30 backdrop-blur-md rounded-2xl border border-white/10 p-6">
              <ProgressBar
                label={lane?.generatingCopy || 'Painting your designs…'}
                startedAt={build.startedAt ?? undefined}
                expectedMs={90000}
                size="lg"
              />
            </div>
          )}

          {build.candidates.length > 0 && !build.selectedAssetId && (
            <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-5">
              <p className="text-sm text-muted mb-3">
                {copy.pickPrompt || 'Say the numbers you love — or tap them. Every pick becomes its own product.'}
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {build.candidates.map((c, i) => {
                  const picked = manualPicks.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      onClick={() => setManualPicks((p) => {
                        if (p.includes(c.id)) return p.filter((x) => x !== c.id)
                        if (p.length >= maxPicks) return p
                        return [...p, c.id]
                      })}
                      aria-pressed={picked}
                      className={`relative rounded-2xl overflow-hidden border transition-all text-left ${
                        picked ? 'border-primary ring-2 ring-primary/50' : 'border-white/10 hover:border-primary/40'
                      }`}
                    >
                      <img src={c.url} alt={`Design ${i + 1}`} className="w-full aspect-square object-contain bg-bg/60" />
                      <span className="absolute top-2 left-2 bg-bg/80 text-text text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center border border-white/20">
                        {i + 1}
                      </span>
                      {picked && (
                        <span className="absolute top-2 right-2 bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center">
                          <CheckIcon className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              {manualPicks.length > 0 && (
                <button
                  onClick={() => void runSelect(manualPicks)}
                  disabled={busy}
                  className="mt-4 w-full bg-gradient-to-r from-primary to-secondary text-white font-bold py-3 rounded-xl shadow-lg shadow-primary/30 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <SparkleIcon className="w-4 h-4" />
                  {(copy.buildButton || 'Build {n} product{s}')
                    .replace('{n}', String(manualPicks.length))
                    .replace('{s}', manualPicks.length > 1 ? 's' : '')}
                  {buildCost ? ` (${money(buildCost)})` : ''}
                </button>
              )}
            </div>
          )}

          {build.siblings.length > 0 && (
            <div className="bg-secondary/10 border border-secondary/30 rounded-2xl p-4">
              <p className="text-sm text-text font-semibold mb-1">
                {build.siblings.length} more product{build.siblings.length > 1 ? 's' : ''} building from your other picks
              </p>
              <p className="text-xs text-muted">{build.siblings.map((s) => s.name).join(' · ')}</p>
            </div>
          )}

          {build.previewUrl && (
            <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-5">
              <p className="text-sm text-muted mb-3">Your concept</p>
              <img src={build.previewUrl} alt="Concept" className="w-full max-w-sm mx-auto rounded-2xl border border-white/10" />
              {lane?.handoff && !build.previewDone && (
                <>
                  <button
                    onClick={lane.handoff.onClick}
                    className="mt-4 w-full bg-gradient-to-r from-primary to-secondary text-white font-bold py-3 rounded-xl shadow-lg shadow-primary/30 transition-all"
                  >
                    {lane.handoff.label}
                  </button>
                  {lane.handoff.note && <p className="text-xs text-muted mt-2 text-center">{lane.handoff.note}</p>}
                </>
              )}
            </div>
          )}

          {build.selectedAssetId && build.shots.length === 0 && build.generating && (
            <div className="bg-card/30 backdrop-blur-md rounded-2xl border border-white/10 p-6">
              <ProgressBar
                label="Rendering your product shots…"
                startedAt={build.startedAt ?? undefined}
                expectedMs={120000}
                size="lg"
              />
            </div>
          )}

          {build.shots.length > 0 && (
            <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-5">
              <p className="text-sm text-muted mb-3">
                {copy.shotsLabel || 'Your product shots'}{build.generating ? ' — more still rendering…' : ''}
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {build.shots.map((m) => (
                  <figure key={m.id} className={`rounded-2xl overflow-hidden border bg-bg/40 ${m.ok === false ? 'border-amber-500/40' : 'border-white/10'}`}>
                    <img src={m.url} alt={m.label} className="w-full aspect-square object-cover" />
                    <figcaption className="text-[11px] text-muted px-2 py-1">
                      {m.label}{m.ok === false ? ' · flagged' : ''}
                    </figcaption>
                  </figure>
                ))}
              </div>
              {build.generating && (
                <ProgressBar className="mt-4" label="More shots rendering…" startedAt={build.startedAt ?? undefined} expectedMs={90000} />
              )}
              {!build.submitted && (
                <button
                  onClick={() => void runSubmit()}
                  disabled={busy}
                  className="mt-4 w-full bg-gradient-to-r from-emerald-500 to-green-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-emerald-500/30 disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <SendIcon className="w-4 h-4" />
                  {copy.submitButton || 'Submit for review'}
                </button>
              )}
            </div>
          )}

          {build.submitted && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-3xl p-8 text-center">
              <CheckIcon className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
              <p className="text-lg font-semibold text-text mb-1">
                {lane?.doneCopy?.title || copy.doneTitle || 'Sent to the print shop!'}
              </p>
              <p className="text-muted text-sm mb-4">
                {lane?.doneCopy?.body || copy.doneBody || 'A human reviews it before it goes live — usually within a day.'}
              </p>
              <button
                onClick={() => { announcedRef.current.clear(); setManualPicks([]); dispatch({ type: 'RESET' }) }}
                className="bg-card/60 border border-white/10 hover:border-primary/40 text-text font-semibold px-6 py-2.5 rounded-xl transition-all"
              >
                {copy.againButton || 'Build another'}
              </button>
            </div>
          )}

          {footer}
        </div>
      </div>
    </div>
  )
}

export default StepFlowStudio
