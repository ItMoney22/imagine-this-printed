// fal.ai provider — uniform wrapper that returns { imageUrls, raw }.
// Uses fal queue API (POST -> poll status -> fetch result).

export interface FalInput {
  modelId: string
  input: Record<string, unknown>
  timeoutMs?: number
}

export interface FalResult {
  imageUrls: string[]
  raw: unknown
}

const QUEUE_BASE = 'https://queue.fal.run'

function authHeader(): string {
  const t = process.env.FAL_API_KEY
  if (!t) throw new Error('FAL_API_KEY missing')
  return `Key ${t}`
}

function toImageUrls(output: unknown): string[] {
  if (!output || typeof output !== 'object') return []
  const obj = output as Record<string, unknown>
  if (Array.isArray((obj as any).images)) {
    return ((obj as any).images as Array<{ url?: string }>)
      .map((i) => i?.url)
      .filter((v): v is string => typeof v === 'string')
  }
  if (Array.isArray((obj as any).image)) {
    return ((obj as any).image as Array<{ url?: string }>)
      .map((i) => i?.url)
      .filter((v): v is string => typeof v === 'string')
  }
  if (typeof (obj as any).image === 'object' && typeof (obj as any).image?.url === 'string') {
    return [(obj as any).image.url]
  }
  return []
}

export async function runFal(opts: FalInput): Promise<FalResult> {
  const timeout = opts.timeoutMs ?? 180_000
  const submitUrl = `${QUEUE_BASE}/${opts.modelId}`

  const submit = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(opts.input),
    signal: AbortSignal.timeout(timeout),
  })

  if (!submit.ok) {
    const text = await submit.text().catch(() => '')
    throw new Error(`fal ${opts.modelId} ${submit.status}: ${text.slice(0, 400)}`)
  }

  const queued = (await submit.json()) as {
    request_id: string
    status_url?: string
    response_url?: string
  }
  const statusUrl = queued.status_url ?? `${QUEUE_BASE}/${opts.modelId}/requests/${queued.request_id}/status`
  const responseUrl = queued.response_url ?? `${QUEUE_BASE}/${opts.modelId}/requests/${queued.request_id}`

  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500))
    const statusRes = await fetch(statusUrl, { headers: { Authorization: authHeader() } })
    if (!statusRes.ok) continue
    const status = (await statusRes.json()) as { status?: string }
    if (status.status === 'COMPLETED') break
    if (status.status === 'FAILED' || status.status === 'CANCELED') {
      throw new Error(`fal ${opts.modelId} ${status.status}`)
    }
  }

  const finalRes = await fetch(responseUrl, { headers: { Authorization: authHeader() } })
  if (!finalRes.ok) {
    const text = await finalRes.text().catch(() => '')
    throw new Error(`fal ${opts.modelId} fetch result ${finalRes.status}: ${text.slice(0, 400)}`)
  }
  const output = await finalRes.json()
  const imageUrls = toImageUrls(output)
  if (imageUrls.length === 0) {
    throw new Error(`fal ${opts.modelId}: no image URLs in output`)
  }
  return { imageUrls, raw: output }
}
