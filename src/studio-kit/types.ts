/**
 * Studio Kit — contracts.
 *
 * The kit is the STEP FLOW SHELL: a step rail, a talking mascot panel, a brief
 * card, a numbered multi-pick design board, a shots gallery and a submit/finish
 * state. It knows nothing about any particular backend, brand or product.
 *
 * A host site supplies three things:
 *   - a StudioBrand   (what it looks like and what the mascot is called)
 *   - StudioLane[]    (what can be made)
 *   - a StudioAdapter (how to actually talk to its own server)
 *
 * Nothing in this folder may import from outside it. That is what makes it
 * portable — see README.md.
 */
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** One numbered design the person can pick. */
export interface StudioCandidate {
  id: string
  url: string
  label?: string
}

/** A rendered product shot. */
export interface StudioShot {
  id: string
  url: string
  label: string
  /** false renders a "flagged" border — a QA warning, not an error. */
  ok?: boolean
}

/** What the mascot drew out of the person before anything is generated. */
export interface StudioBrief {
  /** The confirmed description. This is what gets generated. */
  prompt: string
  style?: string
  tone?: string
  /** Free-form extras the host's adapter understands and passes through. */
  options?: Record<string, unknown>
  /** One short line under the brief, e.g. "Printed front + back". */
  summary?: string
}

export interface StudioPricing {
  /** Cost of one generation round. */
  generate: number
  /** Cost to build one picked design into a product. */
  buildPerProduct: number
  /** The person's current balance. */
  balance: number
}

/** Normalized poll result. The adapter maps the host's API shape onto this. */
export interface StudioStatus {
  candidates: StudioCandidate[]
  shots: StudioShot[]
  /** True while anything is still rendering. */
  generating: boolean
  /** Optional product name to show on the brief card. */
  productName?: string
  /**
   * Raised once per distinct key to have the mascot react out loud. The kit
   * announces candidates, shots and total failure on its own; this is for
   * host-specific moments.
   */
  announcements?: Array<{ key: string; text: string }>
}

/** A lane that hands off elsewhere instead of building a product here. */
export interface StudioPreview {
  imageUrl?: string
  /** Set when the handoff target is ready and the flow can end. */
  done?: boolean
}

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

export interface StudioLane {
  /** Matches what the mascot's brain sets, e.g. "shirt". */
  key: string
  label: string
  /**
   * standard        — generate, pick, build, shots, submit (the default)
   * preview-handoff — generate a preview, then send them somewhere else to
   *                   finish. Use it for a pipeline this studio does not own.
   */
  kind?: 'standard' | 'preview-handoff'
  /** preview-handoff only: the button at the end of the preview. */
  handoff?: {
    label: string
    note?: string
    onClick: () => void
  }
  /** Copy shown while this lane is generating. */
  generatingCopy?: string
  /** Copy on the success card when this lane finishes. */
  doneCopy?: { title: string; body: string }
}

// ---------------------------------------------------------------------------
// The backend contract
// ---------------------------------------------------------------------------

export interface StudioTurnAction {
  name: 'generate_designs' | 'select_designs' | 'submit_product' | string
  args: Record<string, unknown>
}

export interface StudioTurnResult {
  userText: string
  reply: string
  audioUrl: string | null
  /** Fields merged into the board: lane, brief, pricing, plus host extras. */
  statePatch: Record<string, unknown>
  action: StudioTurnAction | null
}

export interface StudioChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface StudioCreateInput {
  lane: string
  brief: StudioBrief
  /** Lane-level choices the mascot set before the brief, e.g. a panel size. */
  options: Record<string, unknown>
}

export interface StudioAdapter {
  /** Costs and balance. Return null to hide the pricing chip entirely. */
  getPricing?: () => Promise<StudioPricing | null>

  /** Start a generation. Resolve with the id the kit polls on. */
  create: (input: StudioCreateInput) => Promise<{ id: string; name?: string }>

  /** Poll a running build. Called every pollMs until nothing is generating. */
  status: (id: string) => Promise<StudioStatus>

  /** Build the picked design(s). Extra picks may become their own products. */
  select: (id: string, assetIds: string[]) => Promise<{ siblings?: Array<{ id: string; name: string }> }>

  /** The finale. Whatever "done" means on the host — submit, save, order. */
  submit: (id: string) => Promise<void>

  /** preview-handoff lanes only. */
  createPreview?: (input: StudioCreateInput) => Promise<{ id: string }>
  pollPreview?: (id: string) => Promise<StudioPreview>

  /**
   * One conversational turn: audio or text in, words + voice + actions out.
   * Omit it and the studio runs silent — the step rail, board and buttons all
   * still work, which is the accessible path anyway.
   */
  turn?: (payload: {
    audio?: Blob
    text?: string
    state: Record<string, unknown>
    history: StudioChatTurn[]
  }) => Promise<StudioTurnResult>
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

export type StudioVoiceStatus = 'idle' | 'recording' | 'thinking' | 'speaking'

export interface StudioBrand {
  title: string
  tagline?: string
  mascotName: string
  /** One image per voice status. idle is required; the rest fall back to it. */
  mascotImages: { idle: string } & Partial<Record<StudioVoiceStatus, string>>
  /** Shown if a mascot image 404s. */
  mascotFallbackImage?: string
  /** Every string the person can read lives here, so it can be rewritten. */
  copy?: {
    idlePrompt?: string
    micIdle?: string
    micRecording?: string
    micThinking?: string
    micSpeaking?: string
    typePlaceholder?: string
    voiceOn?: string
    voiceOff?: string
    emptyTitle?: string
    emptyExamples?: string[]
    briefLabel?: string
    pickPrompt?: string
    buildButton?: string
    shotsLabel?: string
    submitButton?: string
    doneTitle?: string
    doneBody?: string
    againButton?: string
  }
  /** Currency shown next to costs, e.g. ITC. Omit to show bare numbers. */
  currency?: string
  /** localStorage key for the mute preference. Namespace it per site. */
  mutePreferenceKey?: string
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

export interface StudioStep {
  key: string
  label: string
}

export interface StepFlowStudioProps {
  brand: StudioBrand
  lanes: StudioLane[]
  adapter: StudioAdapter
  /**
   * The rail across the top. Defaults to
   * Type, Brief, Generate, Pick, Shots, Submit.
   */
  steps?: StudioStep[]
  /** Poll interval while a build runs. Default 4000ms. */
  pollMs?: number
  /** Max designs buildable in one go. Default 4. */
  maxPicks?: number
  /** Rendered under the board. */
  footer?: ReactNode
  /** Fires after a successful submit, with the product id. */
  onSubmitted?: (id: string) => void
  /** Fires whenever a build starts, so the host can refresh its own lists. */
  onBuildStarted?: (id: string) => void
}
