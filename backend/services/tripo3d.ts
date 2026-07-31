/**
 * Tripo3D v2.5 Image-to-3D client (direct Tripo platform API).
 *
 * Uses TRIPO_API_KEY → https://api.tripo3d.ai/v2/openapi/task
 *
 * The fal.ai fallback was removed 2026-07-28 (Watchtower 5aeeab4f). It was
 * dead code: FAL_API_KEY is missing/revoked since the 2026-07 fal.ai purge,
 * so every fallback attempt threw "FAL_API_KEY missing" — which then became
 * the error the user saw, masking the real Tripo failure underneath.
 *
 * Tripo3D outputs GLB by default. We convert to STL downstream with three.js.
 */

const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi'

function tripoToken(): string | null {
  return process.env.TRIPO_API_KEY ?? null
}

/**
 * Tripo failure. `submitted` records whether Tripo had already accepted a
 * task when this threw — the retry in generateTripo3D must never re-submit
 * after that point, because Tripo has already started billable work.
 */
class TripoError extends Error {
  readonly submitted: boolean
  constructor(message: string, submitted: boolean) {
    super(message)
    this.name = 'TripoError'
    this.submitted = submitted
  }
}

/**
 * Print-size tiers. Each tier maps to:
 * - Tripo3D parameters (face_limit, texture quality, quad mesh)
 * - Recommended physical print size (mm) — used for slicer scaling guidance
 * - ITC cost (model gen) + USD print cost (physical print)
 */
export type PrintSizeTier = 'mini' | 'small' | 'medium' | 'large'

export interface SizeTierConfig {
  tier: PrintSizeTier
  label: string
  description: string
  printHeightMm: number       // recommended height in mm for the physical print
  faceLimit: number            // Tripo3D face_limit
  texture: 'standard' | 'HD'   // Tripo3D texture quality
  quad: boolean                // Tripo3D quad mesh
  itcCost: number              // ITC cost for the 3D conversion step
  printPriceUsd: number        // physical print price (PLA grey)
  approxSeconds: number        // expected wall-clock time
}

export const SIZE_TIERS: Record<PrintSizeTier, SizeTierConfig> = {
  mini: {
    tier: 'mini',
    label: 'Mini',
    description: '50mm tall — quick preview / keychain size. Standard quality, fast.',
    printHeightMm: 50,
    faceLimit: 10_000,
    texture: 'standard',
    quad: false,
    itcCost: 50,
    // Pricing dropped 2026-06-12 (David: "$20-something for user generated is
    // too much — go a little under, get people in"). Material cost grounding:
    // a PLA figurine runs ~$0.50–$4 in filament + pennies of electricity, so
    // these keep healthy margin while staying impulse-buy priced. Revisit when
    // the print-economics panel (live filament/kWh from Watchtower) lands.
    printPriceUsd: 5.99,
    approxSeconds: 60,
  },
  small: {
    tier: 'small',
    label: 'Small',
    description: '100mm tall — desktop figurine. Detailed geometry, standard texture.',
    printHeightMm: 100,
    faceLimit: 25_000,
    texture: 'standard',
    quad: false,
    itcCost: 80,
    printPriceUsd: 11.99,
    approxSeconds: 90,
  },
  medium: {
    tier: 'medium',
    label: 'Medium',
    description: '150mm tall — display piece. Detailed geometry + HD texture.',
    printHeightMm: 150,
    faceLimit: 40_000,
    texture: 'HD',
    quad: false,
    itcCost: 140,
    printPriceUsd: 18.99,
    approxSeconds: 120,
  },
  large: {
    tier: 'large',
    label: 'Large',
    description: '200mm tall — collector / centerpiece. Max detail, HD texture, quad mesh.',
    printHeightMm: 200,
    faceLimit: 50_000,
    texture: 'HD',
    quad: true,
    itcCost: 220,
    printPriceUsd: 29.99,
    approxSeconds: 180,
  },
}

export interface Tripo3DInput {
  imageUrl: string
  tier: PrintSizeTier
  seed?: number
  orientation?: 'default' | 'align_image'
}

export interface Tripo3DOutput {
  glbUrl: string
  pbrUrl?: string
  rendererPreviewUrl?: string
  modelMetadata: {
    tier: PrintSizeTier
    faceLimit: number
    texture: 'standard' | 'HD'
    quad: boolean
    autoSized: boolean
    provider: 'tripo'
  }
  processingTimeSec: number
  raw?: unknown
}

interface TripoTaskResponse {
  code: number
  data: {
    task_id?: string
    status?: 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'unknown'
    result?: {
      pbr_model?: { url?: string; type?: string }
      model?: { url?: string; type?: string }
      rendered_image?: { url?: string; type?: string }
    }
    output?: any
    progress?: number
    error_msg?: string
  }
}

/**
 * Direct Tripo platform call. Uses TRIPO_API_KEY.
 */
async function generateViaTripo(input: Tripo3DInput, cfg: SizeTierConfig, start: number): Promise<Tripo3DOutput> {
  const token = tripoToken()!
  console.log('[tripo3d] 🎲 Using direct Tripo platform API')

  // Submit task
  const submitBody: Record<string, any> = {
    type: 'image_to_model',
    file: { type: 'jpg', url: input.imageUrl }, // Tripo accepts URL
    model_version: 'v2.5-20250123',
    face_limit: cfg.faceLimit,
    texture: true,
    pbr: true,
    texture_quality: cfg.texture === 'HD' ? 'detailed' : 'standard',
    auto_size: true,
    orientation: input.orientation ?? 'align_image',
    quad: cfg.quad,
  }
  if (input.seed !== undefined) submitBody.seed = input.seed

  const submit = await fetch(`${TRIPO_BASE}/task`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(submitBody),
    signal: AbortSignal.timeout(60_000),
  })

  if (!submit.ok) {
    const text = await submit.text().catch(() => '')
    throw new TripoError(`tripo submit ${submit.status}: ${text.slice(0, 400)}`, false)
  }
  const submitJson = (await submit.json()) as TripoTaskResponse
  const taskId = submitJson?.data?.task_id
  if (!taskId) {
    throw new TripoError(`tripo submit returned no task_id: ${JSON.stringify(submitJson).slice(0, 300)}`, false)
  }
  console.log('[tripo3d] 📨 Task submitted:', taskId)

  // Poll
  const deadline = Date.now() + 360_000
  let lastStatus = ''
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    const sr = await fetch(`${TRIPO_BASE}/task/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!sr.ok) continue
    const status = (await sr.json()) as TripoTaskResponse
    const s = status?.data?.status ?? ''
    if (s !== lastStatus) {
      console.log('[tripo3d] status:', s, status?.data?.progress !== undefined ? `(${status.data.progress}%)` : '')
      lastStatus = s
    }
    if (s === 'success') {
      const result = status.data?.result ?? status.data?.output ?? {}
      const glbUrl = result.pbr_model?.url ?? result.model?.url
      if (!glbUrl) {
        console.error('[tripo3d] no model URL in success response:', JSON.stringify(status.data).slice(0, 500))
        throw new TripoError('Tripo3D returned no GLB URL on success', true)
      }
      const processingTimeSec = (Date.now() - start) / 1000
      console.log('[tripo3d] ✅', cfg.label, 'tier complete in', processingTimeSec.toFixed(1) + 's')
      return {
        glbUrl,
        pbrUrl: result.pbr_model?.url,
        rendererPreviewUrl: result.rendered_image?.url,
        modelMetadata: {
          tier: cfg.tier,
          faceLimit: cfg.faceLimit,
          texture: cfg.texture,
          quad: cfg.quad,
          autoSized: true,
          provider: 'tripo',
        },
        processingTimeSec,
        raw: status.data,
      }
    }
    if (s === 'failed' || s === 'cancelled') {
      throw new TripoError(`tripo task ${s}: ${status.data?.error_msg ?? 'unknown error'}`, true)
    }
  }
  throw new TripoError('tripo task: poll timeout (>6 min)', true)
}

/**
 * Generate a 3D model from a single image using Tripo3D v2.5.
 *
 * Requires TRIPO_API_KEY. On failure the real Tripo error is surfaced — there
 * is no provider fallback (see the fal.ai note at the top of this file).
 *
 * Retry policy: exactly one retry, and only when Tripo never accepted a task
 * (network error, or a non-2xx on submit). Once Tripo has issued a task_id it
 * has started billable work, so a poll timeout / failed task is surfaced
 * immediately rather than paying for a second generation.
 */
export async function generateTripo3D(input: Tripo3DInput): Promise<Tripo3DOutput> {
  const cfg = SIZE_TIERS[input.tier]
  if (!cfg) throw new Error(`Unknown size tier: ${input.tier}`)
  if (!tripoToken()) {
    throw new Error('TRIPO_API_KEY missing — 3D model generation is unavailable')
  }

  const start = Date.now()
  console.log('[tripo3d] 🎲 Generating', cfg.label, 'tier — face_limit:', cfg.faceLimit, 'texture:', cfg.texture, 'quad:', cfg.quad)

  try {
    return await generateViaTripo(input, cfg, start)
  } catch (err: any) {
    // Only a pre-submit failure is safe to retry; anything after Tripo issued
    // a task_id would double-charge.
    if (err instanceof TripoError && err.submitted) throw err

    console.warn('[tripo3d] submit failed, retrying once:', err?.message)
    return await generateViaTripo(input, cfg, start)
  }
}
