// src/lib/api.ts
import { supabase } from "../lib/supabase";
import type {
  AIProductCreationRequest,
  AIProductCreationResponse,
  ProductTrendFamily,
  ProductTrendResponse,
  ProductTrendSource,
  SimpleWordPhraseResponse,
} from '../types'

export const API_BASE = import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:4000' : '')

export async function apiFetch(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

// Axios-compatible API client for components expecting axios interface
const api = {
  get: async (url: string, config?: { params?: Record<string, any> }) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    let fullUrl = `${API_BASE}${url}`
    if (config?.params) {
      const params = new URLSearchParams()
      Object.entries(config.params).forEach(([key, value]) => {
        params.append(key, String(value))
      })
      fullUrl += `?${params.toString()}`
    }

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }))
      throw new Error(error.error || error.message || `HTTP ${response.status}`)
    }

    return { data: await response.json() }
  },

  post: async (url: string, body?: any, config?: any) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    // Handle FormData (for file uploads)
    const isFormData = body instanceof FormData
    const headers: Record<string, string> = {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(config?.headers || {})
    }

    // Only set Content-Type for non-FormData
    if (!isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(`${API_BASE}${url}`, {
      method: 'POST',
      headers,
      body: isFormData ? body : (body ? JSON.stringify(body) : undefined)
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }))
      throw new Error(error.error || error.message || `HTTP ${response.status}`)
    }

    return { data: await response.json() }
  },

  put: async (url: string, body?: any, config?: any) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}${url}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }))
      throw new Error(error.error || error.message || `HTTP ${response.status}`)
    }

    return { data: await response.json() }
  },

  delete: async (url: string, config?: any) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}${url}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }))
      throw new Error(error.error || error.message || `HTTP ${response.status}`)
    }

    return { data: await response.json() }
  }
}

export default api

// AI Product Builder endpoints
export const aiProducts = {
  phrases: async (request: {
    source?: ProductTrendSource
    seed?: string
    limit?: number
  }): Promise<SimpleWordPhraseResponse> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/trends/phrases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  trends: async (request: {
    source?: ProductTrendSource
    family?: ProductTrendFamily
    seed?: string
    limit?: number
  }): Promise<ProductTrendResponse> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/trends`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  create: async (request: AIProductCreationRequest): Promise<AIProductCreationResponse> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  getStatus: async (productId: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/status`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  duplicate: async (productId: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/duplicate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  retryJob: async (jobId: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/jobs/${jobId}/retry`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  removeBackground: async (productId: string, selectedAssetId?: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/remove-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ selectedAssetId }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  createMockups: async (productId: string, selectedAssetId?: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/create-mockups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ selectedAssetId }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  regenerateImages: async (productId: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/regenerate-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  // Pass extra asset ids to build one sibling product per additional pick —
  // the first id keeps the current product, each extra gets a cloned draft.
  selectImage: async (productId: string, selectedAssetId: string, extraAssetIds: string[] = []) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}/select-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(
        extraAssetIds.length > 0
          ? { selectedAssetId, selectedAssetIds: [selectedAssetId, ...extraAssetIds] }
          : { selectedAssetId }
      ),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  // Deletes a draft product outright — used by the Step Flow's Tweak action
  // to clean up the orphaned old draft after a fresh one is created, only
  // when the old draft never had a design approved on it.
  delete: async (productId: string): Promise<{ ok: boolean }> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/products/ai/${productId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },
}

// Etsy pack shape returned by the SEO composer (mirrors AdminEtsyPanel's local
// EtsyPack — no shared type module exists yet, so this is intentionally a
// second small copy rather than a cross-file coupling).
export interface EtsyComposePack {
  title: string
  tags: string[]
  description: string
  price: number
  colors?: string[]
  composed_at: string
  model: string
  edited_at?: string
}

export type EtsyTier = 'primary' | 'transfer' | 'download'

// Etsy API — enqueue a product for Rico's flow (copyright gate → draft → Christina notify).
export const etsy = {
  // SEO composer — Step Flow's Listing step calls this to get an editable
  // title/description/tags/price draft. Reused unchanged from AdminEtsyPanel's
  // Compose button (POST /api/admin/etsy/compose/:id, no body).
  compose: async (productId: string): Promise<{ pack: EtsyComposePack }> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/etsy/compose/${productId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },

  // `tiers` is optional and additive — omitting it keeps the pre-existing
  // AdminDashboard.tsx call site (`etsy.queue(productId)`, defaults to
  // ['primary'] server-side) working unchanged.
  queue: async (productId: string, tiers?: EtsyTier[]) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/etsy/queue/${productId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: tiers ? JSON.stringify({ tiers }) : undefined,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      // Status is attached so the Etsy step can tell a QA-gate 422 (inline
      // reasons) apart from any other failure.
      const err = new Error(error.error || `HTTP ${response.status}`) as Error & { status?: number; body?: any }
      err.status = response.status
      err.body = error
      throw err
    }

    return response.json()
  },

  status: async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const response = await fetch(`${API_BASE}/api/admin/etsy/status`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  },
}

// ---------------------------------------------------------------------------
// Step Flow — Imagine Studio's step-by-step builder (Idea → Design →
// Garments → Mockups → Listing → Etsy). Routes are mounted under
// /api/admin/products/ai/(step/brief | :id/step/*), all requireAuth +
// requireAdmin. See docs/plans/2026-09-01-imagine-studio-step-flow-plan.md
// ("Shared contracts") — the types below mirror that table exactly.
//
// Every write here is deliberately "fire, then GET /:id/step and re-hydrate"
// rather than trusting each write's own partial response, because
// step_flow.approvals on the server is the single source of truth the
// reducer gates on (see components/studio/stepFlowReducer.ts).
// ---------------------------------------------------------------------------

export type StepFlowGarmentId = 'tshirt' | 'hoodie'
export type StepFlowColorId =
  | 'black'
  | 'white'
  | 'navy'
  | 'heather-grey'
  | 'red'
  | 'forest-green'
  | 'royal-blue'

/** A phrase pitched by Mrs. Imagine (or typed by hand) attached to a brief —
 *  mirrors the `phrase` body field `POST /step/brief` accepts. */
export interface SelectedPhrase {
  text: string
  placement: 'below' | 'above' | 'integrated'
}

export interface StepBrief {
  designPrompt: string
  background: 'white' | 'black'
  title: string
  styleTags: string[]
  garmentHint: StepFlowGarmentId
  rationale: string
  /** Text to render into the artwork, set on the Idea step before the brief
   *  is written (a chip picked from Mrs. Imagine's pitches, or typed by
   *  hand). Absent when no phrase was added. */
  phrase?: SelectedPhrase
}

/** One phrase Mrs. Imagine pitches for an idea — `POST /step/phrases`. */
export interface Phrase {
  text: string
  vibe: string
  placement: 'below' | 'above' | 'integrated'
  reason: string
}

export type ShotKey = 'product' | 'hanger' | 'model' | 'details' | `color:${string}`

export interface ShotState {
  jobId?: string
  assetId?: string
  url?: string
  approved: boolean
  status: 'queued' | 'running' | 'done' | 'failed'
  error?: string
  /** Explicitly skipped by the admin (a failed shot they chose not to redo) —
   *  settled, not approved. Counts toward approvals.mockups the same way an
   *  approved shot does, and the reducer's areMockupsResolved treats it the
   *  same as `approved` for gating Listing. */
  skipped?: boolean
  /** `details` only — the `product` shot's assetId this card was rendered
   *  from, so a later redo of `product` can tell a stale details render
   *  apart from a fresh one. */
  sourceAssetId?: string
}

export interface ColorAdvice {
  id: StepFlowColorId
  label: string
  hex: string
  grade: 'great' | 'ok' | 'poor'
  score: number
  reason: string
}

export interface ArtworkStats {
  meanLuma: number
  darkShare: number
  lightShare: number
  coverage: number
  dominantHue: number | null
}

export type StepFlowApprovals = Partial<Record<'design' | 'garments' | 'mockups' | 'listing', string>>

// Print prep — a separate, team-only screened file for the press (never a
// design/nobg asset, never customer-facing). See design doc §10.
export type PrintMethod = 'halftone' | 'diffusion'
export type PrintShape = 'round' | 'line'

export interface PrintAdviceStats {
  smoothShare: number
  colorCount: number
  softEdgeShare: number
}

/** The screen settings print-advice suggests, and also what a rendered
 *  print file's `options` come back as (server-resolved, every field set). */
export interface SuggestedPrintOptions {
  method: PrintMethod
  frequency: number
  angle: number
  shape: PrintShape
  invertDark: boolean
}

export interface PrintAdvice {
  recommend: 'halftone' | 'clean'
  confidence: number
  reason: string
  stats: PrintAdviceStats
  suggested: SuggestedPrintOptions
}

/** POST body for /step/print-file — every field optional; the server fills
 *  in anything omitted from the last print-advice's `suggested` values. */
export interface PrintFileOptions {
  method?: PrintMethod
  frequency?: number
  angle?: number
  shape?: PrintShape
  invertDark?: boolean
}

export interface PrintFile {
  assetId: string
  url: string
  options: SuggestedPrintOptions
  createdAt: string
}

export interface StepFlowMeta {
  version: 1
  idea: string
  // The backend returns `brief: null` for products that weren't born in the
  // flow (e.g. the Admin editor's "Continue in Step Flow" deep link on a
  // classic-wizard product) — every reader must be null-safe.
  brief: StepBrief | null
  garment?: StepFlowGarmentId
  colors?: { primary: StepFlowColorId; extras: StepFlowColorId[] }
  advice?: ColorAdvice[]
  shots: Partial<Record<ShotKey, ShotState>>
  approvals: StepFlowApprovals
  /** Team-only print prep — never gates any approval, purely informational/optional. */
  printAdvice?: PrintAdvice
  printFile?: PrintFile
}

// product_assets row (the columns the flow actually reads).
export interface StepFlowAsset {
  id: string
  kind?: string | null
  asset_role?: string | null
  url?: string | null
  is_primary?: boolean | null
  display_order?: number | null
  created_at?: string | null
  metadata?: Record<string, any> | null
}

// ai_jobs row (the columns the flow actually reads).
export interface StepFlowJob {
  id: string
  product_id: string
  type: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped'
  input?: Record<string, any>
  output?: Record<string, any>
  error?: string
  created_at: string
  updated_at: string
}

export interface StepFlowProductSnapshot {
  id: string
  name?: string | null
  category?: string | null
  metadata?: Record<string, any>
  [key: string]: any
}

export interface StepFlowGetResponse {
  product: StepFlowProductSnapshot
  step_flow: StepFlowMeta
  assets: StepFlowAsset[]
  jobs: StepFlowJob[]
}

async function stepFlowRequest(path: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    const err = new Error(error.error || `HTTP ${response.status}`) as Error & { status?: number; body?: any }
    err.status = response.status
    err.body = error
    throw err
  }
  return response.json()
}

export const stepFlow = {
  /** POST /api/admin/products/ai/step/brief — idea (+ optional phrase) → best-prompt brief. Runs before a product exists. */
  brief: (idea: string, phrase?: SelectedPhrase): Promise<{ brief: StepBrief }> =>
    stepFlowRequest('/api/admin/products/ai/step/brief', {
      method: 'POST',
      body: JSON.stringify(phrase ? { idea, phrase } : { idea }),
    }),

  /** POST /api/admin/products/ai/step/phrases — Mrs. Imagine pitches catchy,
   *  print-friendly phrases for the idea (server-side copyright-gate
   *  filtered). Runs before a product exists, same as `brief`. `intro`, when
   *  present, is her own line to show above the chips — the caller falls
   *  back to a hardcoded line client-side when it's absent. */
  phrases: (
    idea: string,
    brief?: StepBrief,
    count?: number
  ): Promise<{ persona: 'mrs-imagine'; phrases: Phrase[]; intro?: string }> =>
    stepFlowRequest('/api/admin/products/ai/step/phrases', {
      method: 'POST',
      body: JSON.stringify({ idea, ...(brief ? { brief } : {}), ...(count ? { count } : {}) }),
    }),

  /** GET /api/admin/products/ai/:id/step — resume: product + step_flow + assets + jobs, merged. */
  get: (productId: string): Promise<StepFlowGetResponse> =>
    stepFlowRequest(`/api/admin/products/ai/${productId}/step`),

  /** Marks the chosen take primary and queues background removal — never queues mockups. */
  selectDesign: (
    productId: string,
    assetId: string
  ): Promise<{ ok: boolean; asset: StepFlowAsset; rembgJob: StepFlowJob | null }> =>
    stepFlowRequest(`/api/admin/products/ai/${productId}/step/select-design`, {
      method: 'POST',
      body: JSON.stringify({ assetId }),
    }),

  /** Measures the nobg (falls back to source) asset and ranks ITP colors by contrast to the artwork. */
  colorAdvice: (productId: string): Promise<{ advice: ColorAdvice[]; artwork: ArtworkStats }> =>
    stepFlowRequest(`/api/admin/products/ai/${productId}/step/color-advice`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** Approves garment + colors; writes product_type/shirt_color/colors/print_placement/category. */
  garments: (
    productId: string,
    payload: { garment: StepFlowGarmentId; primaryColor: StepFlowColorId; extraColors: StepFlowColorId[] }
  ): Promise<{ ok: boolean; step_flow: StepFlowMeta }> =>
    stepFlowRequest(`/api/admin/products/ai/${productId}/step/garments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  /** Fires mockup jobs. Omit `keys` to queue every key for the approved garment/colors. */
  shots: (productId: string, keys?: ShotKey[]): Promise<{ jobs: Array<{ key: ShotKey; jobId: string | null }> }> =>
    stepFlowRequest(`/api/admin/products/ai/${productId}/step/shots`, {
      method: 'POST',
      body: JSON.stringify(keys ? { keys } : {}),
    }),

  /** Re-queues one shot with a fresh nonce; the old asset stays (unapproved) until the redo lands. */
  redoShot: (productId: string, key: ShotKey): Promise<{ job: StepFlowJob }> =>
    stepFlowRequest(`/api/admin/products/ai/${productId}/step/shots/${encodeURIComponent(key)}/redo`, {
      method: 'POST',
    }),

  /** Approves (or rejects) one shot's asset. `skipped` marks a failed shot as
   *  settled without redoing it — `assetId` is optional so an orphaned/never-
   *  rendered shot can still be skipped. */
  approveShot: (
    productId: string,
    key: ShotKey,
    approved: boolean,
    assetId?: string,
    skipped?: boolean
  ): Promise<{ step_flow: StepFlowMeta }> =>
    stepFlowRequest(`/api/admin/products/ai/${productId}/step/shots/${encodeURIComponent(key)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approved, assetId, skipped }),
    }),

  /** Batch approve/skip — POST /:id/step/shots/approve. "Approve all" fires
   *  this ONCE instead of N parallel per-key approveShot calls racing each
   *  other's read-modify-write of the same step_flow.shots object. */
  approveShots: (
    productId: string,
    keys: ShotKey[],
    approved: boolean,
    skipped?: boolean
  ): Promise<{ step_flow: StepFlowMeta }> =>
    stepFlowRequest(`/api/admin/products/ai/${productId}/step/shots/approve`, {
      method: 'POST',
      body: JSON.stringify({ keys, approved, skipped }),
    }),

  /** Measures the nobg asset for halftone-vs-clean printability (smooth-ramp
   *  share, color count, soft-edge share) and returns a suggested screen.
   *  Never gates any approval — purely advisory. */
  printAdvice: (productId: string): Promise<{ advice: PrintAdvice }> =>
    stepFlowRequest(`/api/admin/products/ai/${productId}/step/print-advice`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /** Renders the team-only halftone/diffusion print file from the nobg asset
   *  (synchronous, ~3-8s). Redo overwrites — one print file per product. */
  printFile: (productId: string, options?: PrintFileOptions): Promise<{ printFile: PrintFile }> =>
    stepFlowRequest(`/api/admin/products/ai/${productId}/step/print-file`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    }),

  /** Publishes: status active, images from buildProductGallery, stamps approvals.listing. */
  publish: (
    productId: string,
    payload: { title: string; description: string; tags: string[]; price: number }
  ): Promise<{ product: StepFlowProductSnapshot }> =>
    stepFlowRequest(`/api/admin/products/ai/${productId}/step/publish`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}

// Mrs. Imagine — autonomous house designer: realtime Etsy research → designs
// → mockups → QA self-review → Etsy draft queue. Admin-triggered here; the
// Watchtower can also trigger her headless with the design-agent token.
export const mrsImagine = {
  request: async (path: string, init?: RequestInit) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const response = await fetch(`${API_BASE}/api/admin/mrs-imagine${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  },
  run: async (counts?: { garments?: number; metal?: number }) =>
    mrsImagine.request('/run', { method: 'POST', body: JSON.stringify(counts ?? {}) }),
  runs: async () => mrsImagine.request('/runs'),
  research: async () => mrsImagine.request('/research'),
}

// Image Flow API — generic gen/edit/bg-remove via gpt-image-2 etc.
export const imageFlow = {
  edit: async (params: {
    parentAssetId: string
    prompt: string
    refImageUrls?: string[]
    forceModel?: string
    enhance?: boolean
    confirmedCost?: boolean
    /** Strict design-fidelity mode — apply only the requested change. */
    preserveDesign?: boolean
  }): Promise<{
    status: 'ok'
    assetId: string | null
    url: string
    path: string
    costUsd: number
    modelId: string
    provider: 'replicate' | 'fal'
    parentAssetId: string | null
    enhancedPrompt?: string
  }> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const response = await fetch(`${API_BASE}/api/image-flow/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  },

  generate: async (params: {
    purpose: string
    prompt: string
    productId?: string
    assetRole?: string
    forceModel?: string
    enhance?: boolean
  }) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const response = await fetch(`${API_BASE}/api/image-flow/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  },

  upscale: async (params: { parentAssetId: string; forceModel?: string }): Promise<{
    status: 'ok'
    assetId: string | null
    url: string
    path: string
    costUsd: number
    modelId: string
    parentAssetId: string | null
  }> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const response = await fetch(`${API_BASE}/api/image-flow/upscale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  },

  bgRemove: async (params: { parentAssetId: string; forceModel?: string }): Promise<{
    status: 'ok'
    assetId: string | null
    url: string
    path: string
    costUsd: number
    modelId: string
    parentAssetId: string | null
  }> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const response = await fetch(`${API_BASE}/api/image-flow/bg-remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  },

  halftone: async (params: {
    parentAssetId: string
    method?: 'halftone' | 'diffusion'
    frequency?: number
    angle?: number
    shape?: 'round' | 'line'
    invertDark?: boolean
    cropBg?: boolean
  }): Promise<{
    status: 'ok'
    assetId: string | null
    url: string
    path: string
    width: number
    height: number
    costUsd: number
    modelId: string
    parentAssetId: string | null
  }> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const response = await fetch(`${API_BASE}/api/image-flow/halftone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }
    return response.json()
  },
}

// Imagination Station API
export const imaginationApi = {
  // Presets & Pricing (pricing endpoint returns both pricing and freeTrials)
  getPresets: () => api.get('/api/imagination-station/presets'),
  getPricing: () => api.get('/api/imagination-station/pricing'),

  // Sheet CRUD
  createSheet: (data: { name?: string; print_type: string; sheet_height: number }) =>
    api.post('/api/imagination-station/sheets', data),

  getSheets: (status?: string) =>
    api.get('/api/imagination-station/sheets', { params: { status } }),

  getSheet: (id: string) =>
    api.get(`/api/imagination-station/sheets/${id}`),

  updateSheet: (id: string, data: { name?: string; canvas_state?: any; thumbnail_url?: string }) =>
    api.put(`/api/imagination-station/sheets/${id}`, data),

  deleteSheet: (id: string) =>
    api.delete(`/api/imagination-station/sheets/${id}`),

  // Layer operations. layerInit lets the caller supply the REAL position/size
  // (inches) + metadata computed from the image's natural dimensions, so the
  // very first DB row is correct instead of a hardcoded 0,0 / 100x100in
  // placeholder (see backend/routes/imagination-station.ts POST /upload).
  uploadImage: (
    sheetId: string,
    file: File,
    layerInit?: {
      position_x?: number;
      position_y?: number;
      width?: number;
      height?: number;
      metadata?: Record<string, any>;
    }
  ) => {
    const formData = new FormData();
    formData.append('image', file);
    if (layerInit) {
      if (layerInit.position_x !== undefined) formData.append('position_x', String(layerInit.position_x));
      if (layerInit.position_y !== undefined) formData.append('position_y', String(layerInit.position_y));
      if (layerInit.width !== undefined) formData.append('width', String(layerInit.width));
      if (layerInit.height !== undefined) formData.append('height', String(layerInit.height));
      if (layerInit.metadata) formData.append('metadata', JSON.stringify(layerInit.metadata));
    }
    return api.post(`/api/imagination-station/sheets/${sheetId}/upload`, formData, {
      headers: {}
    });
  },

  // Server-side 300 DPI print-ready render — composites raster layers at
  // print resolution and returns the GCS URL. See
  // backend/routes/imagination-station.ts POST /sheets/:id/render.
  renderPrintFile: (
    sheetId: string,
    params: {
      layers: Array<{ url: string; x: number; y: number; width: number; height: number; rotation?: number }>;
      mirror?: boolean;
    }
  ) => api.post(`/api/imagination-station/sheets/${sheetId}/render`, params),

  // AI operations - Component-friendly signatures
  generateImage: (params: { prompt: string; style: string; useTrial?: boolean; count?: number; background?: 'black' | 'white' | 'grey' | 'gray' | 'color' | 'transparent'; tier?: 'standard' | 'premium' }) =>
    api.post('/api/imagination-station/ai/generate', params),

  removeBackground: (params: { imageUrl: string; useTrial?: boolean }) =>
    api.post('/api/imagination-station/ai/remove-bg', params),

  upscaleImage: (params: { imageUrl: string; factor: 2 | 4; useTrial?: boolean }) =>
    api.post('/api/imagination-station/ai/upscale', params),

  enhanceImage: (params: { imageUrl: string; useTrial?: boolean }) =>
    api.post('/api/imagination-station/ai/enhance', params),

  // DTF halftone — dot-screen effect (free, local transform)
  halftoneImage: (params: { imageUrl: string; frequency?: number; angle?: number; shape?: 'round' | 'line'; invertDark?: boolean }) =>
    api.post('/api/imagination-station/ai/halftone', params),

  // Reimagine It - add elements to existing images with AI
  reimagineImage: (params: { imageUrl: string; prompt: string; useTrial?: boolean; tier?: 'standard' | 'premium' }) =>
    api.post('/api/imagination-station/ai/reimagine', params),

  // Layout operations - Component-friendly signatures
  autoNest: (params: { sheetWidth: number; sheetHeight: number; layers: Array<{ id: string; width: number; height: number; rotation?: number }>; padding?: number }) =>
    api.post('/api/imagination-station/layout/auto-nest', params),

  // position_x/position_y/rotation are required for accurate collision
  // detection against real layer positions (see backend/services/imagination-layout.ts).
  // isTemplateCandidate marks which layers are eligible to be duplicated —
  // every layer on the sheet must still be sent so the ones NOT selected are
  // still avoided as collisions.
  smartFill: (params: { sheetWidth: number; sheetHeight: number; layers: Array<{ id: string; width: number; height: number; position_x?: number; position_y?: number; rotation?: number; isTemplateCandidate?: boolean }>; padding?: number }) =>
    api.post('/api/imagination-station/layout/smart-fill', params),

  autoLayout: (sheetId: string) =>
    api.post(`/api/imagination-station/sheets/${sheetId}/auto-layout`),

  // Export operations - Component-friendly signatures
  previewExport: (params: { sheet: any; layers: any[]; format: 'png' | 'pdf'; options?: { includeCutlines?: boolean; mirrorForSublimation?: boolean } }) =>
    api.post('/api/imagination-station/export/preview', params),

  exportDesign: (params: { sheet: any; layers: any[]; format: 'png' | 'pdf'; options?: { includeCutlines?: boolean; mirrorForSublimation?: boolean } }) =>
    api.post('/api/imagination-station/export/download', params),

  submitToProduction: (params: { sheet: any; layers: any[]; format: 'png' | 'pdf'; options?: { includeCutlines?: boolean; mirrorForSublimation?: boolean } }) =>
    api.post('/api/imagination-station/export/submit', params),

  // Legacy sheet-based operations (for backward compatibility)
  removeBackgroundSheet: (sheetId: string, layerId: string) =>
    api.post(`/api/imagination-station/sheets/${sheetId}/remove-bg`, { layer_id: layerId }),

  upscaleImageSheet: (sheetId: string, layerId: string, scaleFactor: number) =>
    api.post(`/api/imagination-station/sheets/${sheetId}/upscale`, { layer_id: layerId, scale_factor: scaleFactor }),

  enhanceImageSheet: (sheetId: string, layerId: string) =>
    api.post(`/api/imagination-station/sheets/${sheetId}/enhance`, { layer_id: layerId }),

  // Export & Submit (legacy)
  exportSheet: (sheetId: string, format: 'png' | 'pdf', options?: { include_cutlines?: boolean; mirror?: boolean }) =>
    api.post(`/api/imagination-station/sheets/${sheetId}/export`, { format, ...options }),

  submitSheet: (sheetId: string) =>
    api.post(`/api/imagination-station/sheets/${sheetId}/submit`),

  // Project Management - Save/Load functionality
  saveProject: (params: {
    sheetId: string;
    name?: string;
    canvasState: any;
    thumbnailBase64?: string;
    layers?: any[];
    metadata?: any;
  }) =>
    api.post('/api/imagination-station/projects/save', params),

  loadProject: (projectId: string) =>
    api.get(`/api/imagination-station/projects/${projectId}`),

  listProjects: (params?: { status?: string; limit?: number }) =>
    api.get('/api/imagination-station/projects', { params }),

  // Make a Product — realistic garment mockup of a finished design
  generateMockup: (params: {
    designImageUrl: string;
    productTemplate: 'shirts' | 'hoodies' | 'tumblers';
    modelDescription: Record<string, any>;
    designElements?: any[];
  }) => api.post('/api/realistic-mockups/generate', { designElements: [], ...params }),

  getMockupStatus: (generationId: string) =>
    api.get(`/api/realistic-mockups/${generationId}/status`),

  selectMockup: (generationId: string) =>
    api.post(`/api/realistic-mockups/${generationId}/select`),

  discardMockup: (generationId: string) =>
    api.post(`/api/realistic-mockups/${generationId}/discard`),

  // Submit a finished design for admin approval -> shows in My Designs (pending)
  // -> approved -> sellable. Same pipeline as CreateDesignModal.
  submitDesign: (params: {
    preview_url: string;
    name?: string;
    design_concept?: string;
    style?: string;
    category?: string;
    mockup_url?: string;
    product_template?: string;
    model_description?: Record<string, any>;
    source?: string;
  }) => api.post('/api/imagination-station/designs/submit', params),

  // Mr. Imagine studio brain — conversational brainstorm + fresh idea generator.
  // mode 'wall-art' tunes it for gallery metal-art (full-bleed), 'dtf' for apparel.
  brainstorm: (messages: Array<{ role: 'user' | 'assistant'; content: string }>, mode: 'dtf' | 'wall-art' = 'dtf') =>
    api.post('/api/imagination-station/ai/brainstorm', { messages, mode }),

  getRandomIdea: (seed?: string) =>
    api.get('/api/imagination-station/ai/random-idea', { params: seed ? { seed } : {} }),

  // "See it in your space" — gpt-image-2 places the metal art in a real room
  // at true-to-life size (4x6 / 8x11).
  roomMockup: (params: { imageUrl: string; location?: string; size?: string }) =>
    api.post('/api/imagination-station/ai/room-mockup', params),

  // Voice: speech-to-text (mic) and text-to-speech (Mr. Imagine's cloned voice)
  transcribeAudio: (audio: Blob) => {
    const formData = new FormData();
    formData.append('audio', audio, 'recording.webm');
    return api.post('/api/ai/transcribe', formData, { headers: {} });
  },

  synthesizeVoice: (text: string) =>
    api.post('/api/ai/voice/synthesize', { text }),

  admin: {
    getProducts: () => api.get('/api/admin/imagination-products'),
    updateProduct: (id: string, data: any) => api.put(`/api/admin/imagination-products/${id}`, data),
    upsertSize: (data: any) => api.post('/api/admin/imagination-products/size', data),
    deleteSize: (productId: string, height: number) => api.delete('/api/admin/imagination-products/size', { body: { productId, height } })
  }
};

// Admin API methods
export const adminApi = {
  // Imagination Station Pricing
  getImaginationPricing: () =>
    api.get('/api/admin/imagination-pricing'),

  updateImaginationPricing: (featureKey: string, updates: {
    current_cost?: number;
    is_free_trial?: boolean;
    free_trial_uses?: number;
  }) =>
    api.put(`/api/admin/imagination-pricing/${featureKey}`, updates),

  setImaginationPromo: (durationHours: number) =>
    api.post('/api/admin/imagination-pricing/promo', { durationHours }),

  resetImaginationPricing: () =>
    api.post('/api/admin/imagination-pricing/reset'),
};



// ---------------------------------------------------------------------------
// Buyer-side virtual try-on (Watchtower task 3b362203).
//
// `generate` posts multipart/form-data, so it can't ride apiFetch — that helper
// forces `Content-Type: application/json`, which strips the multipart boundary
// and the server then sees an empty body.
// ---------------------------------------------------------------------------
export interface TryOnConfig {
  enabled: boolean
  reason?: string
  dailyFreeCap: number
  freeUsedToday?: boolean
  freeRemainingToday?: number
  usageDate?: string
  timezone?: string
  /** Days a shopper's uploaded photo survives before the retention sweep deletes it. */
  photoRetentionDays?: number
  itcBalance?: number
  tiers?: {
    standard: { label: string; itcCost: number; poses: number }
    premium: { label: string; itcCost: number; poses: number }
  }
}

export interface TryOnResult {
  tryonId: string | null
  images: string[]
  imageUrl: string
  usedFree: boolean
  itcCharged: number
  itcBalance: number
  tier: string
  latencyMs: number
}

export const tryonApi = {
  /** Public — safe to call signed out, so the card knows whether to render. */
  isEnabled: (): Promise<{ enabled: boolean; dailyFreeCap: number; photoRetentionDays?: number }> =>
    apiFetch('/api/tryon/enabled'),

  getConfig: (): Promise<TryOnConfig> => apiFetch('/api/tryon/config'),

  async generate(opts: {
    photo: File
    productId: string
    tier: 'standard' | 'premium'
    garmentImageIndex: number
  }): Promise<TryOnResult> {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token

    const form = new FormData()
    form.append('photo', opts.photo)
    form.append('productId', opts.productId)
    form.append('tier', opts.tier)
    form.append('garmentImageIndex', String(opts.garmentImageIndex))

    const res = await fetch(`${API_BASE}/api/tryon/generate`, {
      method: 'POST',
      // No Content-Type header on purpose — the browser sets the multipart
      // boundary itself.
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
    return json as TryOnResult
  },

  /** Instrumentation. Never allowed to break the page, so failures are swallowed. */
  track: (payload: {
    eventType: 'tryon_card_viewed' | 'add_to_cart'
    productId?: string
    tryonId?: string | null
    secondsSinceTryon?: number
  }): Promise<unknown> =>
    apiFetch('/api/tryon/events', { method: 'POST', body: JSON.stringify(payload) }).catch(() => null),

  remove: (id: string) => apiFetch(`/api/tryon/${id}`, { method: 'DELETE' }),

  getAnalytics: (days = 30) => apiFetch(`/api/tryon/analytics?days=${days}`)
}
