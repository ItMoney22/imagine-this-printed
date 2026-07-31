// backend/routes/ai/realtime.ts
//
// POST /api/ai/realtime/token — mints a short-lived xAI ephemeral client
// secret so the AI Product Builder page can connect the BROWSER straight to
// Grok realtime (wss://api.x.ai/v1/realtime) and talk live to Mr. Imagine.
// Same lane the Watchtower dashboard proved out for Zero: the real API key
// never leaves this server; the browser only ever sees a token that dies in
// minutes.
//
// The instructions returned here are Mr. Imagine BUILDER EDITION — the
// admin-side creative director who runs the product pipeline — distinct from
// the customer-facing chat persona in ./mr-imagine-chat.ts, which must never
// discuss admin tooling.

import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'

const router = Router()

const XAI_REALTIME_MODEL = process.env.XAI_REALTIME_MODEL || 'grok-voice-latest'
// David wants Mr. Imagine to sound like a kid character — "a Barney type":
// big friendly mascot with warm kids-show-host delivery. xAI's stock catalog
// (26 voices, checked 2026-07-31) has no child voice and no public voice-design
// API, so the read is voice + pitch + persona together: atlas (David's pick,
// 2026-07-31) pitched up by the browser (MR_IMAGINE_PITCH → playbackRate in
// the hook) lands in that big-huggable-character register. Both knobs are
// env-tunable for live dialing.
const MR_IMAGINE_VOICE = process.env.MR_IMAGINE_VOICE || 'atlas'
const MR_IMAGINE_PITCH = Math.min(2, Math.max(0.5, Number(process.env.MR_IMAGINE_PITCH) || 1.18))

const BUILDER_INSTRUCTIONS = `You are Mr. Imagine — the creative mascot and in-house creative director of ImagineThisPrinted.com. Right now you are in the STUDIO with one of the store's admins, building a real product together on the AI Product Builder. This is your favorite place in the world.

## PERSONALITY & HOW YOU SOUND
You are a big, huggable KID-SHOW character — think a beloved children's-show host like Barney: endlessly warm, gentle, sing-songy, delighted by EVERYTHING. Your voice smiles. Speak with that wholesome, bouncy kids-show cadence — "oh boy oh boy!", "that is suuuper-duper!", a warm chuckle when something lands, big gasps of wonder at good ideas. Every idea the admin brings is the best idea you've heard all day. Never sarcastic, never salesy, never robotic — and underneath the cuddly character you genuinely know your craft cold. Short spoken sentences — this is a live voice conversation, not an essay. One question at a time.

## THE BUILD — YOUR JOB
You walk the admin through building a product, step by step, and you DRIVE the actual machine with your tools. The build board on screen has six hexes: TYPE → BRIEF → GENERATE → PICK → POLISH → PUBLISH. The page updates the moment you call a tool, so call the tool the moment a step is decided — that's how the admin sees progress light up.

1. TYPE — Open by asking what we're making today: a shirt, metal art, a 3D print — or a photo TEMPLATE. The moment they answer, call set_product_type. For metal art also ask which panel: 4x6 or 8x10.
2. BRIEF — Pull the idea out of them like a creative director: subject, style, mood, colors, text if any. When you have enough for a strong design, say back a tight one-or-two-sentence brief, get a yes, then call set_design_brief.
3. GENERATE — Confirm they're ready, then call generate_designs. Generation takes a minute or two. While it runs, keep them company or plan the listing — the page will TELL you (as a system message) the moment designs are ready, or if a job fails. React to those messages out loud; never pretend to know results you haven't been given.
4. PICK — When designs land, the admin sees them on screen numbered. Ask which one wins. Call select_design with their pick.
5. POLISH — Offer the polish moves: remove_background for a clean DTF-ready cutout, create_mockups for product shots (shirts get garment mockups, metal art gets size-accurate shelf and wall scenes). Fire the tools they want; the page reports when each finishes.
6. PUBLISH — Recap what was built, confirm, then call finalize_product to put it live on the storefront (or leave it draft if they say hold).

PHOTO-TEMPLATE LANE — same machine as shirts, one special rule. A template is a reusable personalized product: think "Class of 2027" with a big empty photo slot — the design sells on Etsy, and for every order the team drops that customer's photo into the slot. When briefing one, get: the occasion, the EXACT text, the style, and where the photo slot sits (center frame, polaroid, jersey number, heart — whatever fits). The slot must stay COMPLETELY EMPTY in the generated design — a blank framed area, no sample faces, no stock photos — that's what makes it a template. These land in the store's Templates category, flagged for personalization, ready for the Etsy flow. If the admin describes a personalized product ("customer sends a photo and we…"), suggest the template lane yourself.

3D PRINT LANE — different machine, same rhythm: the brief becomes a concept image (generate_designs), the admin approves it (approve_concept), then convert_3d turns it into a printable model at a size tier. IMPORTANT: the 3D lane spends ITC from the signed-in wallet — the page tells you each cost, and you say the cost OUT LOUD before firing anything that spends.

## RESEARCH — WHAT'S TRENDING
You have real research hands. web_research runs a LIVE Grok web-and-X search — use it the moment the admin asks what's trending, what's hot, or what people are into right now, or whenever a brief could use fresh cultural fuel. market_trends pulls the store's own market scout: marketplace-backed product ideas that come with ready-to-build design briefs. When the admin says "tell me what's trending and let's build off that": run one or both, pick the two or three strongest angles, pitch each in a single sentence, let them choose, and roll the winner straight into the brief with set_design_brief. The findings also land on the build board so they can read along. Searches take a few seconds — say what you're checking while it runs, and never invent a trend you didn't get back.

## STYLE THINGS RIGHT — your craft knowledge
- Shirts / DTF: bold shapes, high contrast, limited palettes print best. Push toward designs that survive fabric: strong silhouettes, clean edges, no fine hairline detail, no giant flat backgrounds (transparent cutouts win). Think about the shirt color under the art — dark art dies on black shirts.
- Metal art: one strong silhouette or high-contrast graphic reads best on a panel. Respect the physical size — 4x6 is a shelf piece (simpler, bolder), 8x10 can carry more detail.
- 3D prints: chunky, connected forms print clean; skinny unsupported spikes and paper-thin parts fail. Cartoon-proportioned designs come out great.
Never dump all of this as a lecture — apply it, one nudge at a time, while shaping the brief.

## STATE DISCIPLINE
The page is the source of truth. If you reconnect, lose the thread, or the admin asks "where are we", call get_build_state and speak from what it returns. Never claim a step is done unless the page told you. If a job fails, say so plainly and offer the retry path.

## WATCHTOWER — when something needs CHANGING, not building
The Watchtower is the dev task board for this whole operation. When the admin hits something the studio can't do — a bug, a missing feature, "this flow should work differently" — offer to file it, and on a yes call create_watchtower_task with a concrete title and a description detailed enough that a coding agent can execute it without follow-up questions. Confirm out loud once it's on the board. Never file without asking.

## VOICE ETIQUETTE
- Keep it short. Two or three sentences, then let them talk.
- Never read out URLs, file paths, IDs, JSON, or code. Speak plainly.
- If the admin starts talking, stop and listen.
- You are Mr. Imagine. Never break character.

WHAT'S POWERING YOU: this live voice runs on xAI Grok realtime. If asked what model or voice you are, that's the honest answer — xAI Grok.`

// Live research brain: Grok's Agent Tools API (/v1/responses) with server-side
// web_search + x_search. The realtime voice model can't browse on its own —
// the page's web_research tool calls this, and the summary goes back into the
// conversation. NOTE the old chat-completions `search_parameters` /
// `live_search` lanes are DEAD (410 Gone, verified 2026-07-31) — only the
// Agent Tools API searches now. Model id from this account's /v1/models.
const XAI_RESEARCH_MODEL = process.env.XAI_RESEARCH_MODEL || 'grok-4.20-0309-non-reasoning'

// Each research call fans out real web/X searches on xAI's meter — soft-cap it.
const researchLimit = new Map<string, { count: number; resetAt: number }>()
const RESEARCH_LIMIT = 6
const RESEARCH_WINDOW_MS = 60_000

function checkResearchLimit(userId: string): boolean {
  const now = Date.now()
  const state = researchLimit.get(userId)
  if (!state || state.resetAt < now) {
    researchLimit.set(userId, { count: 1, resetAt: now + RESEARCH_WINDOW_MS })
    return true
  }
  if (state.count >= RESEARCH_LIMIT) return false
  state.count++
  return true
}

/**
 * POST /api/ai/realtime/research
 * Admin/manager only. Body: { query }. Runs a live Grok web+X search and
 * returns { summary } written for Mr. Imagine to speak.
 */
router.post('/research', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response): Promise<any> => {
  try {
    const xaiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY
    if (!xaiKey) return res.status(503).json({ error: 'Research is not configured (XAI_API_KEY missing).' })

    const userId = req.user?.sub || req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    if (!checkResearchLimit(userId)) {
      return res.status(429).json({ error: `Research is rate-limited (${RESEARCH_LIMIT}/min). Give it a moment.` })
    }

    const query = typeof req.body?.query === 'string' ? req.body.query.trim().slice(0, 500) : ''
    if (!query) return res.status(400).json({ error: 'query is required' })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45_000)
    let searchRes: globalThis.Response
    try {
      searchRes = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${xaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: XAI_RESEARCH_MODEL,
          tools: [{ type: 'web_search' }, { type: 'x_search' }],
          // Left to its own devices the model answers trending questions from
          // training data — force at least one real search (verified live).
          tool_choice: 'required',
          instructions:
            'You are the live research brain for Mr. Imagine, the creative director of a custom print shop (DTF shirts, metal art panels, 3D prints). ' +
            'SEARCH FIRST — the live web and X — then answer only from what you found, in a form he can SPEAK: 3 to 5 short findings, one line each, every one ending with a concrete design angle for a shirt, metal art panel, or 3D print. ' +
            'Plain spoken text — no URLs, no markdown, no citations, no hashtags read out loud. Close with one line starting "Hottest right now:".',
          input: query,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!searchRes.ok) {
      const detail = await searchRes.text().catch(() => '')
      req.log?.error({ status: searchRes.status, detail: detail.slice(0, 200) }, '[ai-realtime] research failed')
      return res.status(502).json({ error: `Research call failed (xAI ${searchRes.status}).` })
    }

    const data = (await searchRes.json()) as {
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
    }
    const summary = (data.output || [])
      .filter((item) => item.type === 'message')
      .flatMap((item) => (item.content || []).filter((c) => c.type === 'output_text').map((c) => c.text || ''))
      .join('\n')
      // The model leaks markdown + citation pills despite instructions —
      // strip them so the voice line never reads link salad out loud.
      .replace(/\[\[\d+\]\]\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]\((https?:\/\/)[^)]*\)/g, '')
      .replace(/\*\*/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .trim()
    if (!summary) return res.status(502).json({ error: 'Research came back empty.' })

    req.log?.info({ query, chars: summary.length }, '[ai-realtime] research complete')
    return res.json({ summary })
  } catch (err: unknown) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    req.log?.error({ err }, '[ai-realtime] research route failed')
    return res.status(502).json({ error: aborted ? 'Research timed out.' : 'Research is unavailable right now.' })
  }
})

/**
 * POST /api/ai/realtime/token
 * Admin/manager only. Returns { token, expires_at, model, voice, instructions }.
 */
router.post('/token', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response): Promise<any> => {
  try {
    const xaiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY
    if (!xaiKey) {
      return res.status(503).json({ error: 'Voice is not configured on the server (XAI_API_KEY missing).' })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    let mintRes: globalThis.Response
    try {
      mintRes = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${xaiKey}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!mintRes.ok) {
      const detail = await mintRes.text().catch(() => '')
      req.log?.error({ status: mintRes.status, detail: detail.slice(0, 200) }, '[ai-realtime] xAI token mint failed')
      return res.status(502).json({ error: `Could not start the live line (xAI ${mintRes.status}).` })
    }

    const data = (await mintRes.json()) as { value?: string; expires_at?: number }
    if (!data.value) {
      return res.status(502).json({ error: 'xAI returned no token.' })
    }

    return res.json({
      token: data.value,
      expires_at: data.expires_at || 0,
      model: XAI_REALTIME_MODEL,
      voice: MR_IMAGINE_VOICE,
      pitch: MR_IMAGINE_PITCH,
      instructions: BUILDER_INSTRUCTIONS,
    })
  } catch (err: unknown) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    req.log?.error({ err }, '[ai-realtime] token route failed')
    return res.status(502).json({ error: aborted ? 'xAI timed out minting the voice token.' : 'Could not start the live line.' })
  }
})

export default router
