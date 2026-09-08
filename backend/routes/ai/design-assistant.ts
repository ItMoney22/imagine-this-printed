import { Router, Request, Response } from 'express'
import OpenAI from 'openai'
import { requireAuth } from '../../middleware/supabaseAuth.js'

const router = Router()

// Model + client (migrated 2026-07-26, Watchtower 562ead65).
//
// This router used to hardcode `gpt-4`, which OpenAI hard-shuts-down on
// 2026-10-23. It now runs through the same OpenRouter client the rest of the
// AI surface uses (routes/ai/chat.ts, services/imagine-brain.ts) and defaults
// to Gemini 2.5 Flash Lite — $0.10/$1M in, $0.40/$1M out, confirmed live in
// OpenRouter's catalog on 2026-07-26 with `response_format` support.
//
// Flash Lite over gpt-5.4-nano ($0.20/$1.25): output dominates the cost here
// (four of five routes emit JSON blobs, prompts are short), so 3x cheaper
// output wins, and the OpenRouter+Gemini path is already proven in prod.
//
// The direct-OpenAI fallback (no OPENROUTER_API_KEY) reads OPENAI_TEXT_MODEL,
// the shared env var introduced by the model-purge task (Watchtower e881523b),
// defaulting to its cheap tier `gpt-5.4-nano`. DESIGN_ASSISTANT_MODEL
// overrides either path wholesale.
const USE_OPENROUTER = !!process.env.OPENROUTER_API_KEY
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-nano'
const DESIGN_MODEL =
  process.env.DESIGN_ASSISTANT_MODEL ||
  (USE_OPENROUTER ? 'google/gemini-2.5-flash-lite' : OPENAI_TEXT_MODEL)

const openai = new OpenAI(
  USE_OPENROUTER
    ? {
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://imaginethisprinted.com',
          'X-Title': 'ImagineThisPrinted - Design Assistant',
        },
      }
    : { apiKey: process.env.OPENAI_API_KEY }
)

// Per-user rate limit for the AI-backed design assistant. All callers are
// authenticated (frontend reaches these via apiFetch which attaches the JWT;
// the design tool itself is behind ProtectedRoute) so we key by req.user.sub.
// Without this, a buggy retry loop or a logged-in attacker could rack up
// real inference bills.
const designAssistRateLimit = new Map<string, { count: number; resetAt: number }>()
const DESIGN_LIMIT = 30 // requests per minute per user
const DESIGN_WINDOW_MS = 60_000

function checkDesignAssistRateLimit(userId: string): boolean {
  const now = Date.now()
  const state = designAssistRateLimit.get(userId)
  if (!state || state.resetAt < now) {
    designAssistRateLimit.set(userId, { count: 1, resetAt: now + DESIGN_WINDOW_MS })
    return true
  }
  if (state.count >= DESIGN_LIMIT) return false
  state.count++
  return true
}

// Shared guard: requireAuth + rate-limit applied to every design-assistant
// route below. Mounting at the router level keeps the per-route handlers
// untouched and makes it impossible to forget on a new route.
router.use(requireAuth, (req: Request, res: Response, next) => {
  const userId = req.user?.sub
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })
  if (!checkDesignAssistRateLimit(userId)) {
    return res.status(429).json({ error: 'Too many design assistant requests — slow down' })
  }
  next()
})

const DESIGN_SYSTEM_PROMPT =
  'You are a professional graphic designer and marketing expert specializing in custom print designs for apparel and merchandise. Provide creative, practical, and market-relevant design advice.'

// Appended on JSON-mode calls. `response_format` already forces valid JSON on
// every provider we target, but the models still need telling not to wrap the
// object in commentary when they fall back to plain completion.
const JSON_SYSTEM_SUFFIX =
  ' Respond with a single raw JSON object matching the requested schema exactly. No prose, no explanation, no markdown code fences.'

// gpt-5.x / o-series reasoning models reject `max_tokens` (they want
// `max_completion_tokens`) and only accept the default temperature. OpenRouter
// normalizes both, so this only bites on the direct-OpenAI fallback path.
const IS_REASONING_MODEL = !USE_OPENROUTER && /^(gpt-5|o[1-9])/.test(DESIGN_MODEL)

interface CallOptions {
  /** Request `response_format: { type: 'json_object' }` from the model. */
  json?: boolean
  maxTokens?: number
}

async function callOpenAI(prompt: string, opts: CallOptions = {}): Promise<string> {
  const { json = false, maxTokens = 1600 } = opts

  const body: Record<string, any> = {
    model: DESIGN_MODEL,
    messages: [
      {
        role: 'system',
        content: json ? DESIGN_SYSTEM_PROMPT + JSON_SYSTEM_SUFFIX : DESIGN_SYSTEM_PROMPT,
      },
      { role: 'user', content: prompt },
    ],
  }

  if (json) body.response_format = { type: 'json_object' }

  if (IS_REASONING_MODEL) {
    // Hidden reasoning tokens come out of the same budget — give headroom so
    // the visible JSON never gets truncated mid-object.
    body.max_completion_tokens = maxTokens * 4
  } else {
    body.max_tokens = maxTokens
    body.temperature = 0.7
  }

  const completion = await openai.chat.completions.create(body as any)
  return completion.choices[0]?.message?.content ?? ''
}

/**
 * Parse a model JSON reply without ever 500-ing the route.
 *
 * JSON mode makes malformed output rare but not impossible: a reply can still
 * be truncated by the token budget, or arrive fenced/prefixed from a provider
 * that quietly ignores `response_format`. Every route parses through here and
 * degrades to `{}`, which each handler then reads with its own defaults
 * (empty arrays, neutral rating) — a thin result instead of a 500.
 */
function safeParseJSON(text: string, route: string): Record<string, any> {
  if (!text || !text.trim()) {
    console.warn(`[design-assistant] ${route}: empty model reply — returning empty result`)
    return {}
  }

  try {
    const parsed = JSON.parse(text)
    // `null`, a bare array, or a scalar would blow up property access downstream.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    console.warn(
      `[design-assistant] ${route}: model returned JSON that is not an object (${typeof parsed}) — returning empty result`
    )
    return {}
  } catch {
    // Second chance: strip any prose preamble / code fence and take the
    // outermost object literal.
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        const salvaged = JSON.parse(text.slice(start, end + 1))
        if (salvaged && typeof salvaged === 'object' && !Array.isArray(salvaged)) {
          console.warn(`[design-assistant] ${route}: salvaged JSON from a non-JSON reply`)
          return salvaged
        }
      } catch {
        // fall through to the empty result below
      }
    }
    console.error(
      `[design-assistant] ${route}: unparseable model reply (${text.length} chars) — returning empty result. First 200: ${text.slice(0, 200)}`
    )
    return {}
  }
}

const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : [])

/**
 * POST /api/ai/design-assistant/suggestions
 * Body: { productType, designContext, targetAudience? }
 */
router.post('/suggestions', async (req: Request, res: Response): Promise<any> => {
  try {
    const { productType, designContext, targetAudience = 'general' } = req.body
    if (!productType || !designContext) {
      return res.status(400).json({ error: 'productType and designContext are required' })
    }

    const prompt = `Please suggest designs for a ${productType} with the following context: "${designContext}".
    Target audience: ${targetAudience}.

    Provide 3 creative design suggestions in JSON format with the following structure:
    {
      "suggestions": [
        {
          "id": "unique_id",
          "title": "Design Name",
          "description": "Brief description",
          "reasoning": "Why this design works",
          "aiPrompt": "Text prompt for AI image generation",
          "colorPalette": ["#color1", "#color2", "#color3", "#color4"],
          "typography": {
            "fontFamily": "font name",
            "fontSize": 24,
            "fontWeight": "weight"
          },
          "layout": {
            "positioning": "description",
            "alignment": "description",
            "spacing": "description"
          },
          "tags": ["tag1", "tag2", "tag3"]
        }
      ]
    }`

    const text = await callOpenAI(prompt, { json: true, maxTokens: 2000 })
    const parsed = safeParseJSON(text, 'suggestions')
    return res.json({ suggestions: asArray(parsed.suggestions) })
  } catch (err: any) {
    console.error('[design-assistant] suggestions error:', err)
    return res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/ai/design-assistant/analyze
 * Body: { elements, productType }
 */
router.post('/analyze', async (req: Request, res: Response): Promise<any> => {
  try {
    const { elements, productType } = req.body
    if (!elements || !productType) {
      return res.status(400).json({ error: 'elements and productType are required' })
    }

    const elementsDescription = (elements as any[]).map((el: any) => {
      if (el.type === 'text') {
        return `Text: "${el.text}" (${el.fontFamily}, ${el.fontSize}px, ${el.fill})`
      } else if (el.type === 'image') {
        return `Image: positioned at (${el.x}, ${el.y}), size ${el.width}x${el.height}`
      }
      return `Element: ${el.type}`
    }).join('; ')

    const prompt = `Analyze this design for a ${productType}:
    Elements: ${elementsDescription}

    Provide analysis in JSON format:
    {
      "overallRating": 7,
      "strengths": ["strength1", "strength2"],
      "improvements": ["improvement1", "improvement2"],
      "suggestions": [
        {
          "id": "suggestion_id",
          "title": "Suggestion Title",
          "description": "What to do",
          "reasoning": "Why this helps"
        }
      ],
      "marketTrends": ["trend1", "trend2"]
    }`

    const text = await callOpenAI(prompt, { json: true })
    const parsed = safeParseJSON(text, 'analyze')
    return res.json({
      overallRating: typeof parsed.overallRating === 'number' ? parsed.overallRating : 7,
      strengths: asArray(parsed.strengths),
      improvements: asArray(parsed.improvements),
      suggestions: asArray(parsed.suggestions),
      marketTrends: asArray(parsed.marketTrends),
    })
  } catch (err: any) {
    console.error('[design-assistant] analyze error:', err)
    return res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/ai/design-assistant/color-palettes
 * Body: { mood, productType }
 */
router.post('/color-palettes', async (req: Request, res: Response): Promise<any> => {
  try {
    const { mood, productType } = req.body
    if (!mood || !productType) {
      return res.status(400).json({ error: 'mood and productType are required' })
    }

    const prompt = `Suggest color palettes for a ${productType} with ${mood} mood.

    Provide in JSON format:
    {
      "palettes": [
        {
          "name": "Palette Name",
          "colors": ["#color1", "#color2", "#color3", "#color4"],
          "mood": "description of mood/feeling"
        }
      ]
    }`

    const text = await callOpenAI(prompt, { json: true, maxTokens: 1200 })
    const parsed = safeParseJSON(text, 'color-palettes')
    return res.json({ palettes: asArray(parsed.palettes) })
  } catch (err: any) {
    console.error('[design-assistant] color-palettes error:', err)
    return res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/ai/design-assistant/typography
 * Body: { text, productType, mood }
 */
router.post('/typography', async (req: Request, res: Response): Promise<any> => {
  try {
    const { text: inputText, productType, mood } = req.body
    if (!inputText || !productType || !mood) {
      return res.status(400).json({ error: 'text, productType, and mood are required' })
    }

    const prompt = `Suggest typography for the text "${inputText}" on a ${productType} with ${mood} mood.

    Provide 3 typography suggestions in JSON format:
    {
      "suggestions": [
        {
          "fontFamily": "Font Name",
          "fontSize": 24,
          "fontWeight": "weight",
          "reasoning": "why this works",
          "mood": "feeling it conveys"
        }
      ]
    }`

    const text = await callOpenAI(prompt, { json: true, maxTokens: 1200 })
    const parsed = safeParseJSON(text, 'typography')
    return res.json({ suggestions: asArray(parsed.suggestions) })
  } catch (err: any) {
    console.error('[design-assistant] typography error:', err)
    return res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/ai/design-assistant/chat
 * Body: { message, context? }
 *
 * Prose out, not JSON — this is the one route that stays out of JSON mode.
 */
router.post('/chat', async (req: Request, res: Response): Promise<any> => {
  try {
    const { message, context = {} } = req.body
    if (!message) {
      return res.status(400).json({ error: 'message is required' })
    }

    const contextStr = Object.keys(context).length > 0
      ? `Context: ${JSON.stringify(context)}`
      : ''

    const prompt = `${contextStr}

    User message: "${message}"

    As a design assistant, provide helpful advice about design, typography, colors, layout, or market trends. Keep responses practical and actionable.`

    // 1200, not the old 1000: Flash Lite is chattier than gpt-4 was and a
    // smoke test at 800 truncated mid-answer. ~$0.0005 per reply.
    const text = await callOpenAI(prompt, { maxTokens: 1200 })
    return res.json({ response: text })
  } catch (err: any) {
    console.error('[design-assistant] chat error:', err)
    return res.status(500).json({ error: err.message })
  }
})

export default router
