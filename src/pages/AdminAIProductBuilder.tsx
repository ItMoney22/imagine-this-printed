// AdminAIProductBuilder — the Imagine Studio.
//
// Default face: a LIVE voice build session with Mr. Imagine (browser-direct
// xAI Grok realtime via useMrImagineLive). Mr. Imagine drives the six-hex
// build board (TYPE → BRIEF → GENERATE → PICK → POLISH → PUBLISH) through
// tools handled here; job completions are pushed BACK into the conversation
// (sendBoardUpdate) so he announces progress instead of the admin watching
// spinners. Three lanes, all real pipelines:
//   shirt / metal-art → /api/admin/products/ai/* (create → status poll →
//                       select-image → rembg/mockups → publish)
//   3d-print          → /api/3d-models/* (concept → approve → Tripo3D tier;
//                       spends the signed-in wallet's ITC — costs are spoken)
//
// The classic wizard remains fully intact behind the Classic toggle.

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import confetti from 'canvas-confetti'
import { Mic, Square, Wand2, Layers, RotateCcw, AlertTriangle, Check, Radio, ListChecks } from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useMrImagineLive, type MrImagineToolDef } from '../hooks/useMrImagineLive'
import { aiProducts, apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import AdminCreateProductWizard from '../components/AdminCreateProductWizard'
import OneShotProductModal from '../components/OneShotProductModal'
import BulkProductModal from '../components/BulkProductModal'
import StepFlowBuilder from '../components/studio/StepFlowBuilder'
import type { AIJob, ProductTrendFamily, TshirtPrintLocation } from '../types'

// ---------------------------------------------------------------------------
// Build board state machine
// ---------------------------------------------------------------------------

type Lane = 'shirt' | 'metal-art' | '3d-print' | 'photo-template'
type StepKey = 'type' | 'brief' | 'generate' | 'pick' | 'polish' | 'publish'

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: 'type', label: 'Type' },
  { key: 'brief', label: 'Brief' },
  { key: 'generate', label: 'Generate' },
  { key: 'pick', label: 'Pick' },
  { key: 'polish', label: 'Polish' },
  { key: 'publish', label: 'Publish' },
]

interface Candidate { id: string; url: string; label?: string }
interface MockupAsset { id: string; url: string; label: string }
interface ModelShot { url: string; ok: boolean; label?: string; reason?: string }
interface HeroVideo { status: string; url?: string }
interface SizeTier { tier: string; label: string; description: string; itcCost: number }
interface FiledTask { taskId?: string; title: string }

interface Brief {
  prompt: string
  style?: string
  tone?: string
  shirtColor: 'black' | 'white' | 'gray'
  printLocations: TshirtPrintLocation[]
  /** Where the design prints — drives the mockup composition server-side. */
  printPlacement?: 'front-center' | 'left-pocket' | 'back-only' | 'front-back' | 'pocket-front-back-full'
  /** Physical print width in inches (garments). */
  printSizeInches?: number
}

interface BuildState {
  lane: Lane | null
  metalSize: '4x6' | '8x10'
  brief: Brief | null
  productId: string | null
  productName: string | null
  model3dId: string | null
  concept3dUrl: string | null
  conceptApproved: boolean
  glbUrl: string | null
  candidates: Candidate[]
  selectedAssetId: string | null
  selectedDesignUrl: string | null
  nobgDone: boolean
  mockups: MockupAsset[]
  published: boolean | null // true = live, false = kept draft; null = not decided
  generating: boolean
  filedTasks: FiledTask[]
  /** Last research pull (web or market scout) — shown on the board so voice
   *  findings don't evaporate. */
  research: string | null
  /** Hardened Etsy-flow model shoot results (metadata.etsy_shots). */
  modelShots: ModelShot[]
  /** Spin hero video (metadata.hero_video). */
  heroVideo: HeroVideo | null
}

const initialBuild: BuildState = {
  lane: null,
  metalSize: '4x6',
  brief: null,
  productId: null,
  productName: null,
  model3dId: null,
  concept3dUrl: null,
  conceptApproved: false,
  glbUrl: null,
  candidates: [],
  selectedAssetId: null,
  selectedDesignUrl: null,
  nobgDone: false,
  mockups: [],
  published: null,
  generating: false,
  filedTasks: [],
  research: null,
  modelShots: [],
  heroVideo: null,
}

type BuildAction =
  | { type: 'SET_LANE'; lane: Lane; metalSize?: '4x6' | '8x10' }
  | { type: 'SET_BRIEF'; brief: Brief }
  | { type: 'GENERATE_STARTED'; productId?: string; productName?: string; model3dId?: string }
  | { type: 'SYNC_PIPELINE'; candidates: Candidate[]; mockups: MockupAsset[]; selectedDesignUrl: string | null; nobgDone: boolean; generating: boolean; modelShots: ModelShot[]; heroVideo: HeroVideo | null }
  | { type: 'DESIGN_SELECTED'; assetId: string }
  | { type: 'CONCEPT_READY'; url: string }
  | { type: 'CONCEPT_APPROVED' }
  | { type: 'GLB_READY'; url: string }
  | { type: 'PUBLISHED'; live: boolean }
  | { type: 'TASK_FILED'; task: FiledTask }
  | { type: 'SET_RESEARCH'; research: string }
  | { type: 'RESET' }

function buildReducer(state: BuildState, action: BuildAction): BuildState {
  switch (action.type) {
    case 'SET_LANE':
      // A new lane restarts the board but keeps the session's Watchtower log
      // and any research pull — trends usually come BEFORE the lane choice.
      return { ...initialBuild, filedTasks: state.filedTasks, research: state.research, lane: action.lane, metalSize: action.metalSize || state.metalSize }
    case 'SET_BRIEF':
      return { ...state, brief: action.brief }
    case 'GENERATE_STARTED':
      return {
        ...state,
        generating: true,
        productId: action.productId ?? state.productId,
        productName: action.productName ?? state.productName,
        model3dId: action.model3dId ?? state.model3dId,
      }
    case 'SYNC_PIPELINE':
      return {
        ...state,
        candidates: action.candidates,
        mockups: action.mockups,
        selectedDesignUrl: action.selectedDesignUrl,
        nobgDone: action.nobgDone,
        generating: action.generating,
        modelShots: action.modelShots,
        heroVideo: action.heroVideo,
      }
    case 'DESIGN_SELECTED':
      return { ...state, selectedAssetId: action.assetId }
    case 'CONCEPT_READY':
      return { ...state, concept3dUrl: action.url, generating: false }
    case 'CONCEPT_APPROVED':
      return { ...state, conceptApproved: true }
    case 'GLB_READY':
      return { ...state, glbUrl: action.url, generating: false }
    case 'PUBLISHED':
      return { ...state, published: action.live }
    case 'TASK_FILED':
      return { ...state, filedTasks: [...state.filedTasks, action.task] }
    case 'SET_RESEARCH':
      return { ...state, research: action.research }
    case 'RESET':
      return initialBuild
    default:
      return state
  }
}

/** Which steps are complete, derived — the single source of truth the hexes,
 *  Mr. Imagine (via get_build_state) and the tools all share. */
function stepDone(s: BuildState, key: StepKey): boolean {
  const is3d = s.lane === '3d-print'
  switch (key) {
    case 'type': return s.lane !== null
    case 'brief': return s.brief !== null
    case 'generate': return is3d ? !!s.concept3dUrl : s.candidates.length > 0
    case 'pick': return is3d ? s.conceptApproved : !!s.selectedAssetId
    case 'polish': return is3d ? !!s.glbUrl : (s.mockups.length > 0 || s.nobgDone || s.modelShots.length > 0)
    case 'publish': return is3d ? (!!s.glbUrl && s.published !== null) : s.published !== null
  }
}

function activeStep(s: BuildState): StepKey {
  for (const st of STEPS) if (!stepDone(s, st.key)) return st.key
  return 'publish'
}

// ---------------------------------------------------------------------------
// Mr. Imagine's tools (definitions live here; execution in the page handler)
// ---------------------------------------------------------------------------

const TOOLS: MrImagineToolDef[] = [
  {
    type: 'function',
    name: 'set_product_type',
    description: 'Lock in what we are building the moment the admin says it: a shirt, metal art, a 3D print — or a photo-template (a shirt design with an EMPTY photo slot that staff personalize with each customer\'s photo, e.g. "Class of 2027"). For metal art also pass the panel size once they choose (4x6 or 8x10).',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['shirt', 'metal-art', '3d-print', 'photo-template'] },
        metal_size: { type: 'string', enum: ['4x6', '8x10'], description: 'Metal art only.' },
      },
      required: ['type'],
    },
  },
  {
    type: 'function',
    name: 'set_design_brief',
    description: 'Lock the creative brief once the admin confirms it. prompt is the full design description in your polished words (subject, style, colors, any text). Include shirt_color and print_locations for shirts when discussed. Ask where the print goes — front, pocket, back, or front AND back — and pass print_placement; pass print_size_inches if they name a size (11 is the adult standard).',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The confirmed design brief, written to generate well.' },
        style: { type: 'string', description: 'Style keywords, e.g. cartoon, realistic, vintage.' },
        tone: { type: 'string', description: 'Mood/tone, e.g. playful, elegant.' },
        shirt_color: { type: 'string', enum: ['black', 'white', 'gray'] },
        print_locations: { type: 'array', items: { type: 'string', enum: ['front_image', 'back_image', 'pocket'] } },
        print_placement: {
          type: 'string',
          enum: ['front-center', 'left-pocket', 'back-only', 'front-back', 'pocket-front-back-full'],
          description: 'Where the design prints. front-back = same design on both sides (renders a front and a back mockup).',
        },
        print_size_inches: { type: 'integer', description: 'Print width in inches: 8 youth, 11 adult standard, 13 XL. Default 11.' },
      },
      required: ['prompt'],
    },
  },
  {
    type: 'function',
    name: 'generate_designs',
    description: 'Fire the design generation for the locked brief. Default (no model_id): four AI models paint candidates in parallel — good for variety. Pass model_id to cast ONE specific model instead — REQUIRED when the design contains text (use a typography specialist). 3D print lane ignores model_id (concept pipeline, spends ITC — say the cost first).',
    parameters: {
      type: 'object',
      properties: {
        model_id: { type: 'string', description: "Registry model id from list_design_models, e.g. 'ideogram-ai/ideogram-v3-quality' or 'openai/gpt-image-2'. Omit for the multi-model fan-out." },
      },
    },
  },
  {
    type: 'function',
    name: 'list_design_models',
    description: 'See the stable of registered image models — id, strengths (text-in-image, photoreal, stylized, logo-vector…), cost per image, and speed. Call before casting a model_id on generate_designs.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'search_replicate',
    description: "Search Replicate's public catalog of thousands of models (new Flux versions, text specialists, anything). DISCOVERY ONLY — the machine can only run registered models, so if you find a winner, offer to file a Watchtower task to get it onboarded.",
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: "e.g. 'flux', 'typography', 'text rendering'." } },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'select_design',
    description: 'Pick the winning design(s) by on-screen number (1-based). Shirt/metal art lane only. If the admin loves MORE than one, pass all of them in indexes — the first is the main build and every extra becomes its OWN sibling product automatically.',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: 'The number under the chosen candidate (single pick).' },
        indexes: { type: 'array', items: { type: 'integer' }, description: 'Multiple picks — first is the main product, the rest each become their own product.' },
      },
    },
  },
  {
    type: 'function',
    name: 'remove_background',
    description: 'Start background removal on the selected design for a clean DTF-ready cutout. The board announces when it finishes.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'create_mockups',
    description: 'Start product mockups for the selected design — shirts get garment shots, metal art gets size-accurate shelf and wall scenes. The board announces when they land.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'list_shot_subjects',
    description: 'See the casting list for model shoots — archetype ids and personas (student, teacher, streetwear, grandma…). Call before shoot_model_photos so you can pitch fitting subjects.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'shoot_model_photos',
    description: 'Run the hardened model shoot on the selected design: 2 photos of real everyday people wearing it, unique person each time, automatic design-fidelity QA. Pass subjects (archetype ids from list_shot_subjects) to cast, or omit for a surprise cast. Shirt-family lanes only, after a design is selected. The board reports when shots land.',
    parameters: {
      type: 'object',
      properties: {
        subjects: { type: 'array', items: { type: 'string' }, description: 'Up to 2 archetype ids. Omit for random.' },
        custom: { type: 'string', description: 'Free-text custom subject (adults only — minors are blocked).' },
      },
    },
  },
  {
    type: 'function',
    name: 'create_spin_video',
    description: 'Generate the SIGNATURE storefront hero: a ~5 second video of the model turning while the shirt changes color mid-spin (teaches shoppers the color options). Needs at least one finished model shot. Takes a couple of minutes — the board reports when it is ready.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'approve_concept',
    description: '3D lane only: approve the concept image so the admin can pick a print size for the actual 3D conversion.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'convert_3d',
    description: '3D lane only: convert the approved concept into a printable 3D model at a size tier. THIS SPENDS ITC — always say the tier cost out loud and get a yes first.',
    parameters: {
      type: 'object',
      properties: { size_tier: { type: 'string', enum: ['mini', 'small', 'medium', 'large'] } },
      required: ['size_tier'],
    },
  },
  {
    type: 'function',
    name: 'finalize_product',
    description: 'Close out the build. publish=true puts the product live on the storefront; publish=false keeps it as a draft. Recap and confirm before calling.',
    parameters: {
      type: 'object',
      properties: { publish: { type: 'boolean' } },
      required: ['publish'],
    },
  },
  {
    type: 'function',
    name: 'get_build_state',
    description: 'Get the current build board snapshot — lane, brief, what is generated, what is selected, what is done. Call this whenever you are unsure where we are.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'web_research',
    description: "Run a LIVE Grok web + X search. Use when the admin asks what's trending, what's hot, or when a brief needs fresh cultural fuel. Takes a few seconds — tell them you're checking. Findings show on the board too.",
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: "What to research, e.g. 'trending graphic tee themes this week' or 'what's big on X today'." } },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'market_trends',
    description: "Pull the store's own market scout: marketplace-backed product ideas (TikTok/Etsy/Amazon/Google signals) that come with ready-to-build design briefs. Great for 'what should we make that will SELL'. Findings show on the board.",
    parameters: {
      type: 'object',
      properties: {
        family: { type: 'string', enum: ['all', 'apparel', 'tumblers', 'dtf-transfers', 'stickers', 'metal-art', '3d-toys'], description: 'Product family to scout. Default all.' },
      },
    },
  },
  {
    type: 'function',
    name: 'save_memory',
    description: "Save something durable to YOUR memory — a client and what they ordered, a design decision, a staff preference, how a build turned out. Call it the moment it comes up ('remember the bowling client wanted navy'). One plain fact per call.",
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact, written plainly.' },
        memory_type: { type: 'string', enum: ['client', 'design', 'preference', 'context'] },
      },
      required: ['content'],
    },
  },
  {
    type: 'function',
    name: 'recall_memory',
    description: "Search your own memory — past clients, designs, decisions. Use when the admin says 'remember that design we did…' or asks about past work. Speak only from what comes back.",
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Keywords, e.g. "bowling client".' } },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'bulk_build',
    description: 'Volume mode: pull N market-backed trend ideas and run the FULL pipeline on each automatically (up to 20). Finished designs land as draft products for review; the board announces the final score in a few minutes. Confirm the count out loud before firing.',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'integer', description: '1-20 designs.' },
        focus: { type: 'string', description: "Optional niche, e.g. 'teachers', 'fishing dads'." },
      },
      required: ['count'],
    },
  },
  {
    type: 'function',
    name: 'create_watchtower_task',
    description: 'File a REAL dev task on the Watchtower board when the admin hits a bug or wants something changed that the studio cannot do. Ask before filing. Write the description so a coding agent can execute it without follow-up questions.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, concrete task title.' },
        description: { type: 'string', description: 'What needs to change, with enough detail to act on.' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      },
      required: ['title', 'description'],
    },
  },
]

// ---------------------------------------------------------------------------
// Hex visual primitives
// ---------------------------------------------------------------------------

const HEX_CLIP = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)'

/** Faint honeycomb field behind the studio. Pure SVG pattern, theme-token color. */
const HoneycombBackdrop: React.FC = () => (
  <svg className="absolute inset-0 w-full h-full text-primary opacity-[0.06] pointer-events-none" aria-hidden="true">
    <defs>
      <pattern id="itp-honeycomb" width="56" height="96" patternUnits="userSpaceOnUse">
        <polygon points="28,0 56,16 56,48 28,64 0,48 0,16" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <polygon points="28,0 56,16 56,48 28,64 0,48 0,16" fill="none" stroke="currentColor" strokeWidth="1.5" transform="translate(28,48)" />
        <polygon points="28,0 56,16 56,48 28,64 0,48 0,16" fill="none" stroke="currentColor" strokeWidth="1.5" transform="translate(-28,48)" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#itp-honeycomb)" />
  </svg>
)

const HexStepTracker: React.FC<{ build: BuildState }> = ({ build }) => {
  const active = activeStep(build)
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 flex-wrap">
      {STEPS.map((step, i) => {
        const done = stepDone(build, step.key)
        const isActive = !done && step.key === active
        return (
          <React.Fragment key={step.key}>
            {i > 0 && (
              <div className={`hidden sm:block w-6 md:w-10 h-0.5 rounded ${done || isActive ? 'bg-gradient-to-r from-primary to-secondary' : 'bg-muted/20'}`} />
            )}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={
                  done
                    ? 'w-14 h-14 md:w-16 md:h-16 flex items-center justify-center bg-gradient-to-br from-primary to-secondary text-white'
                    : isActive
                      ? 'w-14 h-14 md:w-16 md:h-16 flex items-center justify-center bg-gradient-to-br from-primary/40 to-secondary/40 text-text animate-pulse'
                      : 'w-14 h-14 md:w-16 md:h-16 flex items-center justify-center bg-card/70 text-muted'
                }
                style={{ clipPath: HEX_CLIP }}
              >
                {done ? <Check className="w-6 h-6" /> : <span className="text-xs font-bold font-tech uppercase tracking-wide">{i + 1}</span>}
              </div>
              <span className={`text-[10px] md:text-xs font-tech uppercase tracking-widest ${isActive ? 'text-primary' : done ? 'text-text' : 'text-muted'}`}>
                {step.label}
              </span>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

const MrImagineOrb: React.FC<{ status: string; busy: boolean }> = ({ status, busy }) => {
  const src =
    status === 'speaking' ? '/mr-imagine/mr-imagine-head-happy.png'
      : busy || status === 'connecting' ? '/mr-imagine/mr-imagine-head-thinking.png'
        : '/mr-imagine/mr-imagine-head.png'
  const glow =
    status === 'speaking' ? 'drop-shadow(0 0 32px rgba(168,85,247,0.85))'
      : status === 'listening' ? 'drop-shadow(0 0 20px rgba(16,185,129,0.7))'
        : 'drop-shadow(0 0 12px rgba(168,85,247,0.35))'
  return (
    <div className="relative flex items-center justify-center">
      {/* pulse rings while he talks */}
      {status === 'speaking' && (
        <>
          <div className="absolute w-52 h-52 bg-primary/10 animate-ping" style={{ clipPath: HEX_CLIP }} />
          <div className="absolute w-60 h-60 bg-secondary/10 animate-pulse" style={{ clipPath: HEX_CLIP }} />
        </>
      )}
      <div className="relative w-44 h-44 md:w-52 md:h-52 flex items-center justify-center" style={{ filter: glow }}>
        <img src={src} alt="Mr. Imagine" className="w-full h-full object-contain select-none" draggable={false} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type BuilderMode = 'steps' | 'studio' | 'classic'

const VALID_MODES: BuilderMode[] = ['steps', 'studio', 'classic']

const AdminAIProductBuilder: React.FC = () => {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  // Step Flow is the default face now — Live Studio (voice) and the classic
  // wizard stay one click away. `?mode=` always wins (a deep link from the
  // product editor's "Continue in Step Flow" relies on this), then the
  // localStorage remembered choice, then the default.
  const [mode, setMode] = useState<BuilderMode>(() => {
    const fromQuery = searchParams.get('mode')
    if (fromQuery && (VALID_MODES as string[]).includes(fromQuery)) return fromQuery as BuilderMode
    const stored = localStorage.getItem('itp-ai-builder-mode')
    return (VALID_MODES as string[]).includes(stored || '') ? (stored as BuilderMode) : 'steps'
  })
  // `?productId=` resumes the Step Flow builder at whatever step that draft
  // last reached (AdminProductEditModal's "Continue in Step Flow" deep link).
  const stepFlowProductId = searchParams.get('productId')
  const [oneShotOpen, setOneShotOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [build, dispatch] = useReducer(buildReducer, initialBuild)

  // Latest state for tool handlers + pollers that live inside WS callbacks.
  const buildRef = useRef(build)
  buildRef.current = build
  // One-shot announcement guard per pipeline event.
  const announcedRef = useRef<Set<string>>(new Set())
  const tiersRef = useRef<SizeTier[]>([])
  const last3dStatusRef = useRef<string>('')
  const sendBoardUpdateRef = useRef<(text: string) => void>(() => {})
  // Which reveal chimes have already fired for the CURRENT build — reset per lane pick.
  const revealedRef = useRef({ candidates: false, design: false, mockups: false, concept3d: false, glb: false })

  useEffect(() => { localStorage.setItem('itp-ai-builder-mode', mode) }, [mode])

  // ---------------------------------------------------------------- reveals
  const playChime = useCallback((src: string, volume = 0.55) => {
    try {
      const audio = new Audio(src)
      audio.volume = volume
      void audio.play().catch(() => {})
    } catch { /* autoplay blocked or unsupported — the visual pop still lands */ }
  }, [])

  useEffect(() => { revealedRef.current = { candidates: false, design: false, mockups: false, concept3d: false, glb: false } }, [build.lane])

  useEffect(() => {
    if (build.candidates.length > 0 && !revealedRef.current.candidates) {
      revealedRef.current.candidates = true
      playChime('/mr-imagine/audio/ding.mp3')
    }
  }, [build.candidates.length, playChime])

  useEffect(() => {
    if (build.selectedDesignUrl && !revealedRef.current.design) {
      revealedRef.current.design = true
      playChime('/mr-imagine/audio/ding.mp3')
      confetti({ particleCount: 50, spread: 55, origin: { y: 0.55 }, scalar: 0.8 })
    }
  }, [build.selectedDesignUrl, playChime])

  useEffect(() => {
    if (build.mockups.length > 0 && !revealedRef.current.mockups) {
      revealedRef.current.mockups = true
      playChime('/mr-imagine/audio/ding.mp3')
    }
  }, [build.mockups.length, playChime])

  useEffect(() => {
    if (build.concept3dUrl && !revealedRef.current.concept3d) {
      revealedRef.current.concept3d = true
      playChime('/mr-imagine/audio/ding.mp3')
    }
  }, [build.concept3dUrl, playChime])

  useEffect(() => {
    if (build.glbUrl && !revealedRef.current.glb) {
      revealedRef.current.glb = true
      playChime('/mr-imagine/audio/ding.mp3', 0.6)
      confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 } })
    }
  }, [build.glbUrl, playChime])

  // ------------------------------------------------------------------ tools
  const handleToolCall = useCallback(async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const s = buildRef.current
    switch (name) {
      case 'set_product_type': {
        const lane = String(args.type) as Lane
        if (!['shirt', 'metal-art', '3d-print', 'photo-template'].includes(lane)) throw new Error(`Unknown product type "${lane}"`)
        const metalSize = args.metal_size === '8x10' ? '8x10' as const : args.metal_size === '4x6' ? '4x6' as const : undefined
        announcedRef.current.clear()
        last3dStatusRef.current = ''
        dispatch({ type: 'SET_LANE', lane, metalSize })
        if (lane === '3d-print') {
          try {
            const data = await apiFetch('/api/3d-models/size-tiers') as { tiers?: SizeTier[] }
            tiersRef.current = data.tiers || []
          } catch { tiersRef.current = [] }
          const costs = tiersRef.current.map((t) => `${t.label}: ${t.itcCost} ITC`).join(', ')
          return { ok: true, lane, note: `3D lane armed. Conversion tiers — ${costs || 'tiers unavailable right now'} — plus the concept image cost at generation. Say costs out loud before spending.` }
        }
        if (lane === 'metal-art') {
          return { ok: true, lane, metal_size: metalSize || s.metalSize, note: metalSize ? 'Metal art locked with panel size.' : 'Metal art locked — still need the panel size, 4x6 or 8x10.' }
        }
        if (lane === 'photo-template') {
          return { ok: true, lane, note: 'Photo-template lane locked. Get the occasion, the exact text (like "Class of 2027"), the style — and where the customer photo slot should sit. The slot stays EMPTY in the design.' }
        }
        return { ok: true, lane, note: 'Shirt lane locked. Get the brief.' }
      }

      case 'set_design_brief': {
        if (!s.lane) throw new Error('Pick a product type first (set_product_type).')
        const prompt = String(args.prompt || '').trim()
        if (!prompt) throw new Error('The brief needs a prompt.')
        const locations = Array.isArray(args.print_locations)
          ? args.print_locations.filter((v): v is TshirtPrintLocation => ['front_image', 'back_image', 'pocket'].includes(String(v)))
          : []
        const placement = ['front-center', 'left-pocket', 'back-only', 'front-back', 'pocket-front-back-full'].includes(String(args.print_placement))
          ? String(args.print_placement) as Brief['printPlacement']
          : undefined
        const sizeInches = Number(args.print_size_inches)
        dispatch({
          type: 'SET_BRIEF',
          brief: {
            prompt,
            style: args.style ? String(args.style) : undefined,
            tone: args.tone ? String(args.tone) : undefined,
            shirtColor: (['black', 'white', 'gray'].includes(String(args.shirt_color)) ? String(args.shirt_color) : 'black') as Brief['shirtColor'],
            printLocations: locations.length ? locations : ['front_image'],
            printPlacement: placement,
            printSizeInches: Number.isFinite(sizeInches) && sizeInches > 0 ? Math.round(sizeInches) : undefined,
          },
        })
        return { ok: true, note: 'Brief locked on the board. Confirm they are ready, then generate.' }
      }

      case 'generate_designs': {
        const brief = buildRef.current.brief
        const lane = buildRef.current.lane
        if (!lane || !brief) throw new Error('Need a product type and a locked brief first.')
        announcedRef.current.clear()

        if (lane === '3d-print') {
          const style3d = /cartoon|toy|cute|chibi/i.test(`${brief.style || ''} ${brief.prompt}`) ? 'cartoon' : 'realistic'
          const data = await apiFetch('/api/3d-models/create', {
            method: 'POST',
            body: JSON.stringify({ prompt: brief.prompt, style: style3d }),
          }) as { ok?: boolean; model?: { id: string }; costs?: { concept?: number } }
          if (!data?.model?.id) throw new Error('3D concept could not start.')
          last3dStatusRef.current = 'queued'
          dispatch({ type: 'GENERATE_STARTED', model3dId: data.model.id })
          return { ok: true, note: `Concept generation started (${data.costs?.concept ?? 'a few'} ITC spent). The board will report when the concept image is up — usually under a minute.` }
        }

        const isMetal = lane === 'metal-art'
        const isTemplate = lane === 'photo-template'
        const fullPrompt = [
          isMetal ? `Metal art panel design: ${brief.prompt}`
            : isTemplate
              ? `T-shirt photo template design: ${brief.prompt}. The composition MUST include exactly one large, clearly-bordered photo placeholder — a plain solid blank area inside a decorative frame that fits the theme — kept COMPLETELY EMPTY (no sample photo, no faces, no text inside it). A customer's photo will be dropped into that slot later; all artwork and text wraps around it.`
              : brief.prompt,
          brief.style ? `Style: ${brief.style}.` : '',
          brief.tone ? `Mood: ${brief.tone}.` : '',
        ].filter(Boolean).join(' ')
        const castModel = typeof args.model_id === 'string' && args.model_id.includes('/') ? args.model_id : undefined
        const res = await aiProducts.create({
          prompt: fullPrompt,
          tone: brief.tone,
          productType: 'tshirt',
          shirtColor: brief.shirtColor,
          print_locations: isMetal ? undefined : brief.printLocations,
          // Placement + size used to be silently dropped in studio mode, so
          // every voice-built product rendered front-center at default scale.
          printPlacement: isMetal ? undefined : brief.printPlacement,
          printSizeInches: isMetal ? undefined : brief.printSizeInches,
          metal_size: isMetal ? buildRef.current.metalSize : undefined,
          category_slug_override: isTemplate ? 'templates' : undefined,
          ...(castModel ? { modelId: castModel, forceSingleModel: true } : {}),
        })
        dispatch({ type: 'GENERATE_STARTED', productId: res.productId, productName: res.product?.name })
        return {
          ok: true,
          productName: res.product?.name,
          note: castModel
            ? `Generation is rolling on ${castModel} solo — your cast. The board will announce the candidates.`
            : 'Generation is rolling — multiple AI models painting in parallel. The board will announce the candidates. Keep the admin company meanwhile.',
        }
      }

      case 'select_design': {
        const b = buildRef.current
        if (!b.productId) throw new Error('Nothing generated yet.')
        // Multi-pick: first index is the main build, every extra becomes its
        // own sibling product server-side.
        const rawIdxs: number[] = Array.isArray(args.indexes) && args.indexes.length > 0
          ? args.indexes.map(Number)
          : [Number(args.index)]
        const idxs = Array.from(new Set(rawIdxs))
        if (idxs.some(i => !Number.isFinite(i) || i < 1 || i > b.candidates.length)) {
          throw new Error(`Pick numbers between 1 and ${b.candidates.length}.`)
        }
        const [primary, ...extras] = idxs.map(i => b.candidates[i - 1])
        const response = await aiProducts.selectImage(b.productId, primary.id, extras.map(c => c.id))
        dispatch({ type: 'DESIGN_SELECTED', assetId: primary.id })
        const siblings: Array<{ name: string }> = Array.isArray(response?.siblings) ? response.siblings : []
        return {
          ok: true,
          siblings: siblings.map(s => s.name),
          note: extras.length > 0
            ? `Design ${idxs[0]} locked as the main build, and ${siblings.length || extras.length} more product${(siblings.length || extras.length) > 1 ? 's' : ''} spinning up from the other pick${extras.length > 1 ? 's' : ''} — they build themselves in the background. Offer the polish moves for the main one.`
            : `Design ${idxs[0]} locked as the winner. Offer the polish moves: background removal and mockups.`,
        }
      }

      case 'remove_background': {
        const b = buildRef.current
        if (!b.productId || !b.selectedAssetId) throw new Error('Select a winning design first.')
        await aiProducts.removeBackground(b.productId, b.selectedAssetId)
        return { ok: true, note: 'Background removal started — the board will report when the cutout is clean.' }
      }

      case 'create_mockups': {
        const b = buildRef.current
        if (!b.productId || !b.selectedAssetId) throw new Error('Select a winning design first.')
        await aiProducts.createMockups(b.productId, b.selectedAssetId)
        return { ok: true, note: 'Mockup shoot started — the board will report when the shots land.' }
      }

      case 'list_shot_subjects': {
        const data = await apiFetch('/api/admin/etsy/shot-subjects') as { subjects?: unknown[] }
        return { ok: true, subjects: data.subjects || [], note: 'Pitch 2-3 that fit the design and audience; empty cast = surprise me.' }
      }

      case 'shoot_model_photos': {
        const b = buildRef.current
        if (!b.productId || !b.selectedAssetId) throw new Error('Select a winning design first.')
        const subjects = Array.isArray(args.subjects) ? args.subjects.map(String).slice(0, 2) : []
        await apiFetch(`/api/admin/etsy/model-shots/${b.productId}`, {
          method: 'POST',
          body: JSON.stringify({ subjects, ...(args.custom ? { custom: String(args.custom) } : {}) }),
        })
        return { ok: true, note: 'Shoot is rolling — 30 to 60 seconds a photo, the board will report as they land, with a fidelity flag on any shot where the design got mangled.' }
      }

      case 'create_spin_video': {
        const b = buildRef.current
        if (!b.productId) throw new Error('No product yet.')
        if (!b.modelShots.length) throw new Error('Shoot the model first — the video animates the best model shot.')
        const data = await apiFetch('/api/ai/realtime/spin-video', {
          method: 'POST',
          body: JSON.stringify({ productId: b.productId }),
        }) as { ok?: boolean; seconds?: number }
        return { ok: true, note: `Spin video is generating (${data.seconds || 5} seconds of footage, takes a couple of minutes). The board will call it when the hero is ready.` }
      }

      case 'approve_concept': {
        const b = buildRef.current
        if (b.lane !== '3d-print' || !b.model3dId) throw new Error('No 3D concept to approve.')
        await apiFetch(`/api/3d-models/${b.model3dId}/approve`, { method: 'POST', body: '{}' })
        dispatch({ type: 'CONCEPT_APPROVED' })
        const costs = tiersRef.current.map((t) => `${t.label} ${t.itcCost} ITC`).join(', ')
        return { ok: true, note: `Concept approved. Now pick a print size${costs ? ` — ${costs}` : ''}. Say the cost of their pick out loud before converting.` }
      }

      case 'convert_3d': {
        const b = buildRef.current
        if (b.lane !== '3d-print' || !b.model3dId) throw new Error('No approved 3D concept.')
        const tier = String(args.size_tier)
        await apiFetch(`/api/3d-models/${b.model3dId}/generate-3d`, { method: 'POST', body: JSON.stringify({ size: tier }) })
        const t = tiersRef.current.find((x) => x.tier === tier)
        return { ok: true, note: `Tripo conversion started at ${t?.label || tier}${t ? ` (${t.itcCost} ITC spent)` : ''}. Takes a few minutes — the board will call it when the printable model is done.` }
      }

      case 'finalize_product': {
        const b = buildRef.current
        const live = Boolean(args.publish)
        if (b.lane === '3d-print') {
          if (!b.glbUrl) throw new Error('The 3D model is not finished yet.')
          dispatch({ type: 'PUBLISHED', live })
          return { ok: true, note: 'Build closed out — the printable model is saved to the 3D library.' }
        }
        if (!b.productId) throw new Error('There is no product to finalize.')
        const { error: updateError } = await supabase
          .from('products')
          .update({ status: live ? 'active' : 'draft', is_active: true })
          .eq('id', b.productId)
        if (updateError) throw new Error(`Could not update the product: ${updateError.message}`)
        dispatch({ type: 'PUBLISHED', live })
        if (live) confetti({ particleCount: 120, spread: 75, origin: { y: 0.7 } })
        return { ok: true, note: live ? 'Product is LIVE on the storefront. Celebrate.' : 'Product saved as a draft.' }
      }

      case 'get_build_state': {
        const b = buildRef.current
        return {
          lane: b.lane,
          metal_size: b.lane === 'metal-art' ? b.metalSize : undefined,
          brief: b.brief?.prompt || null,
          product_name: b.productName,
          candidates_on_screen: b.candidates.length,
          design_selected: !!b.selectedAssetId,
          background_removed: b.nobgDone,
          mockups_ready: b.mockups.length,
          concept_ready: !!b.concept3dUrl,
          concept_approved: b.conceptApproved,
          printable_model_ready: !!b.glbUrl,
          published: b.published,
          steps_complete: STEPS.filter((st) => stepDone(b, st.key)).map((st) => st.label),
          current_step: activeStep(b),
          generating: b.generating,
        }
      }

      case 'list_design_models': {
        const data = await apiFetch('/api/ai/realtime/models') as { models?: unknown[] }
        return { ok: true, models: data.models || [], note: 'Cast by strengths: text-in-image for lettering, photoreal-* for realism, logo-vector for flat marks. Mention cost if you pick a pricey one.' }
      }

      case 'search_replicate': {
        const query = String(args.query || '').trim()
        if (!query) throw new Error('Search needs a query.')
        const data = await apiFetch('/api/ai/realtime/replicate-search', {
          method: 'POST',
          body: JSON.stringify({ query }),
        }) as { results?: unknown[] }
        return {
          ok: true,
          results: data.results || [],
          note: 'Discovery only — these are NOT runnable until registered. If one looks like a winner, pitch it and offer to file a Watchtower task to onboard it.',
        }
      }

      case 'web_research': {
        const query = String(args.query || '').trim()
        if (!query) throw new Error('Research needs a query.')
        const data = await apiFetch('/api/ai/realtime/research', {
          method: 'POST',
          body: JSON.stringify({ query }),
        }) as { summary?: string }
        if (!data.summary) throw new Error('Research came back empty.')
        dispatch({ type: 'SET_RESEARCH', research: data.summary })
        return { ok: true, findings: data.summary, note: 'Findings are on the board. Pitch the strongest angles, then build off the winner.' }
      }

      case 'market_trends': {
        const family = String(args.family || 'all') as ProductTrendFamily
        const data = await aiProducts.trends({ family, limit: 5 })
        const ideas = (data.ideas || []).slice(0, 5)
        if (!ideas.length) throw new Error('The market scout came back empty — try web_research instead.')
        const summary = ideas
          .map((i, n) => `${n + 1}. ${i.title} — ${i.whyItMaySell} (style: ${i.designStyle}; colors: ${i.primaryColors}; saturation: ${i.saturation})`)
          .join('\n')
        dispatch({ type: 'SET_RESEARCH', research: `Market scout (${family}):\n${summary}` })
        return {
          ok: true,
          ideas: ideas.map((i) => ({ title: i.title, why: i.whyItMaySell, ready_brief: i.prompt, style: i.designStyle, colors: i.primaryColors, saturation: i.saturation })),
          note: 'Ideas are on the board, numbered. Each has a ready_brief you can hand to set_design_brief once the admin picks one.',
        }
      }

      case 'save_memory': {
        const content = String(args.content || '').trim()
        if (!content) throw new Error('Nothing to remember.')
        await apiFetch('/api/ai/realtime/memory', {
          method: 'POST',
          body: JSON.stringify({ action: 'save', content, memoryType: args.memory_type }),
        })
        return { ok: true, note: 'Saved — it survives to every future session.' }
      }

      case 'recall_memory': {
        const query = String(args.query || '').trim()
        const data = await apiFetch('/api/ai/realtime/memory', {
          method: 'POST',
          body: JSON.stringify({ action: 'recall', query, limit: 8 }),
        }) as { results?: Array<{ content: string; created_at: string }> }
        return { ok: true, results: data.results || [], note: (data.results || []).length ? 'Speak from these naturally.' : 'Nothing in memory for that — say so honestly.' }
      }

      case 'bulk_build': {
        const count = Math.min(20, Math.max(1, Number(args.count) || 10))
        const focus = String(args.focus || '').trim()
        const trends = await aiProducts.trends({ family: 'apparel', limit: count, ...(focus ? { seed: focus } : {}) })
        const prompts = (trends.ideas || []).slice(0, count).map((i) => i.prompt).filter(Boolean)
        if (!prompts.length) throw new Error('The trend scout came back empty — try a different focus.')
        // Fire-and-forget: the batch takes minutes; the board calls the score.
        void apiFetch('/api/admin/products/ai/bulk', {
          method: 'POST',
          body: JSON.stringify({ prompts }),
        }).then((res) => {
          const r = res as { succeeded?: number; failed?: number }
          sendBoardUpdateRef.current(`BULK DROP COMPLETE: ${r.succeeded ?? '?'} of ${prompts.length} designs built and sitting as drafts in the products list${r.failed ? ` (${r.failed} failed — they can be retried)` : ''}. Remind the admin: Ready-for-Etsy panel turns drafts into listings.`)
        }).catch(() => {
          sendBoardUpdateRef.current('The bulk drop hit an error partway — some designs may still have landed as drafts. Offer to check and rerun.')
        })
        return { ok: true, started: prompts.length, note: `Bulk drop launched — ${prompts.length} trend-backed designs running the full pipeline. Takes a few minutes; the board will call the final score. Keep building or keep talking meanwhile.` }
      }

      case 'create_watchtower_task': {
        const title = String(args.title || '').trim()
        const description = String(args.description || '').trim()
        if (!title || !description) throw new Error('Need both a title and a description.')
        const data = await apiFetch('/api/watchtower/tasks', {
          method: 'POST',
          body: JSON.stringify({ title, description, priority: args.priority || 'medium', source: 'itp-mr-imagine' }),
        }) as { ok?: boolean; taskId?: string }
        dispatch({ type: 'TASK_FILED', task: { taskId: data.taskId, title } })
        return { ok: true, taskId: data.taskId, note: 'Task is on the Watchtower board as pending — the dev fleet will pick it up.' }
      }

      default:
        return { ok: false, error: 'unknown tool' }
    }
  }, [])

  const { status, error, agentTranscript, userTranscript, toolActivity, start, stop, sendBoardUpdate } =
    useMrImagineLive({ tools: TOOLS, onToolCall: handleToolCall })
  sendBoardUpdateRef.current = sendBoardUpdate

  // ------------------------------------------------- shirt/metal pipeline poll
  const pollPipeline = useCallback(async () => {
    const b = buildRef.current
    if (!b.productId || b.lane === '3d-print') return
    try {
      const data = await aiProducts.getStatus(b.productId) as {
        product?: { metadata?: Record<string, unknown> }
        assets?: Array<{ id: string; kind: string; url: string; asset_role?: string; is_primary?: boolean; metadata?: Record<string, unknown>; meta?: Record<string, unknown> }>
        jobs?: AIJob[]
      }
      const assets = data.assets || []
      const jobs = data.jobs || []
      const productMeta = (data.product?.metadata || {}) as {
        etsy_shots?: { status?: string; images?: string[]; cast?: string[]; checks?: Array<{ ok?: boolean; reason?: string }> }
        hero_video?: { status?: string; url?: string }
      }
      const terminal = (j: AIJob) => j.status === 'succeeded' || j.status === 'failed' || j.status === 'skipped'
      const imageJobs = jobs.filter((j) => j.type === 'replicate_image' || j.type === 'replicate_image_v2')
      const mockupJobs = jobs.filter((j) => j.type === 'replicate_mockup' || j.type === 'replicate_mockup_v2' || j.type === 'ghost_mannequin')
      const rembgJobs = jobs.filter((j) => j.type === 'replicate_rembg')

      const candidates: Candidate[] = assets
        .filter((a) => a.kind === 'source')
        .map((a) => ({ id: a.id, url: a.url, label: String(a.metadata?.model_id ?? a.meta?.model_id ?? '').split('/').pop() || undefined }))
      const mockups: MockupAsset[] = assets
        .filter((a) => a.kind === 'mockup' || a.asset_role?.startsWith('mockup_'))
        .map((a) => ({ id: a.id, url: a.url, label: a.asset_role === 'mockup_flat_lay' ? 'Flat lay' : a.asset_role === 'mockup_mr_imagine' ? 'Mr. Imagine' : 'Mockup' }))
      const nobg = assets.find((a) => a.kind === 'nobg')
      const primary = assets.find((a) => a.is_primary || a.asset_role === 'design')

      // Model shoot state (written by the shared Etsy shoot service).
      const shots = productMeta.etsy_shots
      const modelShots: ModelShot[] = (shots?.images || []).map((url, i) => ({
        url,
        ok: shots?.checks?.[i]?.ok !== false,
        label: shots?.cast?.[i],
        reason: shots?.checks?.[i]?.reason,
      }))

      // Hero video: while generating, the status endpoint is what advances it
      // (it finalizes the mp4 into GCS on success).
      let heroVideo: HeroVideo | null = productMeta.hero_video ? { status: productMeta.hero_video.status || 'unknown', url: productMeta.hero_video.url } : null
      if (heroVideo?.status === 'generating') {
        try {
          const hv = await apiFetch(`/api/ai/realtime/spin-video/${b.productId}/status`) as { status?: string; url?: string }
          if (hv?.status) heroVideo = { status: hv.status, url: hv.url }
        } catch { /* keep generating state */ }
      }

      dispatch({
        type: 'SYNC_PIPELINE',
        candidates,
        mockups,
        selectedDesignUrl: (nobg || primary)?.url || null,
        nobgDone: !!nobg,
        generating: jobs.some((j) => !terminal(j)) || shots?.status === 'generating' || heroVideo?.status === 'generating',
        modelShots,
        heroVideo,
      })

      const announce = (key: string, text: string) => {
        if (announcedRef.current.has(key)) return
        announcedRef.current.add(key)
        sendBoardUpdateRef.current(text)
      }

      if (shots?.status === 'ready' && modelShots.length > 0) {
        const flagged = modelShots.filter((s) => !s.ok)
        announce(`shots:${modelShots.map((s) => s.url).join('|')}`,
          `Model shots are in — ${modelShots.length} photo${modelShots.length === 1 ? '' : 's'} on the board${modelShots[0]?.label ? ` (cast: ${modelShots.map((s) => s.label).filter(Boolean).join(', ')})` : ''}.${flagged.length ? ` Heads up: ${flagged.length} shot${flagged.length === 1 ? '' : 's'} got flagged by the fidelity check — offer a reshoot.` : ' The design survived the fidelity check on every shot.'} Offer the spin video next — that's the signature.`)
      }
      if (shots?.status === 'failed') {
        announce('shotsfail', 'The model shoot failed. Offer to run it again.')
      }
      if (heroVideo?.status === 'ready' && heroVideo.url) {
        announce(`herovideo:${heroVideo.url}`, 'THE SPIN VIDEO IS READY — it is playing on the board right now. If they love it, it ships as the product page hero automatically on publish.')
      }
      if (heroVideo?.status === 'failed') {
        announce('herovideofail', 'The spin video generation failed. Offer to run it again — sometimes a different model shot animates better.')
      }

      if (imageJobs.length > 0 && imageJobs.every(terminal)) {
        if (candidates.length > 0) {
          const failed = imageJobs.filter((j) => j.status === 'failed').length
          announce('candidates', `Design generation finished — ${candidates.length} candidate${candidates.length === 1 ? '' : 's'} on screen, numbered 1 to ${candidates.length}.${failed ? ` (${failed} model${failed === 1 ? '' : 's'} failed, the rest made it.)` : ''} Ask which number wins.`)
        } else {
          announce('genfail', 'Bad news — every design model failed this run. Apologize, suggest tweaking the brief, and offer to generate again.')
        }
      }
      for (const j of rembgJobs) {
        if (j.status === 'succeeded') announce(`rembg:${j.id}`, 'Background removal is done — the clean cutout just replaced the design on screen.')
        if (j.status === 'failed') announce(`rembgfail:${j.id}`, 'The background removal job failed. Offer to try it again.')
      }
      if (mockupJobs.length > 0 && mockupJobs.every(terminal) && mockups.length > 0) {
        announce(`mockups:${mockupJobs.map((j) => j.id).sort().join(',')}`, `Mockups are in — ${mockups.map((m) => m.label).join(' and ')} on screen. Ask if they like them, then it's publish time.`)
      }
    } catch { /* transient poll failure — next tick retries */ }
  }, [])

  useEffect(() => {
    if (!build.productId || build.lane === '3d-print' || build.published !== null) return
    const iv = setInterval(() => { void pollPipeline() }, 4000)
    return () => clearInterval(iv)
  }, [build.productId, build.lane, build.published, pollPipeline])

  // ------------------------------------------------------------ 3D lane poll
  const poll3d = useCallback(async () => {
    const b = buildRef.current
    if (!b.model3dId) return
    try {
      const data = await apiFetch(`/api/3d-models/${b.model3dId}`) as { model?: { status: string; concept_image_url?: string; glb_url?: string; error_message?: string } }
      const m = data.model
      if (!m) return
      const announce = (key: string, text: string) => {
        if (announcedRef.current.has(key)) return
        announcedRef.current.add(key)
        sendBoardUpdateRef.current(text)
      }
      if (m.status !== last3dStatusRef.current) {
        last3dStatusRef.current = m.status
        if (m.status === 'awaiting_approval' && m.concept_image_url) {
          dispatch({ type: 'CONCEPT_READY', url: m.concept_image_url })
          announce('concept', 'The 3D concept image is up on screen. Ask if it is approved as-is, or what to change.')
        }
        if (m.status === 'failed') {
          announce(`3dfail:${m.error_message || 'unknown'}`, `The 3D job failed${m.error_message ? ` — ${m.error_message}` : ''}. The ITC was refunded automatically. Offer to adjust the brief and retry.`)
        }
      }
      if (m.glb_url && !buildRef.current.glbUrl) {
        dispatch({ type: 'GLB_READY', url: m.glb_url })
        announce('glb', 'The 3D model is DONE — the printable file is ready and on screen. Close it out whenever they are happy.')
      }
    } catch { /* transient poll failure */ }
  }, [])

  useEffect(() => {
    if (!build.model3dId || build.lane !== '3d-print' || build.published !== null) return
    const iv = setInterval(() => { void poll3d() }, 5000)
    return () => clearInterval(iv)
  }, [build.model3dId, build.lane, build.published, poll3d])

  // ----------------------------------------------------------------- guards
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return (
      <div className="min-h-screen bg-bg text-text py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-8 backdrop-blur-sm">
            <div className="flex items-center space-x-3 text-red-400">
              <AlertTriangle className="w-6 h-6" />
              <p className="text-lg font-medium">Access denied. This page is for administrators and managers only.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const live = status !== 'idle' && status !== 'error'
  const busyTool = toolActivity.some((t) => t.status === 'running')

  return (
    <div className="min-h-screen bg-bg text-text py-6 sm:py-8 relative overflow-hidden">
      <HoneycombBackdrop />
      {/* ambient glow */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px] opacity-50 mix-blend-screen" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-[128px] opacity-50 mix-blend-screen" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-400 to-secondary drop-shadow-[0_0_15px_rgba(168,85,247,0.5)] font-tech tracking-wide">
            IMAGINE STUDIO
          </h1>
          <p className="text-base sm:text-lg text-muted max-w-2xl mx-auto">
            {mode === 'steps'
              ? 'One idea in. Approve each step. Product and Etsy listing out.'
              : mode === 'studio'
                ? 'Talk it. Watch Mr. Imagine build it — shirts, metal art, 3D prints.'
                : 'Classic wizard — describe, refine, and ship production-ready mockups.'}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {/* mode toggle */}
            <div className="inline-flex rounded-xl border border-white/10 bg-card/60 p-1 backdrop-blur-sm">
              <button
                onClick={() => setMode('steps')}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${mode === 'steps' ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-glowSm' : 'text-muted hover:text-text'}`}
              >
                <span className="inline-flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5" /> Step Flow</span>
              </button>
              <button
                onClick={() => setMode('studio')}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${mode === 'studio' ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-glowSm' : 'text-muted hover:text-text'}`}
              >
                <span className="inline-flex items-center gap-1.5"><Radio className="w-3.5 h-3.5" /> Live Studio</span>
              </button>
              <button
                onClick={() => setMode('classic')}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${mode === 'classic' ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-glowSm' : 'text-muted hover:text-text'}`}
              >
                Classic Wizard
              </button>
            </div>
            <button
              onClick={() => setOneShotOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-primary to-secondary text-white text-sm font-bold shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:shadow-[0_0_30px_rgba(168,85,247,0.6)] hover:scale-105 transition-all"
            >
              <Wand2 className="w-4 h-4" /> 1-Shot <span className="text-[10px] px-1.5 py-0.5 bg-white/20 rounded">FAST</span>
            </button>
            <button
              onClick={() => setBulkOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white text-sm font-bold shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:shadow-[0_0_30px_rgba(16,185,129,0.6)] hover:scale-105 transition-all"
            >
              <Layers className="w-4 h-4" /> Bulk <span className="text-[10px] px-1.5 py-0.5 bg-white/20 rounded">UP TO 20</span>
            </button>
          </div>
        </div>

        {mode === 'classic' ? (
          <div className="bg-card/30 backdrop-blur-md border border-white/10 rounded-3xl p-1 shadow-2xl ring-1 ring-white/5">
            <div className="bg-bg/50 rounded-[20px] p-3 sm:p-6 md:p-8">
              <AdminCreateProductWizard />
            </div>
          </div>
        ) : mode === 'steps' ? (
          <StepFlowBuilder productId={stepFlowProductId} />
        ) : (
          <>
            {/* Hex step tracker */}
            <div className="mb-8">
              <HexStepTracker build={build} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Left — Mr. Imagine live */}
              <div className="lg:col-span-2 p-6 flex flex-col items-center gap-5 h-fit">
                <MrImagineOrb status={status} busy={busyTool} />

                <div className="font-tech uppercase tracking-widest text-xs text-muted text-center">
                  {status === 'idle' && 'Standing by'}
                  {status === 'connecting' && 'Opening the line…'}
                  {status === 'listening' && <span className="text-emerald-400">Listening</span>}
                  {status === 'speaking' && <span className="text-primary">Mr. Imagine</span>}
                  {status === 'error' && <span className="text-red-400">Line down</span>}
                </div>

                {!live ? (
                  <button
                    onClick={() => { void start() }}
                    className="inline-flex items-center gap-2.5 px-10 py-4 bg-gradient-to-r from-primary to-secondary text-white font-bold text-lg shadow-glow hover:scale-105 transition-all"
                    style={{ clipPath: HEX_CLIP }}
                  >
                    <Mic className="w-5 h-5" /> Start Session
                  </button>
                ) : (
                  <button
                    onClick={stop}
                    className="inline-flex items-center gap-2.5 px-10 py-4 bg-card border border-red-400/40 text-red-400 font-bold text-lg hover:bg-red-500/10 transition-all"
                    style={{ clipPath: HEX_CLIP }}
                  >
                    <Square className="w-4 h-4" /> End Session
                  </button>
                )}

                {error && (
                  <div className="w-full text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</div>
                )}

                {/* transcripts */}
                <div className="w-full space-y-2 min-h-[72px]">
                  {userTranscript && (
                    <p className="text-sm text-muted"><span className="font-tech text-[10px] uppercase tracking-widest mr-2 text-emerald-400">You</span>{userTranscript}</p>
                  )}
                  {agentTranscript && (
                    <p className="text-sm text-text"><span className="font-tech text-[10px] uppercase tracking-widest mr-2 text-primary">Mr. I</span>{agentTranscript}</p>
                  )}
                </div>

                {/* tool activity */}
                {toolActivity.length > 0 && (
                  <div className="w-full space-y-1.5">
                    {toolActivity.slice(-4).map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-xs text-muted">
                        <span className={`w-2 h-2 shrink-0 ${t.status === 'running' ? 'bg-amber-400 animate-pulse' : t.status === 'done' ? 'bg-emerald-400' : 'bg-red-400'}`} style={{ clipPath: HEX_CLIP }} />
                        <span className="font-tech uppercase tracking-wide">{t.name.replace(/_/g, ' ')}</span>
                        {t.label && <span className="truncate">— {t.label}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* watchtower filings */}
                {build.filedTasks.length > 0 && (
                  <div className="w-full border-t border-white/10 pt-3 space-y-1">
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted">Filed to Watchtower</div>
                    {build.filedTasks.map((t, i) => (
                      <div key={i} className="text-xs text-text truncate">✓ {t.title}</div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => {
                    dispatch({ type: 'RESET' })
                    announcedRef.current.clear()
                    last3dStatusRef.current = ''
                    sendBoardUpdate('The admin reset the board — fresh build, start from product type.')
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-text transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> New build
                </button>
              </div>

              {/* Right — the build board */}
              <div className="lg:col-span-3 p-6 space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted">Build board</div>
                    <div className="text-lg font-bold">
                      {build.productName || (build.lane ? ({ shirt: 'Shirt build', 'metal-art': `Metal art — ${build.metalSize}`, '3d-print': '3D print build', 'photo-template': 'Photo template build' } as const)[build.lane] : 'Waiting on the first call…')}
                    </div>
                  </div>
                  {build.generating && (
                    <span className="inline-flex items-center gap-2 text-xs text-amber-400 font-tech uppercase tracking-widest">
                      <span className="w-2.5 h-2.5 bg-amber-400 animate-pulse" style={{ clipPath: HEX_CLIP }} /> Working
                    </span>
                  )}
                </div>

                {build.brief && (
                  <p className="text-sm text-muted border-l-2 border-primary/50 pl-3 italic">“{build.brief.prompt}”</p>
                )}

                {/* research pull */}
                {build.research && (
                  <div>
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted mb-2">Trend research</div>
                    <div className="text-sm text-text/90 bg-bg/40 border border-secondary/30 rounded-xl px-4 py-3 whitespace-pre-wrap max-h-56 overflow-y-auto">
                      {build.research}
                    </div>
                  </div>
                )}

                {/* candidates */}
                {build.candidates.length > 0 && !build.selectedAssetId && (
                  <div>
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted mb-2">Candidates — call the number</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {build.candidates.map((c, i) => (
                        <div
                          key={c.id}
                          className="relative rounded-xl overflow-hidden border border-white/10 bg-bg/40 animate-reveal-pop"
                          style={{ animationDelay: `${i * 110}ms`, opacity: 0 }}
                        >
                          <img src={c.url} alt={`Candidate ${i + 1}`} className="w-full aspect-square object-contain" />
                          <div className="absolute top-2 left-2 w-8 h-8 flex items-center justify-center bg-gradient-to-br from-primary to-secondary text-white text-sm font-bold" style={{ clipPath: HEX_CLIP }}>
                            {i + 1}
                          </div>
                          {c.label && <div className="absolute bottom-0 inset-x-0 text-[10px] text-center py-1 bg-bg/70 text-muted">{c.label}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* selected design */}
                {build.selectedDesignUrl && build.selectedAssetId && (
                  <div>
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted mb-2">
                      Winning design{build.nobgDone ? ' — clean cutout' : ''}
                    </div>
                    <div className="rounded-xl overflow-hidden border border-primary/40 bg-bg/40 max-w-sm shadow-glowSm animate-reveal-pop animate-reveal-flash">
                      <img src={build.selectedDesignUrl} alt="Selected design" className="w-full object-contain" />
                    </div>
                  </div>
                )}

                {/* mockups */}
                {build.mockups.length > 0 && (
                  <div>
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted mb-2">Mockups</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {build.mockups.map((m, i) => (
                        <div
                          key={m.id}
                          className="rounded-xl overflow-hidden border border-white/10 bg-bg/40 animate-reveal-pop"
                          style={{ animationDelay: `${i * 110}ms`, opacity: 0 }}
                        >
                          <img src={m.url} alt={m.label} className="w-full aspect-square object-cover" />
                          <div className="text-[10px] text-center py-1 text-muted">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* model shots */}
                {build.modelShots.length > 0 && (
                  <div>
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted mb-2">Model shots — the house look</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {build.modelShots.map((s, i) => (
                        <div key={s.url} className={`rounded-xl overflow-hidden border ${s.ok ? 'border-white/10' : 'border-amber-400/60'} bg-bg/40`}>
                          <img src={s.url} alt={`Model shot ${i + 1}`} className="w-full aspect-[3/4] object-cover" />
                          <div className="text-[10px] text-center py-1 text-muted">
                            {s.label || `Shot ${i + 1}`}{!s.ok && <span className="text-amber-400"> — fidelity flag</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* spin hero video */}
                {build.heroVideo && (
                  <div>
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted mb-2">
                      Spin hero video{build.heroVideo.status === 'generating' ? ' — rendering…' : build.heroVideo.status === 'failed' ? ' — failed' : ''}
                    </div>
                    {build.heroVideo.status === 'ready' && build.heroVideo.url ? (
                      <video
                        src={build.heroVideo.url}
                        autoPlay muted loop playsInline controls
                        className="rounded-xl border border-primary/40 max-w-sm w-full shadow-glowSm"
                      />
                    ) : build.heroVideo.status === 'generating' ? (
                      <div className="flex items-center gap-3 text-sm text-muted bg-bg/40 border border-white/10 rounded-xl px-4 py-3">
                        <span className="w-2.5 h-2.5 bg-amber-400 animate-pulse" style={{ clipPath: HEX_CLIP }} />
                        Grok is filming the turn + color change — a couple of minutes.
                      </div>
                    ) : null}
                  </div>
                )}

                {/* 3D lane visuals */}
                {build.lane === '3d-print' && build.concept3dUrl && (
                  <div>
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted mb-2">
                      3D concept{build.conceptApproved ? ' — approved' : ' — awaiting your call'}
                    </div>
                    <div className={`rounded-xl overflow-hidden border max-w-sm ${build.conceptApproved ? 'border-emerald-400/50' : 'border-white/10'} bg-bg/40 animate-reveal-pop animate-reveal-flash`}>
                      <img src={build.concept3dUrl} alt="3D concept" className="w-full object-contain" />
                    </div>
                  </div>
                )}
                {build.glbUrl && (
                  <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-400/30 rounded-xl px-4 py-3 animate-reveal-pop animate-reveal-flash">
                    <Check className="w-5 h-5 text-emerald-400" />
                    <div className="text-sm">
                      <span className="font-bold text-emerald-400">Printable 3D model ready.</span>{' '}
                      <a className="underline text-text" href={build.glbUrl} target="_blank" rel="noreferrer">Download GLB</a>
                    </div>
                  </div>
                )}

                {/* publish state */}
                {build.published !== null && (
                  <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${build.published ? 'bg-primary/10 border-primary/40' : 'bg-card border-white/10'}`}>
                    <Check className={`w-5 h-5 ${build.published ? 'text-primary' : 'text-muted'}`} />
                    <span className="text-sm font-bold">{build.published ? 'LIVE on the storefront.' : 'Saved as draft.'}</span>
                  </div>
                )}

                {/* empty-board hint */}
                {!build.lane && (
                  <div className="text-center py-10 text-muted">
                    <p className="text-sm">
                      Hit <span className="text-text font-bold">Start Session</span> and tell Mr. Imagine what you're making —
                      a shirt, metal art, or a 3D print. He'll take it from there.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <OneShotProductModal open={oneShotOpen} onClose={() => setOneShotOpen(false)} />
      <BulkProductModal open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </div>
  )
}

export default AdminAIProductBuilder
