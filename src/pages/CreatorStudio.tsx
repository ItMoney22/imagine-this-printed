import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, Loader2, Mic, Send, Sparkles, Square, Wallet } from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { apiFetch } from '../lib/api'
import { useMrImagineLive, type MrImagineToolDef } from '../hooks/useMrImagineLive'

/**
 * Creator Studio — the Mr. Imagine live voice build flow for CREATORS
 * (David 2026-08-09: the admin builder's voice flow, brought to the customer
 * side). Voice-first with click fallbacks: candidates can be tapped and the
 * build/submit buttons work without saying a word.
 *
 * Backend rail: /api/creator/studio/* — creator-gated, ITC-metered,
 * owner-scoped, and the finale is SUBMIT FOR REVIEW, never a live publish.
 * The 3D lane rides the existing owner-scoped /api/3d-models endpoints.
 */

type Lane = 'shirt' | 'metal-art' | '3d-print'
type StepKey = 'type' | 'brief' | 'generate' | 'pick' | 'polish' | 'submit'

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: 'type', label: 'Type' },
  { key: 'brief', label: 'Brief' },
  { key: 'generate', label: 'Generate' },
  { key: 'pick', label: 'Pick' },
  { key: 'polish', label: 'Polish' },
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
  // 3D lane
  model3dId: string | null
  concept3dUrl: string | null
  conceptApproved: boolean
  glbUrl: string | null
}

const initialBuild: BuildState = {
  lane: null,
  metalSize: '4x6',
  brief: null,
  productId: null,
  productName: null,
  candidates: [],
  selectedAssetId: null,
  mockups: [],
  modelShots: [],
  siblings: [],
  generating: false,
  submitted: false,
  model3dId: null,
  concept3dUrl: null,
  conceptApproved: false,
  glbUrl: null,
}

type Action =
  | { type: 'SET_LANE'; lane: Lane; metalSize?: '4x6' | '8x10' }
  | { type: 'SET_BRIEF'; brief: Brief }
  | { type: 'GENERATE_STARTED'; productId?: string; productName?: string; model3dId?: string }
  | { type: 'SYNC_PIPELINE'; candidates: Candidate[]; mockups: MockupAsset[]; modelShots: ModelShot[]; generating: boolean }
  | { type: 'DESIGN_SELECTED'; assetId: string; siblings: Array<{ productId: string; name: string }> }
  | { type: 'CONCEPT_READY'; url: string }
  | { type: 'CONCEPT_APPROVED' }
  | { type: 'GLB_READY'; url: string }
  | { type: 'SUBMITTED' }
  | { type: 'RESET' }

function reducer(s: BuildState, a: Action): BuildState {
  switch (a.type) {
    case 'SET_LANE': return { ...initialBuild, lane: a.lane, metalSize: a.metalSize || s.metalSize }
    case 'SET_BRIEF': return { ...s, brief: a.brief }
    case 'GENERATE_STARTED': return {
      ...s, generating: true, candidates: [], mockups: [], modelShots: [], selectedAssetId: null, siblings: [],
      productId: a.productId ?? s.productId, productName: a.productName ?? s.productName, model3dId: a.model3dId ?? s.model3dId,
    }
    case 'SYNC_PIPELINE': return { ...s, candidates: a.candidates, mockups: a.mockups, modelShots: a.modelShots, generating: a.generating }
    case 'DESIGN_SELECTED': return { ...s, selectedAssetId: a.assetId, siblings: a.siblings }
    case 'CONCEPT_READY': return { ...s, concept3dUrl: a.url, generating: false }
    case 'CONCEPT_APPROVED': return { ...s, conceptApproved: true, generating: true }
    case 'GLB_READY': return { ...s, glbUrl: a.url, generating: false }
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
    case 'pick': return b.lane === '3d-print' ? b.conceptApproved : !!b.selectedAssetId
    case 'polish': return b.lane === '3d-print' ? !!b.glbUrl : b.mockups.length > 0
    case 'submit': return b.submitted
  }
}

// ---------------------------------------------------------------------------
// Tools Mr. Imagine can drive — the creator set. No admin machinery.
// ---------------------------------------------------------------------------
const TOOLS: MrImagineToolDef[] = [
  {
    type: 'function',
    name: 'set_product_type',
    description: 'Lock in what we are building: a shirt, metal art, or a 3D print. For metal art also pass the panel size once chosen (4x6 or 8x10).',
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
    description: 'Lock the creative brief once the creator confirms it. prompt is the full design description in your polished words. For shirts, ask where the print goes and pass print_placement; pass print_size_inches if they name a size (11 is the adult standard).',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The confirmed design brief, written to generate well.' },
        style: { type: 'string', description: 'Style keywords, e.g. cartoon, realistic, vintage.' },
        tone: { type: 'string', description: 'Mood/tone, e.g. playful, elegant.' },
        shirt_color: { type: 'string', enum: ['black', 'white', 'gray'] },
        print_placement: {
          type: 'string',
          enum: ['front-center', 'left-pocket', 'back-only', 'front-back', 'pocket-front-back-full'],
          description: 'front-back = same design on both sides.',
        },
        print_size_inches: { type: 'integer', description: 'Print width in inches: 8 youth, 11 adult standard, 13 XL.' },
      },
      required: ['prompt'],
    },
  },
  {
    type: 'function',
    name: 'get_pricing',
    description: 'Current ITC costs (generate = the 4-design fan-out, buildPerProduct = mockups + model photos per picked design) and the creator\'s wallet balance. Call BEFORE quoting a cost out loud.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'generate_designs',
    description: 'Fire design generation for the locked brief — four AI models paint candidates in parallel. SPENDS ITC: call get_pricing and say the cost out loud FIRST, and only fire on a yes. 3D lane: starts the concept image instead.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'select_design',
    description: 'Build product(s) from the numbered designs on screen. Pass every number they love in indexes — the first is the main build and each extra becomes its OWN product. SPENDS ITC per pick (buildPerProduct): say the total out loud first, fire on a yes.',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'integer', description: 'Single pick.' },
        indexes: { type: 'array', items: { type: 'integer' }, description: 'Multiple picks — one product each.' },
      },
    },
  },
  {
    type: 'function',
    name: 'approve_concept',
    description: '3D lane only: the creator approved the concept image on screen.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'convert_3d',
    description: '3D lane only: convert the approved concept into a printable model. SPENDS ITC (the size tiers carry their costs — say it first).',
    parameters: {
      type: 'object',
      properties: { size: { type: 'string', description: 'Size tier id from the tiers the page announced.' } },
      required: ['size'],
    },
  },
  {
    type: 'function',
    name: 'submit_product',
    description: 'Send the finished build to the ImagineThisPrinted print shop for human review (usually live within a day). Confirm with the creator first.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'get_build_state',
    description: 'The page is the source of truth — call this to re-sync on where the build stands.',
    parameters: { type: 'object', properties: {} },
  },
]

export default function CreatorStudio() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [build, dispatch] = useReducer(reducer, initialBuild)
  const [creatorChecked, setCreatorChecked] = useState(false)
  const [pricing, setPricing] = useState<{ generate: number; buildPerProduct: number; balance: number } | null>(null)
  const [manualPicks, setManualPicks] = useState<string[]>([])
  const [manualBusy, setManualBusy] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)

  const buildRef = useRef(build)
  buildRef.current = build
  const announcedRef = useRef<Set<string>>(new Set())
  const last3dStatusRef = useRef('')
  const sendBoardUpdateRef = useRef<(t: string) => void>(() => {})

  // Creator gate: not a creator → the signup pitch.
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
      const p = await apiFetch('/api/creator/studio/pricing') as { generate: number; buildPerProduct: number; balance: number }
      setPricing(p)
      return p
    } catch { return null }
  }, [])
  useEffect(() => { if (creatorChecked) void refreshPricing() }, [creatorChecked, refreshPricing])

  // ------------------------------------------------------------- tool calls
  const handleToolCall = useCallback(async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const s = buildRef.current
    switch (name) {
      case 'set_product_type': {
        const lane = String(args.type) as Lane
        if (!['shirt', 'metal-art', '3d-print'].includes(lane)) throw new Error('Unknown product type.')
        const metalSize = args.metal_size === '8x10' ? '8x10' as const : args.metal_size === '4x6' ? '4x6' as const : undefined
        announcedRef.current.clear()
        dispatch({ type: 'SET_LANE', lane, metalSize })
        if (lane === 'metal-art') {
          return { ok: true, lane, note: metalSize ? 'Metal art locked with panel size. Get the brief.' : 'Metal art locked — still need the panel size, 4x6 or 8x10.' }
        }
        return { ok: true, lane, note: lane === '3d-print' ? '3D lane locked. Get the brief.' : 'Shirt lane locked. Get the brief — including where the print goes.' }
      }

      case 'set_design_brief': {
        if (!s.lane) throw new Error('Pick a product type first (set_product_type).')
        const prompt = String(args.prompt || '').trim()
        if (!prompt) throw new Error('The brief needs a prompt.')
        const placement = ['front-center', 'left-pocket', 'back-only', 'front-back', 'pocket-front-back-full'].includes(String(args.print_placement))
          ? String(args.print_placement) as Brief['printPlacement']
          : undefined
        const size = Number(args.print_size_inches)
        dispatch({
          type: 'SET_BRIEF',
          brief: {
            prompt,
            style: args.style ? String(args.style) : undefined,
            tone: args.tone ? String(args.tone) : undefined,
            shirtColor: (['black', 'white', 'gray'].includes(String(args.shirt_color)) ? String(args.shirt_color) : 'black') as Brief['shirtColor'],
            printPlacement: placement,
            printSizeInches: Number.isFinite(size) && size > 0 ? Math.round(size) : undefined,
          },
        })
        return { ok: true, note: 'Brief locked on the board. Say the generation cost, get a yes, then generate.' }
      }

      case 'get_pricing': {
        const p = await refreshPricing()
        if (!p) throw new Error('Pricing is unavailable right now.')
        return { ok: true, ...p, note: 'Say the relevant cost in one short line before any spend.' }
      }

      case 'generate_designs': {
        const b = buildRef.current
        if (!b.lane || !b.brief) throw new Error('Need a product type and a locked brief first.')
        announcedRef.current.clear()

        if (b.lane === '3d-print') {
          const style3d = /cartoon|toy|cute|chibi/i.test(`${b.brief.style || ''} ${b.brief.prompt}`) ? 'cartoon' : 'realistic'
          const data = await apiFetch('/api/3d-models/create', {
            method: 'POST',
            body: JSON.stringify({ prompt: b.brief.prompt, style: style3d }),
          }) as { ok?: boolean; model?: { id: string }; costs?: { concept?: number } }
          if (!data?.model?.id) throw new Error('3D concept could not start.')
          last3dStatusRef.current = 'queued'
          dispatch({ type: 'GENERATE_STARTED', model3dId: data.model.id })
          return { ok: true, note: `Concept generation started (${data.costs?.concept ?? 'a few'} ITC spent). The board reports when the concept lands — usually under a minute.` }
        }

        const res = await apiFetch('/api/creator/studio/create', {
          method: 'POST',
          body: JSON.stringify({
            prompt: b.brief.prompt,
            style: b.brief.style,
            tone: b.brief.tone,
            category: b.lane === 'metal-art' ? 'metal-art' : 'shirts',
            productType: 'tshirt',
            shirtColor: b.brief.shirtColor,
            printPlacement: b.brief.printPlacement,
            printSizeInches: b.brief.printSizeInches,
            metalSize: b.lane === 'metal-art' ? buildRef.current.metalSize : undefined,
          }),
        }) as { productId?: string; product?: { name?: string }; itcCharged?: number }
        if (!res?.productId) throw new Error('Generation could not start.')
        dispatch({ type: 'GENERATE_STARTED', productId: res.productId, productName: res.product?.name })
        void refreshPricing()
        return { ok: true, productName: res.product?.name, itcCharged: res.itcCharged, note: 'Generation is rolling — four AI models painting in parallel. The board will announce the candidates; keep them company meanwhile.' }
      }

      case 'select_design': {
        const b = buildRef.current
        if (!b.productId) throw new Error('Nothing generated yet.')
        const rawIdxs: number[] = Array.isArray(args.indexes) && args.indexes.length > 0
          ? (args.indexes as unknown[]).map(Number)
          : [Number(args.index)]
        const idxs = Array.from(new Set(rawIdxs))
        if (idxs.some((i) => !Number.isFinite(i) || i < 1 || i > b.candidates.length)) {
          throw new Error(`Pick numbers between 1 and ${b.candidates.length}.`)
        }
        const [primary, ...extras] = idxs.map((i) => b.candidates[i - 1])
        const response = await apiFetch(`/api/creator/studio/${b.productId}/select-image`, {
          method: 'POST',
          body: JSON.stringify({ selectedAssetId: primary.id, selectedAssetIds: idxs.map((i) => b.candidates[i - 1].id) }),
        }) as { siblings?: Array<{ productId: string; name: string }>; itcCharged?: number }
        const siblings = Array.isArray(response?.siblings) ? response.siblings : []
        dispatch({ type: 'DESIGN_SELECTED', assetId: primary.id, siblings })
        setManualPicks([])
        void refreshPricing()
        return {
          ok: true,
          itcCharged: response.itcCharged,
          note: extras.length > 0
            ? `Design ${idxs[0]} is the main build and ${siblings.length || extras.length} more product${(siblings.length || extras.length) > 1 ? 's are' : ' is'} spinning up from the other picks. Mockups and model photos render now — react as they land.`
            : `Design ${idxs[0]} locked. Mockups and model photos are rendering — react as they land.`,
        }
      }

      case 'approve_concept': {
        const b = buildRef.current
        if (!b.model3dId || !b.concept3dUrl) throw new Error('No concept to approve yet.')
        const data = await apiFetch(`/api/3d-models/${b.model3dId}/approve`, { method: 'POST', body: '{}' }) as { ok?: boolean; tiers?: Array<{ tier: string; label: string; itcCost: number }> }
        dispatch({ type: 'CONCEPT_APPROVED' })
        return { ok: true, tiers: data?.tiers, note: 'Concept approved. Offer the size tiers (with their ITC costs) and convert when they choose.' }
      }

      case 'convert_3d': {
        const b = buildRef.current
        if (!b.model3dId) throw new Error('No 3D model in flight.')
        const size = String(args.size || '').trim()
        if (!size) throw new Error('Need a size tier.')
        await apiFetch(`/api/3d-models/${b.model3dId}/generate-3d`, { method: 'POST', body: JSON.stringify({ size }) })
        void refreshPricing()
        return { ok: true, note: 'Conversion started — takes a few minutes. The board calls it when the printable model is done.' }
      }

      case 'submit_product': {
        const b = buildRef.current
        if (b.lane === '3d-print') {
          if (!b.glbUrl) throw new Error('The 3D model is not finished yet.')
          dispatch({ type: 'SUBMITTED' })
          return { ok: true, note: 'The printable model is saved to their 3D library under My Designs. Celebrate — build complete.' }
        }
        if (!b.productId) throw new Error('There is no product to submit.')
        if (b.mockups.length === 0) throw new Error('The mockups are still rendering — submit once they are on the board.')
        await apiFetch(`/api/creator/studio/${b.productId}/submit`, { method: 'POST', body: '{}' })
        dispatch({ type: 'SUBMITTED' })
        return { ok: true, note: 'Submitted! It goes to the print shop for a quick human review — usually live within a day, earning their royalty from sale one. Celebrate in one line.' }
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
          sibling_products: b.siblings.length,
          mockups_ready: b.mockups.length,
          model_photos_ready: b.modelShots.length,
          concept_ready: !!b.concept3dUrl,
          concept_approved: b.conceptApproved,
          printable_model_ready: !!b.glbUrl,
          submitted: b.submitted,
          generating: b.generating,
          steps_complete: STEPS.filter((st) => stepDone(b, st.key)).map((st) => st.label),
          itc_balance: pricing?.balance,
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }, [refreshPricing, pricing])

  const { status, error, agentTranscript, userTranscript, toolActivity, start, stop, sendBoardUpdate } =
    useMrImagineLive({ tools: TOOLS, onToolCall: handleToolCall, tokenEndpoint: '/api/creator/studio/token' })
  sendBoardUpdateRef.current = sendBoardUpdate

  // ------------------------------------------------- 2D pipeline poll (4s)
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
      const terminal = (j: { status: string }) => j.status === 'succeeded' || j.status === 'failed' || j.status === 'skipped'
      const imageJobs = jobs.filter((j) => j.type === 'replicate_image' || j.type === 'replicate_image_v2')
      const mockupJobs = jobs.filter((j) => j.type === 'replicate_mockup' || j.type === 'replicate_mockup_v2')

      const candidates: Candidate[] = assets
        .filter((a) => a.kind === 'source')
        .map((a) => ({ id: a.id, url: a.url, label: String(a.metadata?.model_id ?? '').split('/').pop() || undefined }))
      const mockups: MockupAsset[] = assets
        .filter((a) => a.kind === 'mockup' || a.asset_role?.startsWith('mockup_'))
        .map((a) => ({
          id: a.id,
          url: a.url,
          label: a.asset_role === 'mockup_ghost_mannequin' ? 'Product shot'
            : a.asset_role === 'mockup_flat_lay' ? 'Flat lay'
            : a.asset_role === 'mockup_back' ? 'Back view'
            : a.asset_role === 'mockup_pocket' ? 'Pocket scale'
            : a.asset_role === 'mockup_mr_imagine' ? 'Mr. Imagine'
            : a.asset_role?.startsWith('mockup_model') ? 'Model photo'
            : 'Mockup',
        }))
      const shots = ((data.product?.metadata || {}) as any).etsy_shots as { status?: string; images?: string[]; cast?: string[]; checks?: Array<{ ok?: boolean }> } | undefined
      const modelShots: ModelShot[] = (shots?.images || []).map((url, i) => ({
        url,
        ok: shots?.checks?.[i]?.ok !== false,
        label: shots?.cast?.[i],
      }))

      dispatch({
        type: 'SYNC_PIPELINE',
        candidates,
        mockups,
        modelShots,
        generating: jobs.some((j) => !terminal(j)) || shots?.status === 'generating',
      })

      const announce = (key: string, text: string) => {
        if (announcedRef.current.has(key)) return
        announcedRef.current.add(key)
        sendBoardUpdateRef.current(text)
      }

      if (imageJobs.length > 0 && imageJobs.every(terminal)) {
        if (candidates.length > 0) {
          announce('candidates', `Design generation finished — ${candidates.length} candidate${candidates.length === 1 ? '' : 's'} on screen, numbered 1 to ${candidates.length}. Ask which ones they love — they can pick more than one, each becomes its own product.`)
        } else {
          announce('genfail', 'Every design model failed this run — their ITC was refunded automatically. Apologize, suggest a tweak to the brief, and offer to go again.')
        }
      }
      if (mockupJobs.length > 0 && mockupJobs.every(terminal) && mockups.length > 0) {
        announce(`mockups:${mockupJobs.map((j) => j.id).sort().join(',')}`, `Mockups are in — ${mockups.length} shot${mockups.length === 1 ? '' : 's'} on the board. React honestly, then it's submit time.`)
      }
      if (shots?.status === 'ready' && modelShots.length > 0) {
        announce(`shots:${modelShots.map((m) => m.url).join('|')}`, `The model photos landed — real people wearing their design${modelShots[0]?.label ? ` (cast: ${modelShots.map((m) => m.label).filter(Boolean).join(', ')})` : ''}. Big moment — react!`)
      }
    } catch { /* transient poll failure — next tick retries */ }
  }, [])

  useEffect(() => {
    if (!build.productId || build.lane === '3d-print' || build.submitted) return
    const iv = setInterval(() => { void pollPipeline() }, 4000)
    return () => clearInterval(iv)
  }, [build.productId, build.lane, build.submitted, pollPipeline])

  // ------------------------------------------------------------ 3D poll (5s)
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
        announce('glb', 'The 3D model is DONE — the printable file is ready on screen. Close it out whenever they are happy.')
      }
    } catch { /* transient */ }
  }, [])

  useEffect(() => {
    if (!build.model3dId || build.lane !== '3d-print' || build.submitted) return
    const iv = setInterval(() => { void poll3d() }, 5000)
    return () => clearInterval(iv)
  }, [build.model3dId, build.lane, build.submitted, poll3d])

  // ---------------------------------------------------- click-path fallbacks
  const toggleManualPick = (assetId: string) => {
    if (build.selectedAssetId) return
    setManualPicks((prev) => prev.includes(assetId) ? prev.filter((x) => x !== assetId) : [...prev, assetId])
  }

  const manualBuild = async () => {
    if (!build.productId || manualPicks.length === 0) return
    setManualBusy(true)
    setPageError(null)
    try {
      const response = await apiFetch(`/api/creator/studio/${build.productId}/select-image`, {
        method: 'POST',
        body: JSON.stringify({ selectedAssetId: manualPicks[0], selectedAssetIds: manualPicks }),
      }) as { siblings?: Array<{ productId: string; name: string }> }
      dispatch({ type: 'DESIGN_SELECTED', assetId: manualPicks[0], siblings: Array.isArray(response?.siblings) ? response.siblings : [] })
      setManualPicks([])
      void refreshPricing()
    } catch (e: any) {
      setPageError(e.message || 'Build failed')
    } finally {
      setManualBusy(false)
    }
  }

  const manualSubmit = async () => {
    if (!build.productId || build.mockups.length === 0) return
    setManualBusy(true)
    setPageError(null)
    try {
      await apiFetch(`/api/creator/studio/${build.productId}/submit`, { method: 'POST', body: '{}' })
      dispatch({ type: 'SUBMITTED' })
    } catch (e: any) {
      setPageError(e.message || 'Submit failed')
    } finally {
      setManualBusy(false)
    }
  }

  // ------------------------------------------------------------------ render
  if (!user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-muted">Sign in to enter the studio.</p>
      </div>
    )
  }
  if (!creatorChecked) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    )
  }

  const live = status !== 'idle' && status !== 'error'
  const buildCost = pricing ? pricing.buildPerProduct * Math.max(1, manualPicks.length) : null

  return (
    <div className="min-h-screen bg-bg text-text py-6 sm:py-8 relative overflow-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[128px] opacity-50 mix-blend-screen" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-[128px] opacity-50 mix-blend-screen" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-400 to-secondary font-tech tracking-wide">
            CREATOR STUDIO
          </h1>
          <p className="text-muted">Talk it out with Mr. Imagine — shirts, metal art, 3D prints. Your design, your royalty.</p>
          {pricing && (
            <div className="mt-3 inline-flex items-center gap-2 text-sm text-muted bg-card/50 border border-white/10 rounded-full px-4 py-1.5">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="text-text font-semibold">{Math.floor(pricing.balance)} ITC</span>
              <span>· designs {pricing.generate} ITC · build {pricing.buildPerProduct} ITC/product</span>
            </div>
          )}
        </div>

        {/* Step chips */}
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

        <div className="grid lg:grid-cols-[340px_1fr] gap-6">
          {/* Left: Mr. Imagine live column */}
          <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-5 h-fit lg:sticky lg:top-6">
            <div className="text-center">
              <img src="/mr-imagine/mr-imagine-wave.png" alt="Mr. Imagine" className="w-24 h-24 mx-auto mb-3 object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              <button
                onClick={live ? stop : () => void start()}
                className={`w-full font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 ${
                  live
                    ? 'bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30'
                    : 'bg-gradient-to-r from-primary to-secondary text-white shadow-lg shadow-primary/30 hover:from-primary/90 hover:to-secondary/90'
                }`}
              >
                {status === 'connecting' ? (<><Loader2 className="w-5 h-5 animate-spin" /> Connecting…</>)
                  : live ? (<><Square className="w-4 h-4" /> End the call</>)
                  : (<><Mic className="w-5 h-5" /> Talk to Mr. Imagine</>)}
              </button>
              <p className="text-xs text-muted mt-2">
                {status === 'listening' ? 'Listening…' : status === 'speaking' ? 'Mr. Imagine is talking' : live ? 'Live' : 'Voice-first — or use the buttons on the board.'}
              </p>
            </div>

            {(userTranscript || agentTranscript) && (
              <div className="mt-4 space-y-2 text-sm">
                {userTranscript && <p className="text-muted"><span className="text-text font-semibold">You:</span> {userTranscript}</p>}
                {agentTranscript && <p className="text-muted"><span className="text-primary font-semibold">Mr. Imagine:</span> {agentTranscript}</p>}
              </div>
            )}

            {toolActivity.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {toolActivity.slice(-4).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs text-muted">
                    {t.status === 'running' ? <Loader2 className="w-3 h-3 animate-spin text-primary" /> : t.status === 'done' ? <Check className="w-3 h-3 text-emerald-400" /> : <AlertTriangle className="w-3 h-3 text-amber-400" />}
                    {t.label}
                  </div>
                ))}
              </div>
            )}

            {(error || pageError) && (
              <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                <p className="text-red-400 text-xs">{error || pageError}</p>
              </div>
            )}
          </div>

          {/* Right: build board */}
          <div className="space-y-6">
            {/* Empty state */}
            {!build.lane && (
              <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-10 text-center">
                <Sparkles className="w-10 h-10 text-primary mx-auto mb-4" />
                <p className="text-lg text-text font-semibold mb-1">Hit the talk button and say what you want to make.</p>
                <p className="text-muted text-sm">"A shirt for my fishing club" · "Metal art of a desert sunset" · "A little dragon 3D print"</p>
              </div>
            )}

            {/* Brief */}
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

            {/* Generating */}
            {build.generating && build.candidates.length === 0 && !build.concept3dUrl && (
              <div className="bg-card/30 backdrop-blur-md rounded-2xl border border-white/10 p-8 text-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
                <p className="text-muted text-sm">{build.lane === '3d-print' ? 'Sketching the 3D concept…' : 'Four AI models are painting…'}</p>
              </div>
            )}

            {/* Candidates */}
            {build.candidates.length > 0 && !build.selectedAssetId && (
              <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-5">
                <p className="text-sm text-muted mb-3">Say the numbers you love — or tap them. Every pick becomes its own product.</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {build.candidates.map((c, i) => {
                    const picked = manualPicks.includes(c.id)
                    return (
                      <button
                        key={c.id}
                        onClick={() => toggleManualPick(c.id)}
                        className={`relative rounded-2xl overflow-hidden border transition-all text-left ${picked ? 'border-primary ring-2 ring-primary/50' : 'border-white/10 hover:border-primary/40'}`}
                      >
                        <img src={c.url} alt={`Design ${i + 1}`} className="w-full aspect-square object-contain bg-bg/60" />
                        <span className="absolute top-2 left-2 bg-bg/80 text-text text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center border border-white/20">{i + 1}</span>
                        {picked && <span className="absolute top-2 right-2 bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center"><Check className="w-3.5 h-3.5" /></span>}
                        {c.label && <span className="absolute bottom-1.5 left-2 text-[10px] text-muted bg-bg/70 rounded px-1.5 py-0.5">{c.label}</span>}
                      </button>
                    )
                  })}
                </div>
                {manualPicks.length > 0 && (
                  <button
                    onClick={() => void manualBuild()}
                    disabled={manualBusy}
                    className="mt-4 w-full bg-gradient-to-r from-primary to-secondary text-white font-bold py-3 rounded-xl shadow-lg shadow-primary/30 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                  >
                    {manualBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Build {manualPicks.length} product{manualPicks.length > 1 ? 's' : ''}{buildCost ? ` (${buildCost} ITC)` : ''}
                  </button>
                )}
              </div>
            )}

            {/* Siblings note */}
            {build.siblings.length > 0 && (
              <div className="bg-secondary/10 border border-secondary/30 rounded-2xl p-4">
                <p className="text-sm text-text font-semibold mb-1">{build.siblings.length} more product{build.siblings.length > 1 ? 's' : ''} building from your other picks</p>
                <p className="text-xs text-muted">{build.siblings.map((s) => s.name).join(' · ')} — find them in My Designs once their mockups land.</p>
              </div>
            )}

            {/* 3D concept */}
            {build.concept3dUrl && (
              <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-5">
                <p className="text-sm text-muted mb-3">{build.conceptApproved ? (build.glbUrl ? 'Printable model ready!' : 'Converting to a printable model…') : 'The concept — approve it or ask for changes.'}</p>
                <img src={build.concept3dUrl} alt="3D concept" className="w-full max-w-sm mx-auto rounded-2xl border border-white/10" />
                {build.glbUrl && (
                  <p className="text-xs text-emerald-300 mt-3 text-center">Saved to your 3D library — see My Designs → 3D models.</p>
                )}
              </div>
            )}

            {/* Mockups + model shots */}
            {(build.mockups.length > 0 || build.modelShots.length > 0) && (
              <div className="bg-card/30 backdrop-blur-md rounded-3xl border border-white/10 p-5">
                <p className="text-sm text-muted mb-3">Your product shots{build.generating ? ' — still rendering more…' : ''}</p>
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
                {!build.submitted && build.lane !== '3d-print' && build.mockups.length > 0 && (
                  <button
                    onClick={() => void manualSubmit()}
                    disabled={manualBusy}
                    className="mt-4 w-full bg-gradient-to-r from-emerald-500 to-green-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-emerald-500/30 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                  >
                    {manualBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Submit for review
                  </button>
                )}
              </div>
            )}

            {/* Submitted */}
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
                <button
                  onClick={() => { announcedRef.current.clear(); dispatch({ type: 'RESET' }) }}
                  className="bg-card/60 border border-white/10 hover:border-primary/40 text-text font-semibold px-6 py-2.5 rounded-xl transition-all"
                >
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
