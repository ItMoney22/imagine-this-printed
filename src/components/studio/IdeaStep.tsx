// Step 1 — Idea: type or speak it, optionally type words to render into the
// artwork, then the writing brain turns it all into the best prompt for
// gpt-image-2 and the design job fires.
//
// MRS. IMAGINE'S PITCH USED TO LIVE HERE, AND IT WAS BLIND (David 2026-09-09:
// "she is going off the prompt and it really doesnt match the design of the
// image so it sucks"). It could not have been anything else: this step runs
// BEFORE the design exists — phrase, then prompt, then render — so she was
// writing lines for a picture nobody had drawn, off a one-line idea. Her pitch
// now runs on the Design step (AddWordsPanel.tsx), where there is a finished
// take for her to actually look at.
//
// What stayed here is the half that never needed eyes: David typing words he
// already knows he wants. Those still go into the brief and get rendered into
// the art in a single pass, with no second image call.
import React, { useRef, useState } from 'react'
import { Mic, Square, Sparkles, ChevronDown, ChevronUp, X } from 'lucide-react'
import { useStudioLane } from './lane'
import { getLetteringStyle } from '../../../backend/shared/lettering-styles'
import type { StepFlowAction, StepFlowState } from './stepFlowReducer'
import type { LetteringStyleId, Phrase, StepBrief } from './types'
import { useVoiceDictation } from './useVoiceDictation'
import { ApproveButton, InlineError, SecondaryButton, StepCard } from './shared'
import ProgressBar from './ProgressBar'
import InspirationPanel from './InspirationPanel'
import LetteringStylePicker from './LetteringStylePicker'

// The writing brain's brief call is fast — a few seconds of GPT chat, not an
// image render — so a short expected time is enough to keep the bar honest.
const BRIEF_EXPECTED_MS = 4000

/** The brief panel's "Text in the design: … · <style label>" line (design
 *  doc §16) — 'auto'/undefined reads as the picker's own "let Mrs. Imagine
 *  pick" copy rather than a specific style name, since nothing concrete was
 *  chosen. */
const letteringStyleLabel = (style: LetteringStyleId | 'auto' | undefined): string => {
  if (!style || style === 'auto') return "Let Mrs. Imagine pick"
  return getLetteringStyle(style)?.label ?? style
}

type KindChoice = 'tshirt' | 'hoodie' | 'youth-tshirt' | 'metal'

// David 2026-09-03: the kids' tee is a choice from the very first step, not
// something discovered at the Garment step — it changes what Mrs. Imagine
// writes AND it is the garment that lets the mockup be photographed on a kid.
const PRODUCT_KIND_CHIPS: Array<{ value: KindChoice; label: string }> = [
  { value: 'tshirt', label: 'T-Shirt' },
  { value: 'hoodie', label: 'Hoodie' },
  { value: 'youth-tshirt', label: 'Kids T-Shirt' },
  { value: 'metal', label: 'Metal print' },
]

/** One phrase chip — text + vibe tag, with a tap-to-reveal reason. Exported
 *  standalone (same pattern as PrintPrepPanel's RecommendationBadge) so it
 *  can be render-tested without the panel's network effects. */
export const PhraseChips: React.FC<{ phrases: Phrase[]; onSelect: (phrase: Phrase) => void }> = ({
  phrases,
  onSelect,
}) => {
  const [openReason, setOpenReason] = useState<number | null>(null)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {phrases.map((p, i) => (
        <div
          key={`${p.text}-${i}`}
          className="rounded-lg border border-border-subtle p-2.5 bg-card hover:border-primary/50 transition-colors"
        >
          <button type="button" onClick={() => onSelect(p)} title={p.reason} className="w-full text-left">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-text">{p.text}</span>
              <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                {p.vibe}
              </span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setOpenReason((v) => (v === i ? null : i))}
            className="text-[10px] text-muted underline mt-1"
          >
            why?
          </button>
          {openReason === i && <p className="text-[11px] text-muted mt-1">{p.reason}</p>}
        </div>
      ))}
    </div>
  )
}

interface IdeaStepProps {
  state: StepFlowState
  dispatch: React.Dispatch<StepFlowAction>
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
}

const IdeaStep: React.FC<IdeaStepProps> = ({ state, dispatch, refresh }) => {
  const lane = useStudioLane()

  const [writingBrief, setWritingBrief] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [brief, setBrief] = useState<StepBrief | null>(null)
  const [briefOpen, setBriefOpen] = useState(true)
  const writingStartedAtRef = useRef<number | null>(null)

  // Words David already knows he wants. No pitch here any more — see the
  // header: suggestions need a picture, and there isn't one yet.
  const [customPhraseText, setCustomPhraseText] = useState('')
  const [phraseSkipped, setPhraseSkipped] = useState(false)

  // Product-kind chip (design doc §14) — tee/hoodie/metal print, above the
  // idea box. Local UI state (not the reducer) since it's only a pre-brief
  // preference: picking tee/hoodie hints `garmentHint` on the brief that
  // comes back (overriding whatever the writing brain guessed on its own,
  // since the admin already told us explicitly); picking metal is what
  // actually flips `state.productKind` via SET_PRODUCT_KIND. Seeded from a
  // resumed draft's brief so re-opening the Idea step to review shows the
  // choice that was actually made.
  const [kindChoice, setKindChoice] = useState<KindChoice>(() => {
    if (state.productKind === 'metal') return 'metal'
    // A flow opened from one of Mrs. Imagine's scout picks carries the product
    // she pitched it for (stepFlowReducer's SEED). Without this the chip would
    // fall back to the tee and a proven hoodie theme would quietly become a
    // tee — the one thing the pick was specific about.
    return state.seedGarment ?? state.stepFlow?.brief?.garmentHint ?? 'tshirt'
  })

  const {
    supported: voiceSupported,
    listening,
    error: voiceError,
    start: startVoice,
    stop: stopVoice,
  } = useVoiceDictation((text) => dispatch({ type: 'SET_IDEA', idea: text }))

  const idea = state.idea
  const phrase = state.phrase
  const inspiration = state.inspiration

  const handleSelectKind = (kind: KindChoice) => {
    setKindChoice(kind)
    dispatch({ type: 'SET_PRODUCT_KIND', productKind: kind === 'metal' ? 'metal' : 'garment' })
  }

  const handleAddCustomPhrase = () => {
    const text = customPhraseText.trim()
    if (!text) return
    // Hand-typed text has no suggestedStyle to default from — 'auto' lets
    // Mrs. Imagine pick, same as never touching the style grid at all.
    dispatch({ type: 'SET_PHRASE', phrase: { text, placement: 'below', style: 'auto' } })
    setCustomPhraseText('')
    setPhraseSkipped(false)
  }

  const handleRemovePhrase = () => {
    dispatch({ type: 'SET_PHRASE', phrase: null })
  }

  const handleSelectLetteringStyle = (style: LetteringStyleId | 'auto') => {
    if (!phrase) return
    dispatch({ type: 'SET_PHRASE', phrase: { ...phrase, style } })
  }

  const handleWriteBrief = async () => {
    if (!idea.trim()) return
    setError(null)
    writingStartedAtRef.current = Date.now()
    setWritingBrief(true)
    try {
      const { brief: newBrief } = await lane.api.brief(idea.trim(), phrase ?? undefined, inspiration ?? undefined, state.productKind)
      // The product-kind chip is the admin's explicit choice — it wins over
      // whatever garment the writing brain guessed from the idea text alone.
      const resolvedBrief: StepBrief =
        state.productKind === 'metal' ? newBrief : { ...newBrief, garmentHint: kindChoice === 'metal' ? 'tshirt' : kindChoice }
      setBrief(resolvedBrief)
      setBriefOpen(true)
    } catch (err: any) {
      setError(err?.message || 'Failed to write the prompt')
    } finally {
      setWritingBrief(false)
    }
  }

  const handleGenerate = async () => {
    if (!brief) return
    setError(null)
    setCreating(true)
    try {
      const { productId } = await lane.createProduct(idea.trim(), brief, inspiration ?? undefined)
      dispatch({ type: 'PRODUCT_CREATED', productId })
      await refresh({ productId, advance: true })
    } catch (err: any) {
      setError(err?.message || 'Failed to start the design')
    } finally {
      setCreating(false)
    }
  }

  const updateBriefField = <K extends keyof StepBrief>(key: K, value: StepBrief[K]) => {
    setBrief((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  return (
    <StepCard>
      <h2 className="text-xl font-bold text-text mb-1">What do you want to make?</h2>
      <p className="text-sm text-muted mb-4">Type it, or speak it — one line is enough. Example: “hip-hop street monkey”.</p>

      <div className="flex flex-wrap gap-2 mb-4">
        {PRODUCT_KIND_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => handleSelectKind(chip.value)}
            aria-pressed={kindChoice === chip.value}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              kindChoice === chip.value
                ? 'bg-gradient-to-r from-primary to-secondary text-white border-transparent'
                : 'bg-card border-border-subtle text-text hover:border-primary/40'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <InspirationPanel
        idea={idea}
        inspiration={inspiration}
        onIdeaChange={(next) => dispatch({ type: 'SET_IDEA', idea: next })}
        onSetInspiration={(next) => dispatch({ type: 'SET_INSPIRATION', inspiration: next })}
      />

      <div className="relative">
        <textarea
          value={idea}
          onChange={(e) => dispatch({ type: 'SET_IDEA', idea: e.target.value })}
          placeholder="Describe the design idea…"
          rows={4}
          className="w-full text-base border border-border-subtle rounded-xl px-4 py-3 bg-bg text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
        <div className="absolute bottom-3 right-3">
          {voiceSupported ? (
            <button
              type="button"
              onClick={() => (listening ? stopVoice() : startVoice(idea))}
              title={listening ? 'Stop dictation' : 'Speak your idea'}
              aria-label={listening ? 'Stop voice dictation' : 'Start voice dictation'}
              aria-pressed={listening}
              className={`inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
                listening ? 'bg-red-500 text-white animate-pulse' : 'bg-primary/10 text-primary hover:bg-primary/20'
              }`}
            >
              {listening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          ) : null}
        </div>
      </div>
      {!voiceSupported && (
        <p className="text-xs text-muted mt-1.5">Voice input isn't supported in this browser — typing works everywhere.</p>
      )}
      {voiceError && <p className="text-xs text-red-400 mt-1.5">{voiceError}</p>}

      {/* Words on the design. Type-only by design (see the header): a
          suggestion needs a picture to answer to, and this step runs before
          one exists. Collapses to a removable chip once words are set. */}
      <div className="mt-4">
        {phrase ? (
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-xs text-text">
              <span className="font-semibold">Words on design:</span> “{phrase.text}”
              <button
                type="button"
                onClick={handleRemovePhrase}
                aria-label="Remove phrase"
                className="text-muted hover:text-red-400"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div>
              <p className="text-xs font-semibold text-text mb-2">How should the words look?</p>
              <LetteringStylePicker
                phraseText={phrase.text}
                selected={phrase.style ?? 'auto'}
                onSelect={handleSelectLetteringStyle}
              />
            </div>
          </div>
        ) : phraseSkipped ? (
          <button type="button" onClick={() => setPhraseSkipped(false)} className="text-xs text-muted underline">
            No words added — add some?
          </button>
        ) : (
          <div
            className={`rounded-2xl border border-border-subtle bg-card/50 p-4 ${
              !idea.trim() ? 'opacity-50' : ''
            }`}
          >
            <p className="text-sm text-text font-medium">Want words on it?</p>
            <p className="text-xs text-muted mt-0.5">
              Type them and they get drawn into the art in one pass. Not sure yet? Leave it — once the design is up,
              Mrs. Imagine can look at it and pitch lines that fit what she actually sees.
            </p>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                value={customPhraseText}
                onChange={(e) => setCustomPhraseText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddCustomPhrase()
                  }
                }}
                placeholder="words to print on it…"
                disabled={!idea.trim()}
                className="flex-1 text-sm border border-border-subtle rounded-lg px-3 py-2 bg-bg text-text placeholder:text-muted disabled:opacity-50"
              />
              <SecondaryButton onClick={handleAddCustomPhrase} disabled={!idea.trim() || !customPhraseText.trim()}>
                Add
              </SecondaryButton>
              <SecondaryButton onClick={() => setPhraseSkipped(true)} disabled={!idea.trim()}>
                No words
              </SecondaryButton>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <ApproveButton onClick={handleWriteBrief} disabled={!idea.trim() || writingBrief} busy={writingBrief}>
          {writingBrief ? 'Writing the prompt…' : 'Write my prompt'}
        </ApproveButton>
      </div>

      {writingBrief && (
        <div className="mt-3">
          <ProgressBar
            label="Writing your prompt…"
            startedAt={writingStartedAtRef.current ?? Date.now()}
            expectedMs={BRIEF_EXPECTED_MS}
          />
        </div>
      )}

      <InlineError message={error} />

      {brief && (
        <div className="mt-6 border-t border-border-subtle pt-4">
          <button
            type="button"
            onClick={() => setBriefOpen((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-semibold text-text mb-2"
          >
            <Sparkles className="w-4 h-4 text-primary" />
            What I'm telling the artist
            {briefOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-muted" />}
          </button>

          {briefOpen && (
            <div className="space-y-3">
              {brief.phrase && (
                <p className="text-xs text-text">
                  <span className="font-semibold">Text in the design:</span> “{brief.phrase.text}” ·{' '}
                  {letteringStyleLabel(brief.phrase.style)}
                </p>
              )}
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted">Design prompt</label>
                <textarea
                  value={brief.designPrompt}
                  onChange={(e) => updateBriefField('designPrompt', e.target.value)}
                  rows={4}
                  className="w-full text-sm border border-border-subtle rounded-lg px-3 py-2 bg-bg text-text"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-muted block mb-1">Render background</label>
                  <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
                    {(['white', 'black'] as const).map((bg) => (
                      <button
                        key={bg}
                        type="button"
                        onClick={() => updateBriefField('background', bg)}
                        className={`px-3 py-1.5 text-xs font-medium capitalize ${
                          brief.background === bg ? 'bg-primary text-white' : 'bg-card text-muted hover:text-text'
                        }`}
                      >
                        {bg}
                      </button>
                    ))}
                  </div>
                </div>
                {brief.productKind === 'metal' ? (
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-muted block mb-1">Product</label>
                    <span className="inline-flex px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white">
                      Metal print
                    </span>
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-muted block mb-1">Garment</label>
                    <div className="inline-flex rounded-lg border border-border-subtle overflow-hidden">
                      {(['tshirt', 'hoodie'] as const).map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => updateBriefField('garmentHint', g)}
                          className={`px-3 py-1.5 text-xs font-medium capitalize ${
                            brief.garmentHint === g ? 'bg-primary text-white' : 'bg-card text-muted hover:text-text'
                          }`}
                        >
                          {g === 'tshirt' ? 'T-Shirt' : 'Hoodie'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {brief.rationale && <p className="text-xs text-muted italic">{brief.rationale}</p>}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <ApproveButton onClick={handleGenerate} disabled={creating} busy={creating}>
              {creating ? 'Generating…' : 'Generate design'}
            </ApproveButton>
            <SecondaryButton onClick={() => setBrief(null)} disabled={creating}>
              Start over
            </SecondaryButton>
          </div>
        </div>
      )}
    </StepCard>
  )
}

export default IdeaStep
