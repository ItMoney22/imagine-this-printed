import { Router, Request, Response } from 'express'
import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import { supabase } from '../../lib/supabase.js'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { OPENROUTER_TEXT_MODEL } from '../../lib/chat-model-routing.js'

/**
 * Mr Imagine's Trend Scout — the admin-facing half of the mascot.
 *
 * Mr Imagine reads the calendar/news and pitches landing pages he wants to
 * build (the July 4th and World Cup pages were hand-built; this replaces that
 * with an advise -> approve loop). Approving a pitch files a task on the
 * Watchtower board (davidtrinidad.com) with source `itp-mr-imagine`, so the
 * board can show his avatar on the card. Nothing ships to the storefront from
 * here — the approved task is picked up by the fleet like any other.
 *
 * Env: WATCHTOWER_INTERNAL_SECRET (or CRON_SECRET / JIMMY_DASHBOARD_INTERNAL_SECRET)
 *      WATCHTOWER_BASE_URL (default https://davidtrinidad.com)
 *      TREND_SCOUT_MODEL (default OpenRouter text model with the :online web
 *      plugin so pitches reflect what's actually happening this week)
 */

const router = Router()

router.use(requireAuth)
router.use(requireRole(['admin']))

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://imaginethisprinted.com',
    'X-Title': 'Mr. Imagine - Trend Scout',
  },
})

const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-nano'
const isReasoningModel = (m: string) => /^(o[1-9]|gpt-5)/.test(m)

const WATCHTOWER_BASE_URL = process.env.WATCHTOWER_BASE_URL || 'https://davidtrinidad.com'
const WATCHTOWER_SOURCE = 'itp-mr-imagine'

function watchtowerSecret(): string | null {
  return (
    process.env.WATCHTOWER_INTERNAL_SECRET ||
    process.env.JIMMY_DASHBOARD_INTERNAL_SECRET ||
    process.env.CRON_SECRET ||
    null
  )
}

interface SuggestionDraft {
  title: string
  slug: string
  concept: string
  trend_rationale: string
  product_ideas: string[]
  urgency: 'low' | 'medium' | 'high' | 'critical'
  launch_window: string | null
}

const TREND_SCOUT_SYSTEM_PROMPT = `You are Mr. Imagine, the creative AI mascot of ImagineThisPrinted.com, wearing your TREND SCOUT hat for the admin team. You advise the owners on which seasonal/trending landing pages the store should build next.

The store sells: custom DTF-printed t-shirts, AI-designed apparel, 3D-printed toys/figurines (with NFC + AR), metal wall art, stickers, and custom prints. It ships from Georgia, USA; the audience is mostly US consumers.

You pitch LANDING PAGES: a themed shop-the-moment page with a hero, a curated product collection, and shirt/toy/metal-art ideas — like the retired "July 4th - America 250" and "World Cup 2026" pages.

Ground every pitch in what the world is actually going through RIGHT NOW relative to the current date you are given: upcoming holidays and observances, sports moments, elections/civic moments, school calendar, pop-culture and viral waves, weather/seasons. Prefer moments 2-8 weeks out (time to design, print, and rank), plus at most one evergreen idea. Never pitch an event that has already passed, and never pitch ideas on the DO-NOT-PITCH list.

For each pitch be honest about WHY NOW — a real, checkable reason, not vibes. Avoid trademark landmines: reference moments generically (e.g. "big game day" not league trademarks) in the merch concepts.`

function trendScoutUserPrompt(avoid: string[]): string {
  const today = new Date().toISOString().slice(0, 10)
  return `Today's date: ${today}.

DO-NOT-PITCH (already built, pitched, or retired): ${avoid.length ? avoid.join('; ') : '(none)'}

Pitch 5 landing pages. Respond with ONLY a JSON array (no markdown fences, no commentary), each element:
{
  "title": "short page name as it would appear in the nav",
  "slug": "url-slug",
  "concept": "2-3 sentences: the page's story, hero idea, and the collection it sells",
  "trend_rationale": "1-2 sentences: what is happening in the world that makes this worth building NOW",
  "product_ideas": ["3-6 concrete product ideas (shirt lines, toys, metal art, stickers)"],
  "urgency": "low" | "medium" | "high" | "critical",
  "launch_window": "when it should be live, e.g. 'by Aug 15, runs through Labor Day'"
}`
}

/** Parse the model's reply into suggestion drafts, tolerating fences/prose. */
function parseSuggestions(raw: string): SuggestionDraft[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) throw new Error('no JSON array in model reply')
  const parsed = JSON.parse(raw.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('model reply is not an array')

  const urgencies = new Set(['low', 'medium', 'high', 'critical'])
  return parsed
    .filter((s: any) => s && typeof s.title === 'string' && typeof s.concept === 'string')
    .map((s: any): SuggestionDraft => ({
      title: String(s.title).slice(0, 200),
      slug: String(s.slug || s.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80),
      concept: String(s.concept).slice(0, 2000),
      trend_rationale: String(s.trend_rationale || '').slice(0, 1000),
      product_ideas: Array.isArray(s.product_ideas) ? s.product_ideas.slice(0, 8).map((p: any) => String(p).slice(0, 200)) : [],
      urgency: urgencies.has(s.urgency) ? s.urgency : 'medium',
      launch_window: s.launch_window ? String(s.launch_window).slice(0, 200) : null,
    }))
}

/**
 * GET /api/admin/trend-scout/suggestions?status=pending
 * Newest first; optionally filtered by status.
 */
router.get('/suggestions', async (req: Request, res: Response): Promise<any> => {
  try {
    const status = req.query.status as string | undefined
    let q = supabase
      .from('landing_page_suggestions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (status && status !== 'all') q = q.eq('status', status)

    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ suggestions: data || [] })
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'failed to load suggestions' })
  }
})

/**
 * POST /api/admin/trend-scout/generate
 * Ask Mr Imagine for a fresh batch of pitches. Existing non-dismissed titles
 * (and the two retired pages) are passed as a do-not-pitch list so batches
 * don't repeat themselves.
 */
router.post('/generate', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data: existing } = await supabase
      .from('landing_page_suggestions')
      .select('title, status')
      .order('created_at', { ascending: false })
      .limit(60)

    const avoid = [
      'July 4th / America 250 (retired page)',
      'World Cup 2026 (retired page)',
      ...(existing || []).map(s => s.title),
    ]

    // Web-grounded when OpenRouter is available: the :online suffix runs the
    // web plugin, so "what the world is going through" is this week's news,
    // not the model's training data. Plain OpenAI fallback still works but is
    // calendar-grounded only.
    const useOpenRouter = !!process.env.OPENROUTER_API_KEY
    const model = process.env.TREND_SCOUT_MODEL
      || (useOpenRouter ? `${OPENROUTER_TEXT_MODEL}:online` : OPENAI_TEXT_MODEL)
    const client = useOpenRouter ? openrouter : openai

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: TREND_SCOUT_SYSTEM_PROMPT },
        { role: 'user', content: trendScoutUserPrompt(avoid) },
      ],
      // Gemini spends part of the budget on hidden reasoning (see
      // mr-imagine-chat.ts); 5 structured pitches need real headroom.
      ...(!useOpenRouter && isReasoningModel(model)
        ? { max_completion_tokens: 3000 }
        : { temperature: 0.9, max_tokens: 3000 }),
    })

    const raw = completion.choices[0]?.message?.content || ''
    const drafts = parseSuggestions(raw)
    if (drafts.length === 0) return res.status(502).json({ error: 'Mr Imagine came back empty-handed — try again' })

    const batchId = randomUUID()
    const rows = drafts.map(d => ({
      ...d,
      product_ideas: d.product_ideas,
      status: 'pending',
      model,
      batch_id: batchId,
    }))

    const { data: inserted, error } = await supabase
      .from('landing_page_suggestions')
      .insert(rows)
      .select('*')
    if (error) return res.status(500).json({ error: error.message })

    console.log(`[trend-scout] 💡 ${inserted?.length} pitches from ${model} (batch ${batchId.slice(0, 8)})`)
    return res.json({ suggestions: inserted || [], model })
  } catch (error: any) {
    console.error('[trend-scout] ❌ generate failed:', error)
    return res.status(500).json({ error: error.message || 'generate failed' })
  }
})

/**
 * POST /api/admin/trend-scout/suggestions/:id/approve
 * David said yes -> file the build task on the Watchtower board, stamp the
 * task id on the row. Idempotent: re-approving an approved row returns the
 * existing task id instead of filing a duplicate.
 */
router.post('/suggestions/:id/approve', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data: sug, error } = await supabase
      .from('landing_page_suggestions')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (error || !sug) return res.status(404).json({ error: 'suggestion not found' })
    if (sug.status === 'approved' && sug.watchtower_task_id) {
      return res.json({ suggestion: sug, task_id: sug.watchtower_task_id, already: true })
    }

    const secret = watchtowerSecret()
    if (!secret) {
      return res.status(500).json({
        error: 'Watchtower secret not configured (set WATCHTOWER_INTERNAL_SECRET on the backend)',
      })
    }

    const urgencyToPriority: Record<string, string> = {
      low: 'low', medium: 'medium', high: 'high', critical: 'critical',
    }
    const ideas = Array.isArray(sug.product_ideas) ? sug.product_ideas : []
    const taskBody = {
      title: `Build landing page: ${sug.title}`,
      description:
        `Mr Imagine (ITP Trend Scout) pitched this and David approved it in the ITP admin.\n` +
        `Route: /${sug.slug} on imaginethisprinted.com (repo: imagine-this-printed).\n` +
        `Concept: ${sug.concept}\n` +
        `Why now: ${sug.trend_rationale}\n` +
        (ideas.length ? `Product ideas: ${ideas.join('; ')}\n` : '') +
        (sug.launch_window ? `Launch window: ${sug.launch_window}\n` : '') +
        `Pattern: follow the retired seasonal pages (hero + curated collection + product grid); suggestion id ${sug.id}.`,
      priority: urgencyToPriority[sug.urgency] || 'medium',
      project: 'imagine-this-printed',
      source: WATCHTOWER_SOURCE,
      created_by: 'agent',
    }

    // File on the board. If the deployed board doesn't know our source value
    // yet (tasks_source_check), retag as 'internal' so approval still lands —
    // the avatar upgrade is cosmetic, the task is not.
    let taskId: string | null = null
    let usedSource = WATCHTOWER_SOURCE
    for (const source of [WATCHTOWER_SOURCE, 'internal']) {
      // /api/tasks/internal is the x-internal-secret endpoint (plain /api/tasks
      // is session-cookie only). It returns the created task row directly.
      const resp = await fetch(`${WATCHTOWER_BASE_URL}/api/tasks/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ ...taskBody, source }),
      })
      if (resp.ok) {
        const data: any = await resp.json().catch(() => ({}))
        taskId = data?.id || data?.task?.id || null
        usedSource = source
        break
      }
      const text = await resp.text().catch(() => '')
      const sourceRejected = resp.status === 500 && text.includes('tasks_source_check')
      if (!sourceRejected) {
        console.error(`[trend-scout] ❌ Watchtower filing failed (${resp.status}):`, text.slice(0, 300))
        return res.status(502).json({ error: `Watchtower rejected the task (${resp.status})` })
      }
      console.warn(`[trend-scout] source '${source}' not in tasks_source_check yet, retrying as internal`)
    }
    if (usedSource !== WATCHTOWER_SOURCE) {
      console.warn('[trend-scout] filed with fallback source=internal — apply the Watchtower source migration for avatars')
    }

    const { data: updated, error: upErr } = await supabase
      .from('landing_page_suggestions')
      .update({
        status: 'approved',
        watchtower_task_id: taskId,
        approved_by: (req as any).user?.id || null,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sug.id)
      .select('*')
      .single()
    if (upErr) return res.status(500).json({ error: upErr.message })

    console.log(`[trend-scout] ✅ approved "${sug.title}" -> Watchtower task ${taskId ?? '(id not returned)'}`)
    return res.json({ suggestion: updated, task_id: taskId })
  } catch (error: any) {
    console.error('[trend-scout] ❌ approve failed:', error)
    return res.status(500).json({ error: error.message || 'approve failed' })
  }
})

/**
 * POST /api/admin/trend-scout/suggestions/:id/dismiss
 * Not this one. Kept (not deleted) so future batches don't re-pitch it.
 */
router.post('/suggestions/:id/dismiss', async (req: Request, res: Response): Promise<any> => {
  try {
    const { data, error } = await supabase
      .from('landing_page_suggestions')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('status', 'pending')
      .select('*')
      .single()
    if (error || !data) return res.status(404).json({ error: 'pending suggestion not found' })
    return res.json({ suggestion: data })
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'dismiss failed' })
  }
})

export default router
