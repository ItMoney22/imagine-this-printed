// Print prep — an optional, team-only halftone/diffusion screen for the
// press. Lives on the Design step, appearing once the transparent (nobg)
// design exists, and stays visible whether or not "Approve design" has been
// clicked yet — it never gates that button or the step's advance to
// Garments. It never touches the design assets (`source`/`nobg`) — it only
// ever produces a separate `kind:'print'` asset the storefront never reads.
//
// David, verbatim (docs/plans/2026-09-01-imagine-studio-step-flow-design.md
// §10): "if i feel the design needs to be halftones after can i do it there
// but i dont want the main design to be comprimised and i dont want the cust
// to see the halftoned design its only for my team to use when they are
// pressing and printing the design. and reccomend if a design should be half
// toned or not."
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Download, RefreshCw, Sparkles } from 'lucide-react'
import { stepFlow } from '../../lib/api'
import { getNobgAsset, type PrintAdvice, type StepFlowState, type SuggestedPrintOptions } from './stepFlowReducer'
import { Checkerboard, InlineError, SecondaryButton } from './shared'
import ProgressBar from './ProgressBar'

// The render itself is a synchronous sharp/halftone pass, not a model call —
// short by nature (David's spec: ~3-8s).
const PRINT_FILE_EXPECTED_MS = 8000
const ADVICE_EXPECTED_MS = 3000

const RECOMMEND_STYLE: Record<PrintAdvice['recommend'], string> = {
  halftone: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  clean: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
}

const RECOMMEND_LABEL: Record<PrintAdvice['recommend'], string> = {
  halftone: 'Halftone recommended',
  clean: 'Print clean',
}

/** Small presentational piece, exported so it can be render-tested on its
 *  own without pulling in the panel's network effects. */
export const RecommendationBadge: React.FC<{ advice: PrintAdvice }> = ({ advice }) => (
  <div className="flex items-center gap-2 flex-wrap">
    <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded border ${RECOMMEND_STYLE[advice.recommend]}`}>
      {RECOMMEND_LABEL[advice.recommend]}
    </span>
    <span className="text-[11px] text-muted">{Math.round(advice.confidence * 100)}% confidence</span>
  </div>
)

const DEFAULT_OPTIONS: SuggestedPrintOptions = {
  method: 'halftone',
  frequency: 55,
  angle: 45,
  shape: 'round',
  invertDark: false,
}

const AdvancedOptions: React.FC<{
  options: SuggestedPrintOptions
  onChange: (next: SuggestedPrintOptions) => void
}> = ({ options, onChange }) => (
  <div className="rounded-xl border border-border-subtle p-3 mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
    <label className="flex flex-col gap-1">
      <span className="text-muted">Method</span>
      <select
        value={options.method}
        onChange={(e) => onChange({ ...options, method: e.target.value as SuggestedPrintOptions['method'] })}
        className="bg-bg border border-border-subtle rounded-lg px-2 py-1.5 text-text"
      >
        <option value="halftone">Halftone</option>
        <option value="diffusion">Diffusion</option>
        <option value="vector">Vector trace</option>
      </select>
    </label>
    <label className="flex flex-col gap-1">
      <span className="text-muted">Dot shape</span>
      <select
        value={options.shape}
        onChange={(e) => onChange({ ...options, shape: e.target.value as SuggestedPrintOptions['shape'] })}
        className="bg-bg border border-border-subtle rounded-lg px-2 py-1.5 text-text"
      >
        <option value="round">Round</option>
        <option value="line">Line</option>
      </select>
    </label>
    <label className="flex flex-col gap-1">
      <span className="text-muted">Frequency — {options.frequency} LPI</span>
      <input
        type="range"
        min={5}
        max={100}
        step={1}
        value={options.frequency}
        onChange={(e) => onChange({ ...options, frequency: Number(e.target.value) })}
      />
    </label>
    <label className="flex flex-col gap-1">
      <span className="text-muted">Angle — {options.angle}°</span>
      <input
        type="range"
        min={0}
        max={90}
        step={1}
        value={options.angle}
        onChange={(e) => onChange({ ...options, angle: Number(e.target.value) })}
      />
    </label>
    <label className="flex items-start gap-2 sm:col-span-2 text-text">
      <input
        type="checkbox"
        checked={options.invertDark}
        onChange={(e) => onChange({ ...options, invertDark: e.target.checked })}
        className="mt-0.5"
      />
      <span>
        Keep dark ink solid (light shirt)
        <span className="block text-[11px] text-muted font-normal">
          Off = screen the dark areas so a dark shirt shows through
        </span>
      </span>
    </label>
  </div>
)

/** Vector tracing knobs. Not part of SuggestedPrintOptions because print
 *  advice never suggests vector — it is always a deliberate pick. */
interface VectorOptions {
  colors: number
  detail: number
  despeckle: number
}

const DEFAULT_VECTOR: VectorOptions = { colors: 24, detail: 1, despeckle: 32 }

const VectorControls: React.FC<{
  options: VectorOptions
  onChange: (next: VectorOptions) => void
}> = ({ options, onChange }) => (
  <div className="rounded-xl border border-border-subtle p-3 mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
    <label className="flex flex-col gap-1">
      <span className="text-muted">Colours — {options.colors}</span>
      <input
        type="range" min={4} max={48} step={1} value={options.colors}
        onChange={(e) => onChange({ ...options, colors: Number(e.target.value) })}
      />
      <span className="text-[11px] text-muted font-normal">
        Too few and the black outlines merge into the fills
      </span>
    </label>
    <label className="flex flex-col gap-1">
      <span className="text-muted">Speckle floor — {options.despeckle}px</span>
      <input
        type="range" min={0} max={128} step={4} value={options.despeckle}
        onChange={(e) => onChange({ ...options, despeckle: Number(e.target.value) })}
      />
      <span className="text-[11px] text-muted font-normal">Drops traced flecks smaller than this</span>
    </label>
    <label className="flex flex-col gap-1 sm:col-span-2">
      <span className="text-muted">Smoothness — {options.detail}</span>
      <input
        type="range" min={0.5} max={4} step={0.5} value={options.detail}
        onChange={(e) => onChange({ ...options, detail: Number(e.target.value) })}
      />
      <span className="text-[11px] text-muted font-normal">
        Higher rounds the curves off; lower follows the pixels literally
      </span>
    </label>
  </div>
)

interface PrintPrepPanelProps {
  state: StepFlowState
  refresh: (opts?: { productId?: string; advance?: boolean }) => Promise<void>
}

const PrintPrepPanel: React.FC<PrintPrepPanelProps> = ({ state, refresh }) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- getNobgAsset only reads state.assets
  const nobgAsset = useMemo(() => getNobgAsset(state), [state.assets])
  const advice = state.stepFlow?.printAdvice ?? null
  const printFile = state.stepFlow?.printFile ?? null

  const [loadingAdvice, setLoadingAdvice] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [options, setOptions] = useState<SuggestedPrintOptions>(DEFAULT_OPTIONS)
  const [vector, setVector] = useState<VectorOptions>(DEFAULT_VECTOR)
  const [error, setError] = useState<string | null>(null)
  const requestedAdviceRef = useRef(false)
  const seededFromAdviceRef = useRef(false)
  const renderStartedAtRef = useRef<number | null>(null)

  // Prefill the editable options from print-advice's suggested screen the
  // first time it lands — after that, whatever the admin has set wins.
  useEffect(() => {
    if (!advice?.suggested || seededFromAdviceRef.current) return
    seededFromAdviceRef.current = true
    setOptions(advice.suggested)
  }, [advice])

  // Fetch print-advice once per mount (cached on step_flow server-side via
  // HYDRATE, same pattern GarmentStep uses for color-advice).
  useEffect(() => {
    if (!state.productId || !nobgAsset || requestedAdviceRef.current || advice) return
    requestedAdviceRef.current = true
    setLoadingAdvice(true)
    stepFlow
      .printAdvice(state.productId)
      .then(() => refresh())
      .catch((err: any) => setError(err?.message || 'Failed to score this artwork for print prep'))
      .finally(() => setLoadingAdvice(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.productId, nobgAsset, advice])

  const handleMakePrintFile = async () => {
    if (!state.productId) return
    setError(null)
    setRendering(true)
    renderStartedAtRef.current = Date.now()
    try {
      await stepFlow.printFile(
        state.productId,
        options.method === 'vector' ? { method: 'vector', ...vector } : options
      )
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Failed to render the print file')
    } finally {
      setRendering(false)
    }
  }

  if (!nobgAsset) return null

  return (
    <div className="mt-6 border-t border-border-subtle pt-5">
      <h3 className="text-sm font-semibold text-text mb-1">Print prep</h3>
      <p className="text-xs text-muted mb-3">
        Optional — a team-only file for the press: a halftone screen, or a vector trace that stays sharp at
        any print size. It never changes the design your customer sees.
      </p>

      {loadingAdvice && !advice && (
        <div className="py-4 px-1">
          <ProgressBar label="Reading the artwork for print prep" startedAt={Date.now()} expectedMs={ADVICE_EXPECTED_MS} />
        </div>
      )}

      {advice && (
        <div className="rounded-xl border border-border-subtle p-3 mb-3">
          <RecommendationBadge advice={advice} />
          <p className="text-xs text-text mt-2">{advice.reason}</p>
        </div>
      )}

      {!rendering && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleMakePrintFile}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 text-sm font-semibold transition-colors"
          >
            {printFile ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            {printFile ? 'Redo print file' : 'Make print file'}
          </button>
          <SecondaryButton onClick={() => setAdvancedOpen((v) => !v)}>
            {advancedOpen ? 'Hide advanced' : 'Advanced'}
          </SecondaryButton>
          {printFile && (
            <a
              href={printFile.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card border border-border-subtle text-text text-sm font-medium hover:bg-card-elevated"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          )}
        </div>
      )}

      {advancedOpen && !rendering && (
        <>
          <AdvancedOptions options={options} onChange={setOptions} />
          {options.method === 'vector' && <VectorControls options={vector} onChange={setVector} />}
        </>
      )}

      {rendering && (
        <div className="py-4 px-1">
          <ProgressBar
            label={options.method === 'vector' ? 'Tracing the print file' : 'Screening the print file'}
            startedAt={renderStartedAtRef.current ?? Date.now()}
            expectedMs={PRINT_FILE_EXPECTED_MS}
          />
        </div>
      )}

      {printFile && !rendering && (
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <p className="text-[11px] text-muted mb-1">Design</p>
            <Checkerboard className="aspect-square">
              <img src={nobgAsset.url ?? ''} alt="Approved design" className="w-full h-full object-contain" />
            </Checkerboard>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-[11px] text-muted">Print file</p>
              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-amber-500 text-black">
                Team only
              </span>
            </div>
            <Checkerboard className="aspect-square">
              <img src={printFile.url} alt="Team-only print file" className="w-full h-full object-contain" />
            </Checkerboard>
          </div>
        </div>
      )}

      <InlineError message={error} />
      <p className="text-[11px] text-muted mt-3">Customers never see this. It's the file the press team pulls.</p>
    </div>
  )
}

export default PrintPrepPanel
