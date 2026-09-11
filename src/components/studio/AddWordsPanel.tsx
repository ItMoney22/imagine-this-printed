// Step 2 — "Add words that match this design".
//
// David 2026-09-09: "the phrases or ask mrs imagine to come up with a phrase
// she is going off the prompt and it really doesnt match the design of the
// image so it sucks can we fix that in the flow".
//
// The old pitch lived on the Idea step and ran BEFORE anything was drawn —
// phrase, then prompt, then render — so Mrs. Imagine was writing for a picture
// that did not exist. This panel is the reverse: the takes are on screen, she
// looks at the one you point her at, and every line she pitches has to answer
// to what is actually on the canvas. Her `saw` line is shown verbatim above
// the chips so you can tell in one glance whether she really looked.
//
// Applying a phrase does NOT re-render. It edits the take, so the artwork
// survives and only the lettering is new, and the lettered version lands
// beside the originals as another take — if it comes out wrong, the design you
// liked is still sitting right next to it.
import React, { useState } from 'react'
import { Eye, Sparkles, Type } from 'lucide-react'
import { useStudioLane } from './lane'
import type { DesignPhrases, LetteringStyleId, Phrase } from './types'
import { ApproveButton, InlineError, SecondaryButton, WarnPanel, WARN_TEXT } from './shared'
import { PhraseChips } from './IdeaStep'
import LetteringStylePicker from './LetteringStylePicker'
import ProgressBar from './ProgressBar'

// One vision call over a single 1024px design — measured alongside the
// inspiration breakdown, which does the same shape of work.
const LOOK_EXPECTED_MS = 12_000
// An image EDIT through the gpt-image chain: the same order of wait as a
// mockup render, not the 2-3 minutes a from-scratch design takes.
const LETTER_EXPECTED_MS = 60_000

interface AddWordsPanelProps {
  productId: string
  /** The take she should look at and letter onto — the selected one, else the newest. */
  assetId: string | null
  /** Re-hydrates the builder so the lettered take shows up in the grid. */
  refresh: () => Promise<void>
}

const AddWordsPanel: React.FC<AddWordsPanelProps> = ({ productId, assetId, refresh }) => {
  const lane = useStudioLane()

  const [open, setOpen] = useState(false)
  const [looking, setLooking] = useState(false)
  const [lettering, setLettering] = useState(false)
  const [pitch, setPitch] = useState<DesignPhrases | null>(null)
  const [picked, setPicked] = useState<Phrase | null>(null)
  const [style, setStyle] = useState<LetteringStyleId | 'auto'>('auto')
  const [customText, setCustomText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number>(0)

  const busy = looking || lettering

  const handleLook = async () => {
    if (busy) return
    setError(null)
    setStartedAt(Date.now())
    setLooking(true)
    try {
      const res = await lane.api.phrasesForDesign(productId, assetId ?? undefined, 6)
      setPitch(res)
      setOpen(true)
    } catch (err: any) {
      setError(err?.message || "Mrs. Imagine couldn't read that design — try again, or type your own words.")
    } finally {
      setLooking(false)
    }
  }

  const handlePick = (p: Phrase) => {
    setPicked(p)
    // Default to her own suggestion for this phrase, exactly as the Idea step
    // does for a hand-picked one — 'auto' when she pitched no style.
    setStyle(p.suggestedStyle ?? 'auto')
  }

  const handlePickCustom = () => {
    const text = customText.trim()
    if (!text) return
    setPicked({ text, vibe: 'custom', placement: 'below', reason: 'Your own line.' })
    setStyle('auto')
    setCustomText('')
  }

  const handleLetter = async () => {
    // `pitch.assetId` is the take she actually looked at — prefer it over the
    // caller's, so a selection change mid-pitch cannot letter her words onto a
    // different picture than the one she wrote them for.
    const target = pitch?.assetId ?? assetId
    if (!picked || !target || busy) return
    setError(null)
    setStartedAt(Date.now())
    setLettering(true)
    try {
      await lane.api.letterPhrase(productId, target, {
        text: picked.text,
        placement: picked.placement,
        style,
      })
      await refresh()
      // Collapse back down: the new take is in the grid above and that is
      // where the next decision is made.
      setOpen(false)
      setPicked(null)
      setPitch(null)
    } catch (err: any) {
      setError(err?.message || 'Failed to add those words to the design')
    } finally {
      setLettering(false)
    }
  }

  if (!open) {
    return (
      <div className="mt-4">
        <SecondaryButton onClick={handleLook} disabled={busy || !assetId}>
          <Type className="w-3.5 h-3.5" /> {looking ? 'Looking at it…' : 'Add words that match this design'}
        </SecondaryButton>
        {looking && (
          <div className="mt-3 px-2 sm:px-6">
            <ProgressBar label="Mrs. Imagine is reading your design" startedAt={startedAt} expectedMs={LOOK_EXPECTED_MS} />
          </div>
        )}
        <InlineError message={error} />
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-bold text-text flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-primary" /> Add words
        </h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-text">
          Close
        </button>
      </div>

      {/* Proof she looked. Without this the pitch is indistinguishable from
          the blind one David threw out — with it, a bad `saw` line tells him
          instantly that the problem is her eyes, not her writing. */}
      {pitch?.saw && (
        <p className="text-xs text-muted mb-2 flex items-start gap-1.5">
          <Eye className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
          <span>
            <span className="font-semibold text-text">She sees:</span> {pitch.saw}
          </span>
        </p>
      )}
      {pitch && !pitch.saw && (
        <p className="text-xs text-amber-700 mb-2">
          Mrs. Imagine couldn't get a look at this one — these are generic lines off your idea, not off the picture.
        </p>
      )}

      {pitch?.existingText && (
        <WarnPanel className="mb-3" title="This design already has words on it">
          <p className={`text-xs ${WARN_TEXT}`}>
            It already reads “{pitch.existingText}”. Adding a second line puts two slogans on one shirt.
          </p>
        </WarnPanel>
      )}

      {pitch?.intro && <p className="text-xs text-text mb-2">{pitch.intro}</p>}

      {pitch && pitch.phrases.length > 0 && <PhraseChips phrases={pitch.phrases} onSelect={handlePick} />}

      <div className="mt-3 flex flex-wrap gap-2 items-center">
        <input
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handlePickCustom()
            }
          }}
          placeholder="…or type your own line"
          className="flex-1 min-w-[180px] text-sm border border-border-subtle rounded-lg px-3 py-2 bg-bg text-text"
        />
        <SecondaryButton onClick={handlePickCustom} disabled={!customText.trim()}>
          Use mine
        </SecondaryButton>
        <SecondaryButton onClick={handleLook} disabled={busy}>
          {looking ? 'Looking…' : 'Pitch again'}
        </SecondaryButton>
      </div>

      {picked && (
        <div className="mt-4 border-t border-primary/20 pt-3">
          <p className="text-sm text-text mb-2">
            Lettering <span className="font-bold">“{picked.text}”</span> {picked.placement} the subject.
          </p>
          <LetteringStylePicker phraseText={picked.text} selected={style} onSelect={setStyle} />
          <div className="mt-3">
            <ApproveButton onClick={handleLetter} disabled={lettering} busy={lettering}>
              {lettering ? 'Adding the words…' : 'Add these words to the design'}
            </ApproveButton>
            <p className="text-[11px] text-muted mt-2">
              Adds the words to this exact artwork and saves it as another take — the design you picked stays as it is.
            </p>
          </div>
        </div>
      )}

      {lettering && (
        <div className="mt-3 px-2 sm:px-6">
          <ProgressBar label="Lettering the words into your design" startedAt={startedAt} expectedMs={LETTER_EXPECTED_MS} />
        </div>
      )}

      <InlineError message={error} />
    </div>
  )
}

export default AddWordsPanel
