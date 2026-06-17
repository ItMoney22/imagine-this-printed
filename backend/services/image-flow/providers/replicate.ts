// Replicate provider — uniform wrapper that returns { imageUrls, raw }.
// Ported from david-trinidad-com (Watchtower) at src/modules/image-flow/lib/providers/replicate.ts.

export interface ReplicateInput {
  modelId: string
  input: Record<string, unknown>
  timeoutMs?: number
}

export interface ReplicateResult {
  imageUrls: string[]
  raw: unknown
}

const API_BASE = 'https://api.replicate.com/v1'

function token(): string {
  const t = process.env.REPLICATE_API_TOKEN
  if (!t) throw new Error('REPLICATE_API_TOKEN missing')
  return t
}

function toImageUrls(output: unknown): string[] {
  if (!output) return []
  if (typeof output === 'string') return [output]
  if (Array.isArray(output)) {
    return output
      .map((v) => (typeof v === 'string' ? v : null))
      .filter((v): v is string => !!v)
  }
  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>
    if (typeof obj.url === 'string') return [obj.url as string]
    if (Array.isArray((obj as any).images)) return toImageUrls((obj as any).images)
    if (Array.isArray((obj as any).output)) return toImageUrls((obj as any).output)
  }
  return []
}

export async function runReplicate(opts: ReplicateInput): Promise<ReplicateResult> {
  const timeout = opts.timeoutMs ?? 180_000
  const signal = AbortSignal.timeout(timeout)

  // Retry on 429 (rate-limit). Replicate throttles hard to 6 req/min + burst 1
  // when the account has < $5 credit, so a parallel 4-image fan-out otherwise
  // loses ~3 slots to throttling. Respect the server's retry_after; bounded by
  // the overall timeout signal.
  let submit: Response
  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    submit = await fetch(`${API_BASE}/models/${opts.modelId}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({ input: opts.input }),
      signal,
    })
    if (submit.status !== 429 || attempt >= 5) break
    let waitMs = 0
    const ra = submit.headers.get('retry-after')
    if (ra) waitMs = Number(ra) * 1000
    if (!waitMs) {
      try {
        const j = (await submit.clone().json()) as { retry_after?: number }
        if (j.retry_after) waitMs = Number(j.retry_after) * 1000
      } catch { /* no body */ }
    }
    waitMs = Math.min(Math.max(waitMs || 1500 * (attempt + 1), 1000), 12_000)
    await new Promise((r) => setTimeout(r, waitMs))
    attempt++
  }

  if (!submit.ok) {
    const text = await submit.text().catch(() => '')
    throw new Error(`replicate ${opts.modelId} ${submit.status}: ${text.slice(0, 400)}`)
  }

  let prediction = (await submit.json()) as {
    id: string
    status: string
    output?: unknown
    error?: string | null
    urls?: { get?: string }
  }

  // Prefer: wait usually returns terminal state. Poll fallback.
  const deadline = Date.now() + timeout
  while (
    prediction.status !== 'succeeded' &&
    prediction.status !== 'failed' &&
    prediction.status !== 'canceled'
  ) {
    if (Date.now() > deadline) throw new Error(`replicate ${opts.modelId}: poll timeout`)
    if (!prediction.urls?.get) break
    await new Promise((r) => setTimeout(r, 1500))
    const pollRes = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${token()}` },
    })
    if (!pollRes.ok) continue
    prediction = (await pollRes.json()) as typeof prediction
  }

  if (prediction.status !== 'succeeded') {
    throw new Error(
      `replicate ${opts.modelId} ${prediction.status}: ${prediction.error ?? 'no error msg'}`
    )
  }

  const imageUrls = toImageUrls(prediction.output)
  if (imageUrls.length === 0) {
    throw new Error(`replicate ${opts.modelId}: no image URLs in output`)
  }

  return { imageUrls, raw: prediction }
}
