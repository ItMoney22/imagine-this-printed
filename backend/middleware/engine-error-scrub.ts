// Keeps engine names out of the error text a customer reads (task 7d5d7d86).
//
// The image routes answer a failed call with the provider's own message, and the
// pages print that straight into a toast. router.use(scrubEngineErrors), first
// thing on a router, covers every res.json in it, so no route has to remember.
//
// Only text that names an engine changes. "Insufficient ITC" and friends pass
// through word for word and keep their status, because some of these routes answer
// them at 500. That is why this matches names and never status codes or
// "insufficient": "Replicate: insufficient credit" must not get through.
//
// Admins keep the raw text. The role comes from role-cache, never from the token or
// req.user.role: imagination-station's own requireAuth puts a Supabase user on
// req.user, whose role is always "authenticated". Both auth paths set req.user.id,
// only one sets .sub. No user or a failed lookup reads as a customer.
import type { NextFunction, Request, Response } from 'express'
import { getCachedRole } from '../lib/role-cache.js'

export const ENGINE_FAILED_LINE = 'That could not be finished. Please try again.'
export const ENGINE_DECLINED_LINE = 'This was declined. Try rewording it.'

// A new engine in services/image-flow/models.ts fails the test until it is listed here.
const ENGINE_WORDS = new RegExp(
  [
    // OpenAI
    'openai', String.raw`\bopen[\s-]ai\b`, 'gpt', String.raw`\bdall[\s-]?e\b`,
    // Replicate, and what it hosts. Tripo is bounded so "tripod" is left alone.
    String.raw`\breplicate(error)?\b`, String.raw`\bflux`, String.raw`black[\s-]forest[\s-]labs`,
    String.raw`\bflare(_\w+|lab|studio)?\b`, String.raw`nano[\s_-]?banana`, String.raw`\bimagen\b`,
    'recraft', 'ideogram', 'seedream', 'bytedance', 'prunaai', String.raw`\bz-image\b`,
    String.raw`leonardo[\s-]?ai`, String.raw`lucid[\s-]origin`, String.raw`\bwan[\s-]?(video|\d)`,
    String.raw`\bgrok\b`, String.raw`\bxai\b`, String.raw`stable[\s-]?diffusion`, String.raw`\bsdxl\b`,
    String.raw`stability[\s-]ai`, 'midjourney',
    // Background, upscale, try-on and 3D
    '851-labs', String.raw`\brembg\b`, String.raw`remove\.bg`, 'removebg', 'esrgan', 'nightmareai',
    'fashn', String.raw`\btripo(3d|error)?\b`, String.raw`\btrellis\b`, 'hunyuan',
    String.raw`\bfal[._-](ai|run|key)\b`,
    // The brains behind Mr. Imagine on these same routers
    String.raw`\bgemini`, 'openrouter', 'claude', 'anthropic', String.raw`\bjev\b`,
  ].join('|'),
  'i',
)

// Same test as the Flare route: a refusal gets "reword it", not "try again", or the
// customer pays to be refused twice.
const DECLINED = /safety|moderation|content_policy/i

export function namesEngine(text: string): boolean {
  return ENGINE_WORDS.test(text)
}

function isErrorBody(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
}

function bodyNamesEngine(body: unknown): boolean {
  return isErrorBody(body) && Object.values(body).some((v) => typeof v === 'string' && namesEngine(v))
}

function scrubbed(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => {
      if (typeof value !== 'string' || !namesEngine(value)) return [key, value]
      return [key, DECLINED.test(value) ? ENGINE_DECLINED_LINE : ENGINE_FAILED_LINE]
    }),
  )
}

async function isAdmin(req: Request): Promise<boolean> {
  const userId = req.user?.id
  if (!userId) return false
  return (await getCachedRole(userId).catch(() => null)) === 'admin'
}

export function scrubEngineErrors(req: Request, res: Response, next: NextFunction): void {
  const send = res.json.bind(res)
  res.json = (body: unknown) => {
    if (res.statusCode < 400 || !bodyNamesEngine(body)) return send(body)
    // Only a failure that names an engine pays for the role lookup, so the send
    // waits on it here. Every route on these routers returns straight after res.json.
    isAdmin(req)
      .then((admin) => {
        if (admin) return send(body)
        // Most of these catch blocks never log, so this is the only copy of the
        // raw text once the customer stops receiving it.
        req.log?.warn?.({ path: req.originalUrl, status: res.statusCode, raw: body }, 'engine error scrubbed')
        return send(scrubbed(body as Record<string, unknown>))
      })
      .catch((err) => req.log?.error?.({ err }, 'engine error scrub could not send'))
    return res
  }
  next()
}
