/**
 * Tripo3D v2.5 Image-to-3D client (direct Tripo platform API).
 *
 * Uses TRIPO_API_KEY → https://api.tripo3d.ai/v2/openapi/task
 * Falls back to fal.ai if TRIPO_API_KEY is not set (FAL_API_KEY required).
 *
 * Tripo3D outputs GLB by default. We convert to STL downstream with three.js.
 */

const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi'
const FAL_QUEUE_BASE = 'https://queue.fal.run'
const FAL_MODEL_ID = 'tripo3d/tripo/v2.5/image-to-3d'

function tripoToken(): string | null {
  return process.env.TRIPO_API_KEY ?? null
}

function falAuth(): string {
  const t = process.env.FAL_API_KEY
  if (!t) throw new Error('FAL_API_KEY missing')
  return `Key ${t}`
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
    provider: 'tripo' | 'fal'
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
    throw new Error(`tripo submit ${submit.status}: ${text.slice(0, 400)}`)
  }
  const submitJson = (await submit.json()) as TripoTaskResponse
  const taskId = submitJson?.data?.task_id
  if (!taskId) {
    throw new Error(`tripo submit returned no task_id: ${JSON.stringify(submitJson).slice(0, 300)}`)
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
        throw new Error('Tripo3D returned no GLB URL on success')
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
      throw new Error(`tripo task ${s}: ${status.data?.error_msg ?? 'unknown error'}`)
    }
  }
  throw new Error('tripo task: poll timeout (>6 min)')
}

/**
 * Fallback path via fal.ai. Used only if TRIPO_API_KEY isn't set.
 */
async function generateViaFal(input: Tripo3DInput, cfg: SizeTierConfig, start: number): Promise<Tripo3DOutput> {
  console.log('[tripo3d] 🎲 Using fal.ai fallback (TRIPO_API_KEY not set)')

  const submitUrl = `${FAL_QUEUE_BASE}/${FAL_MODEL_ID}`
  const submit = await fetch(submitUrl, {
    method: 'POST',
    headers: { Authorization: falAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: input.imageUrl,
      face_limit: cfg.faceLimit,
      texture: cfg.texture,
      pbr: true,
      quad: cfg.quad,
      auto_size: true,
      orientation: input.orientation ?? 'align_image',
      texture_alignment: 'original_image',
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!submit.ok) {
    const text = await submit.text().catch(() => '')
    throw new Error(`fal/tripo submit ${submit.status}: ${text.slice(0, 400)}`)
  }
  const queued = (await submit.json()) as {
    request_id: string
    status_url?: string
    response_url?: string
  }
  const statusUrl = queued.status_url ?? `${submitUrl}/requests/${queued.request_id}/status`
  const responseUrl = queued.response_url ?? `${submitUrl}/requests/${queued.request_id}`

  // Generous 15-minute deadline (fal.ai's Tripo3D queue can be slow).
  const deadline = Date.now() + 900_000
  let completed = false
  let pollCount = 0
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000))
    pollCount++
    const sr = await fetch(statusUrl, { headers: { Authorization: falAuth() } })
    if (!sr.ok) continue
    const status = (await sr.json()) as { status?: string }
    if (pollCount % 5 === 0) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(0)
      console.log(`[tripo3d] still ${status.status ?? 'polling'} after ${elapsed}s (poll #${pollCount})`)
    }
    if (status.status === 'COMPLETED') { completed = true; break }
    if (status.status === 'FAILED' || status.status === 'CANCELED') {
      throw new Error(`fal/tripo ${status.status}`)
    }
  }
  if (!completed) {
    throw new Error('fal/tripo poll timeout (>15 min)')
  }

  // Result endpoint can lag the status endpoint by a few seconds — retry up to 5x with backoff.
  let output: any = null
  let lastErr = ''
  for (let attempt = 0; attempt < 5; attempt++) {
    const finalRes = await fetch(responseUrl, { headers: { Authorization: falAuth() } })
    if (finalRes.ok) {
      output = await finalRes.json()
      break
    }
    const text = await finalRes.text().catch(() => '')
    lastErr = `${finalRes.status}: ${text.slice(0, 200)}`
    if (finalRes.status === 400 && /still in progress/i.test(text)) {
      console.log('[tripo3d] result not ready yet, retrying in 4s...')
      await new Promise((r) => setTimeout(r, 4000))
      continue
    }
    throw new Error(`fal/tripo fetch result ${lastErr}`)
  }
  if (!output) {
    throw new Error(`fal/tripo result never ready: ${lastErr}`)
  }
  const glbUrl: string | undefined = output?.model_mesh?.url
  if (!glbUrl) throw new Error('fal/tripo returned no GLB URL')

  const processingTimeSec = (Date.now() - start) / 1000
  return {
    glbUrl,
    pbrUrl: output?.pbr_model?.url,
    rendererPreviewUrl: output?.rendered_image?.url,
    modelMetadata: {
      tier: cfg.tier,
      faceLimit: cfg.faceLimit,
      texture: cfg.texture,
      quad: cfg.quad,
      autoSized: true,
      provider: 'fal',
    },
    processingTimeSec,
    raw: output,
  }
}

/**
 * Generate a 3D model from a single image using Tripo3D v2.5.
 * Tries direct Tripo platform first if TRIPO_API_KEY is set, else falls back to fal.ai.
 * If Tripo auth fails at runtime, also falls back to fal automatically.
 */
export async function generateTripo3D(input: Tripo3DInput): Promise<Tripo3DOutput> {
  const cfg = SIZE_TIERS[input.tier]
  if (!cfg) throw new Error(`Unknown size tier: ${input.tier}`)
  const start = Date.now()
  console.log('[tripo3d] 🎲 Generating', cfg.label, 'tier — face_limit:', cfg.faceLimit, 'texture:', cfg.texture, 'quad:', cfg.quad)
  if (tripoToken()) {
    try {
      return await generateViaTripo(input, cfg, start)
    } catch (err: any) {
      // Auth or other Tripo platform error — fall back to fal so we don't fail the whole job
      const isAuth = /Authentication failed|401|1002/.test(err?.message ?? '')
      console.warn('[tripo3d] direct path failed' + (isAuth ? ' (auth)' : '') + ' — falling back to fal:', err?.message)
      return generateViaFal(input, cfg, start)
    }
  }
  return generateViaFal(input, cfg, start)
}
