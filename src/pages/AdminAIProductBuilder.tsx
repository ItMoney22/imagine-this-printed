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
import confetti from 'canvas-confetti'
import { Mic, Square, Wand2, Layers, RotateCcw, AlertTriangle, Check, Radio } from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useMrImagineLive, type MrImagineToolDef } from '../hooks/useMrImagineLive'
import { aiProducts, apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'
import AdminCreateProductWizard from '../components/AdminCreateProductWizard'
import OneShotProductModal from '../components/OneShotProductModal'
import BulkProductModal from '../components/BulkProductModal'
import type { AIJob, TshirtPrintLocation } from '../types'

// ---------------------------------------------------------------------------
// Build board state machine
// ---------------------------------------------------------------------------

type Lane = 'shirt' | 'metal-art' | '3d-print'
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
interface SizeTier { tier: string; label: string; description: string; itcCost: number }
interface FiledTask { taskId?: string; title: string }

interface Brief {
  prompt: string
  style?: string
  tone?: string
  shirtColor: 'black' | 'white' | 'gray'
  printLocations: TshirtPrintLocation[]
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
}

type BuildAction =
  | { type: 'SET_LANE'; lane: Lane; metalSize?: '4x6' | '8x10' }
  | { type: 'SET_BRIEF'; brief: Brief }
  | { type: 'GENERATE_STARTED'; productId?: string; productName?: string; model3dId?: string }
  | { type: 'SYNC_PIPELINE'; candidates: Candidate[]; mockups: MockupAsset[]; selectedDesignUrl: string | null; nobgDone: boolean; generating: boolean }
  | { type: 'DESIGN_SELECTED'; assetId: string }
  | { type: 'CONCEPT_READY'; url: string }
  | { type: 'CONCEPT_APPROVED' }
  | { type: 'GLB_READY'; url: string }
  | { type: 'PUBLISHED'; live: boolean }
  | { type: 'TASK_FILED'; task: FiledTask }
  | { type: 'RESET' }

function buildReducer(state: BuildState, action: BuildAction): BuildState {
  switch (action.type) {
    case 'SET_LANE':
      // A new lane restarts the board but keeps the session's Watchtower log.
      return { ...initialBuild, filedTasks: state.filedTasks, lane: action.lane, metalSize: action.metalSize || state.metalSize }
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
    case 'polish': return is3d ? !!s.glbUrl : (s.mockups.length > 0 || s.nobgDone)
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
    description: 'Lock in what we are building the moment the admin says it: a shirt, metal art, or a 3D print. For metal art also pass the panel size once they choose (4x6 or 8x10).',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['shirt', 'metal-art', '3d-print'] },
        metal_size: { type: 'string', enum: ['4x6', '8x10'], description: 'Metal art only.' },
      },
      required: ['type'],
    },
  },
  {
    type: 'function',
    name: 'set_design_brief',
    description: 'Lock the creative brief once the admin confirms it. prompt is the full design description in your polished words (subject, style, colors, any text). Include shirt_color and print_locations for shirts when discussed.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The confirmed design brief, written to generate well.' },
        style: { type: 'string', description: 'Style keywords, e.g. cartoon, realistic, vintage.' },
        tone: { type: 'string', description: 'Mood/tone, e.g. playful, elegant.' },
        shirt_color: { type: 'string', enum: ['black', 'white', 'gray'] },
        print_locations: { type: 'array', items: { type: 'string', enum: ['front_image', 'back_image', 'pocket'] } },
      },
      required: ['prompt'],
    },
  },
  {
    type: 'function',
    name: 'generate_designs',
    description: 'Fire the design generation for the locked brief. Shirt/metal art: multiple AI models paint candidates in parallel (takes a minute or two — the board will tell you when they land). 3D print: generates the concept image (spends ITC — say the cost first).',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'select_design',
    description: 'Pick the winning design by its on-screen number (1-based). Shirt/metal art lane only.',
    parameters: {
      type: 'object',
      properties: { index: { type: 'integer', description: 'The number shown under the chosen candidate.' } },
      required: ['index'],
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
      <div className="relative w-44 h-44 md:w-52 md:h-52" style={{ filter: glow }}>
        <div className="w-full h-full bg-gradient-to-br from-primary/30 via-card to-secondary/30 flex items-center justify-center overflow-hidden" style={{ clipPath: HEX_CLIP }}>
          <img src={src} alt="Mr. Imagine" className="w-[88%] h-[88%] object-contain select-none" draggable={false} />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const AdminAIProductBuilder: React.FC = () => {
  const { user } = useAuth()
  const [mode, setMode] = useState<'studio' | 'classic'>(() =>
    (localStorage.getItem('itp-ai-builder-mode') === 'classic' ? 'classic' : 'studio'))
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

  useEffect(() => { localStorage.setItem('itp-ai-builder-mode', mode) }, [mode])

  // ------------------------------------------------------------------ tools
  const handleToolCall = useCallback(async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const s = buildRef.current
    switch (name) {
      case 'set_product_type': {
        const lane = String(args.type) as Lane
        if (!['shirt', 'metal-art', '3d-print'].includes(lane)) throw new Error(`Unknown product type "${lane}"`)
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
        return { ok: true, lane, note: 'Shirt lane locked. Get the brief.' }
      }

      case 'set_design_brief': {
        if (!s.lane) throw new Error('Pick a product type first (set_product_type).')
        const prompt = String(args.prompt || '').trim()
        if (!prompt) throw new Error('The brief needs a prompt.')
        const locations = Array.isArray(args.print_locations)
          ? args.print_locations.filter((v): v is TshirtPrintLocation => ['front_image', 'back_image', 'pocket'].includes(String(v)))
          : []
        dispatch({
          type: 'SET_BRIEF',
          brief: {
            prompt,
            style: args.style ? String(args.style) : undefined,
            tone: args.tone ? String(args.tone) : undefined,
            shirtColor: (['black', 'white', 'gray'].includes(String(args.shirt_color)) ? String(args.shirt_color) : 'black') as Brief['shirtColor'],
            printLocations: locations.length ? locations : ['front_image'],
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
        const fullPrompt = [
          isMetal ? `Metal art panel design: ${brief.prompt}` : brief.prompt,
          brief.style ? `Style: ${brief.style}.` : '',
          brief.tone ? `Mood: ${brief.tone}.` : '',
        ].filter(Boolean).join(' ')
        const res = await aiProducts.create({
          prompt: fullPrompt,
          tone: brief.tone,
          productType: 'tshirt',
          shirtColor: brief.shirtColor,
          print_locations: isMetal ? undefined : brief.printLocations,
          metal_size: isMetal ? buildRef.current.metalSize : undefined,
        })
        dispatch({ type: 'GENERATE_STARTED', productId: res.productId, productName: res.product?.name })
        return { ok: true, productName: res.product?.name, note: 'Generation is rolling — multiple AI models painting in parallel. The board will announce the candidates. Keep the admin company meanwhile.' }
      }

      case 'select_design': {
        const idx = Number(args.index)
        const b = buildRef.current
        if (!b.productId) throw new Error('Nothing generated yet.')
        if (!Number.isFinite(idx) || idx < 1 || idx > b.candidates.length) throw new Error(`Pick a number between 1 and ${b.candidates.length}.`)
        const chosen = b.candidates[idx - 1]
        await aiProducts.selectImage(b.productId, chosen.id)
        dispatch({ type: 'DESIGN_SELECTED', assetId: chosen.id })
        return { ok: true, note: `Design ${idx} locked as the winner. Offer the polish moves: background removal and mockups.` }
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
        assets?: Array<{ id: string; kind: string; url: string; asset_role?: string; is_primary?: boolean; metadata?: Record<string, unknown>; meta?: Record<string, unknown> }>
        jobs?: AIJob[]
      }
      const assets = data.assets || []
      const jobs = data.jobs || []
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
      dispatch({
        type: 'SYNC_PIPELINE',
        candidates,
        mockups,
        selectedDesignUrl: (nobg || primary)?.url || null,
        nobgDone: !!nobg,
        generating: jobs.some((j) => !terminal(j)),
      })

      const announce = (key: string, text: string) => {
        if (announcedRef.current.has(key)) return
        announcedRef.current.add(key)
        sendBoardUpdateRef.current(text)
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
    <div className="min-h-screen bg-bg text-text py-8 relative overflow-hidden">
      <HoneycombBackdrop />
      {/* ambient glow */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px] opacity-50 mix-blend-screen" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-[128px] opacity-50 mix-blend-screen" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-400 to-secondary drop-shadow-[0_0_15px_rgba(168,85,247,0.5)] font-tech tracking-wide">
            IMAGINE STUDIO
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            {mode === 'studio'
              ? 'Talk it. Watch Mr. Imagine build it — shirts, metal art, 3D prints.'
              : 'Classic wizard — describe, refine, and ship production-ready mockups.'}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {/* mode toggle */}
            <div className="inline-flex rounded-xl border border-white/10 bg-card/60 p-1 backdrop-blur-sm">
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
            <div className="bg-bg/50 rounded-[20px] p-6 md:p-8">
              <AdminCreateProductWizard />
            </div>
          </div>
        ) : (
          <>
            {/* Hex step tracker */}
            <div className="mb-8">
              <HexStepTracker build={build} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Left — Mr. Imagine live */}
              <div className="lg:col-span-2 bg-card/40 backdrop-blur-md border border-white/10 rounded-3xl p-6 flex flex-col items-center gap-5 h-fit">
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
              <div className="lg:col-span-3 bg-card/40 backdrop-blur-md border border-white/10 rounded-3xl p-6 space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted">Build board</div>
                    <div className="text-lg font-bold">
                      {build.productName || (build.lane ? ({ shirt: 'Shirt build', 'metal-art': `Metal art — ${build.metalSize}`, '3d-print': '3D print build' } as const)[build.lane] : 'Waiting on the first call…')}
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

                {/* candidates */}
                {build.candidates.length > 0 && !build.selectedAssetId && (
                  <div>
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted mb-2">Candidates — call the number</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {build.candidates.map((c, i) => (
                        <div key={c.id} className="relative rounded-xl overflow-hidden border border-white/10 bg-bg/40">
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
                    <div className="rounded-xl overflow-hidden border border-primary/40 bg-bg/40 max-w-sm shadow-glowSm">
                      <img src={build.selectedDesignUrl} alt="Selected design" className="w-full object-contain" />
                    </div>
                  </div>
                )}

                {/* mockups */}
                {build.mockups.length > 0 && (
                  <div>
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted mb-2">Mockups</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {build.mockups.map((m) => (
                        <div key={m.id} className="rounded-xl overflow-hidden border border-white/10 bg-bg/40">
                          <img src={m.url} alt={m.label} className="w-full aspect-square object-cover" />
                          <div className="text-[10px] text-center py-1 text-muted">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3D lane visuals */}
                {build.lane === '3d-print' && build.concept3dUrl && (
                  <div>
                    <div className="font-tech text-[10px] uppercase tracking-widest text-muted mb-2">
                      3D concept{build.conceptApproved ? ' — approved' : ' — awaiting your call'}
                    </div>
                    <div className={`rounded-xl overflow-hidden border max-w-sm ${build.conceptApproved ? 'border-emerald-400/50' : 'border-white/10'} bg-bg/40`}>
                      <img src={build.concept3dUrl} alt="3D concept" className="w-full object-contain" />
                    </div>
                  </div>
                )}
                {build.glbUrl && (
                  <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-400/30 rounded-xl px-4 py-3">
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
