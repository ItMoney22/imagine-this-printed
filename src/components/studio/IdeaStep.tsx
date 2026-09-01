// Step 1 — Idea: type or speak it, the writing brain turns it into the best
// prompt for gpt-image-2, then the design job fires.
import React, { useState } from 'react'
import { Mic, Square, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import { stepFlow } from '../../lib/api'
import type { StepFlowAction, StepFlowState } from './stepFlowReducer'
import type { StepBrief } from './types'
import { createStepFlowProduct } from './createStepFlowProduct'
import { useVoiceDictation } from './useVoiceDictation'
import { ApproveButton, InlineError, SecondaryButton, StepCard } from './shared'

interface IdeaStepProps {
  state: StepFlowState
  dispatch: React.Dispatch<StepFlowAction>
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
}

const IdeaStep: React.FC<IdeaStepProps> = ({ state, dispatch, refresh }) => {
  const [writingBrief, setWritingBrief] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [brief, setBrief] = useState<StepBrief | null>(null)
  const [briefOpen, setBriefOpen] = useState(true)

  const {
    supported: voiceSupported,
    listening,
    error: voiceError,
    start: startVoice,
    stop: stopVoice,
  } = useVoiceDictation((text) => dispatch({ type: 'SET_IDEA', idea: text }))

  const idea = state.idea

  const handleWriteBrief = async () => {
    if (!idea.trim()) return
    setError(null)
    setWritingBrief(true)
    try {
      const { brief: newBrief } = await stepFlow.brief(idea.trim())
      setBrief(newBrief)
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
      const { productId } = await createStepFlowProduct(idea.trim(), brief)
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

      <div className="mt-4">
        <ApproveButton onClick={handleWriteBrief} disabled={!idea.trim() || writingBrief} busy={writingBrief}>
          {writingBrief ? 'Writing the prompt…' : 'Write my prompt'}
        </ApproveButton>
      </div>

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
