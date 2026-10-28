// A seller asks her assistant for a feature or a change to her store (David 2026-10-26: "if she requests a feature for her
// page, she can ask Rico, and then he puts it right to the board, and it just goes right in, just like Christina's app").
// Rico decides it is a request (backend/services/store-assistant.ts, `requestFeature`) and this posts it to the Watchtower
// board, project imagine-this-printed, unassigned so the board's triage routes it. Same internal-secret endpoint the admin
// Watchtower button uses (routes/watchtower.ts); the secret never reaches the browser.

const BOARD_URL = (process.env.WATCHTOWER_BOARD_URL || 'https://davidtrinidad.com').replace(/\/$/, '')
const BOARD_PROJECT = process.env.WATCHTOWER_PROJECT_SLUG || 'imagine-this-printed'

export type StoreRequest = { title: string; details: string }
export type StoreRequestContext = { slug: string; storeName: string; ownerFirst: string; ownerEmail: string | null }

// A stuck retry loop must not flood David's live board: a few requests an hour per store is plenty for a shop owner.
const filed = new Map<string, number[]>()
export const REQUESTS_PER_HOUR = 6

export function requestAllowed(slug: string, now = Date.now()): boolean {
  const recent = (filed.get(slug) || []).filter(t => now - t < 3_600_000)
  if (recent.length >= REQUESTS_PER_HOUR) { filed.set(slug, recent); return false }
  filed.set(slug, [...recent, now])
  return true
}

export function requestBody(ctx: StoreRequestContext, req: StoreRequest) {
  return {
    title: `${ctx.storeName}: ${req.title}`.slice(0, 300),
    description: [
      req.details,
      '',
      `Requested by ${ctx.ownerFirst}, owner of ${ctx.storeName} (${ctx.slug}.imaginethisprinted.com), through her store assistant Rico.`,
      ctx.ownerEmail ? `Her email: ${ctx.ownerEmail}` : '',
      'Her store is part of the imagine-this-printed repo (src/pages/store, backend/routes/vendor-store.ts). Tell her when it ships.',
    ].filter(Boolean).join('\n').slice(0, 8000),
    priority: 'medium',
    project: BOARD_PROJECT,
    source: 'internal',
    created_by: 'agent',
  }
}

/** Posts the request to the board. Never throws: the caller tells her either way. */
export async function fileStoreRequest(ctx: StoreRequestContext, req: StoreRequest): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const secret = process.env.WATCHTOWER_INTERNAL_SECRET || ''
  if (!secret) return { ok: false, error: 'board secret is not configured' }
  if (!requestAllowed(ctx.slug)) return { ok: false, error: 'too many requests this hour' }
  try {
    const res = await fetch(`${BOARD_URL}/api/tasks/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify(requestBody(ctx, req)),
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json().catch(() => ({}))) as { id?: string; task?: { id?: string }; error?: string }
    if (!res.ok) return { ok: false, error: data.error || `board answered ${res.status}` }
    return { ok: true, id: data.id || data.task?.id || null }
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) }
  }
}
