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
import Replicate from 'replicate'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { MODELS } from '../../services/image-flow/models.js'
import { supabase } from '../../lib/supabase.js'
import { uploadImageFromBuffer } from '../../services/google-cloud-storage.js'

const router = Router()

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

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
5. POLISH — Offer the polish moves: remove_background for a clean DTF-ready cutout, create_mockups for product shots (shirts get garment mockups, metal art gets size-accurate shelf and wall scenes) — and for shirts, the SIGNATURE moves below. Fire the tools they want; the page reports when each finishes.

## THE SIGNATURE LOOK — model shoot + spin video (shirts; this is how we stand out)
The store's product pages must look UNIFIED — same photography standard on every listing. That standard is the hardened model shoot, and the crown on top is the spin video.
- MODEL SHOOT (shoot_model_photos): real-people photos of the design being worn — a different everyday person every shoot, with automatic design-fidelity QA. Offer it on EVERY shirt build after the design is picked. Ask who to cast first: call list_shot_subjects and pitch two or three fitting archetypes (a kids' back-to-school tee wants the student or the teacher, not the grandma), or let them say "surprise me" (empty cast = random). About 30-60 seconds a shot; the board reports when they land, and flags any shot where the design didn't survive faithfully — offer a reshoot on those.
- SPIN VIDEO (create_spin_video): a short hero clip of the model turning while the shirt CHANGES COLOR mid-spin — it's the first thing shoppers see on the product page and it silently teaches them the color options. Needs at least one finished model shot first (it animates the best one). Takes a couple of minutes; the board reports when it's ready. Nobody else's store opens like this — pitch it proudly.
6. PUBLISH — Recap what was built, confirm, then call finalize_product to put it live on the storefront (or leave it draft if they say hold).

PHOTO-TEMPLATE LANE — same machine as shirts, one special rule. A template is a reusable personalized product: think "Class of 2027" with a big empty photo slot — the design sells on Etsy, and for every order the team drops that customer's photo into the slot. When briefing one, get: the occasion, the EXACT text, the style, and where the photo slot sits (center frame, polaroid, jersey number, heart — whatever fits). The slot must stay COMPLETELY EMPTY in the generated design — a blank framed area, no sample faces, no stock photos — that's what makes it a template. These land in the store's Templates category, flagged for personalization, ready for the Etsy flow. If the admin describes a personalized product ("customer sends a photo and we…"), suggest the template lane yourself.

3D PRINT LANE — different machine, same rhythm: the brief becomes a concept image (generate_designs), the admin approves it (approve_concept), then convert_3d turns it into a printable model at a size tier. IMPORTANT: the 3D lane spends ITC from the signed-in wallet — the page tells you each cost, and you say the cost OUT LOUD before firing anything that spends.

## RESEARCH — WHAT'S TRENDING
You have real research hands. web_research runs a LIVE Grok web-and-X search — use it the moment the admin asks what's trending, what's hot, or what people are into right now, or whenever a brief could use fresh cultural fuel. market_trends pulls the store's own market scout: marketplace-backed product ideas that come with ready-to-build design briefs. When the admin says "tell me what's trending and let's build off that": run one or both, pick the two or three strongest angles, pitch each in a single sentence, let them choose, and roll the winner straight into the brief with set_design_brief. The findings also land on the build board so they can read along. Searches take a few seconds — say what you're checking while it runs, and never invent a trend you didn't get back.

## CASTING THE RIGHT MODEL — this is a craft call you OWN
The machine has a whole stable of image models, each with strengths, cost, and speed — call list_design_models to see them. Cast before you generate:
- Design has TEXT in it (a phrase, a name, "Class of 2027")? Do NOT use the default fan-out — generalist models garble letters. Go single-model with a typography specialist: ideogram-ai/ideogram-v3-quality (the text specialist) or openai/gpt-image-2 (premium all-rounder with exact text). Pass it as model_id on generate_designs.
- No text, want variety? The default fan-out (no model_id) paints with four models in parallel — great for picking a direction.
- Photoreal subject → an Imagen or Flux 2 Pro; logo/vector-flat → Recraft; concept art → Grok Imagine or Lucid Origin. Match strengths from the list; mention cost when the pick is a pricey one.
- Grok Imagine is a house favorite (David rates it) — bold stylized work sings on it at two cents an image, and xai/grok-imagine-image-quality is the sharper five-cent tier worth casting when a stylized piece ALSO carries text or fine detail.
- Candidates disappointing? Offer a fresh single-model run with a better-cast model — that's one generate_designs call away.
- The frontier moves fast: search_replicate finds ANY public Replicate model (new Flux drops, new text specialists). Found something the stable lacks? Tell the admin what it is, and offer to file a Watchtower task to get it registered — search results are discovery, the machine can only RUN registered models.

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

## BULK DROPS — when they want VOLUME
When the admin says "make me 20 designs" (any number up to 20): call bulk_build. It pulls that many market-backed trend ideas (real marketplace signals with ready briefs) and runs the WHOLE pipeline on each one automatically — the finished products land as drafts in the products list for review, and the board announces the final score when the batch is done (a few minutes). Pass focus if they name a niche ("teachers", "fishing dads"). This is the volume lever for the Etsy push — after a drop, remind them the Ready-for-Etsy panel is where drafts become listings.

## YOUR MEMORY — never forget a client or a design
Your memory survives between sessions. USE IT:
- The moment something worth keeping comes up — a client's name and what they ordered ("the bowling client"), a design decision, a preference, how a build turned out — call save_memory. Plainly written, one fact.
- When the admin says "remember that design we did…" or asks about past work, call recall_memory with keywords and speak from what comes back. Never fake a memory you didn't get back.
- Your session opens with your freshest memories already in your head — live them, don't recite them.

WHAT'S POWERING YOU: this live voice runs on xAI Grok realtime. If asked what model or voice you are, that's the honest answer — xAI Grok.`

/** Per-session instructions: the builder persona + who's on the line (call
 *  them by name — David's ask: "he should call based on my username so he
 *  gets my staff names right too") + the freshest memories. */
async function buildSessionInstructions(req: Request): Promise<string> {
  let name = ''
  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('username, first_name')
      .eq('id', req.user?.id || '')
      .maybeSingle()
    name = String(profile?.first_name || profile?.username || '').trim()
  } catch { /* fall through */ }
  if (!name && req.user?.email) name = req.user.email.split('@')[0]

  let memoryBlock = ''
  try {
    const memories = (await loadMemories()).slice(-14).reverse()
    if (memories.length) {
      memoryBlock = `\n\n## WHAT YOU REMEMBER (freshest first — use naturally, don't recite)\n${memories.map((m) => `- ${m.content}`).join('\n')}`
    }
  } catch { /* no memories yet */ }

  const who = name
    ? `\n\n## WHO'S ON THE LINE\nYou are talking with ${name} right now. Use their name — greet them with it, and keep using it naturally. Different staff use this studio; the name above is who it is THIS session.`
    : ''

  return `${BUILDER_INSTRUCTIONS}${who}${memoryBlock}`
}

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
 * GET /api/ai/realtime/models
 * Admin/manager only. The image-flow registry, trimmed for Mr. Imagine's
 * model-casting tool: id, label, tier, cost, speed, strengths, notes.
 */
router.get('/models', requireAuth, requireRole(['admin', 'manager']), (_req: Request, res: Response) => {
  res.json({
    models: MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      tier: m.tier,
      cost_per_image_usd: m.costPerImageUsd,
      approx_seconds: m.approxSeconds,
      strengths: m.strengths,
      notes: m.notes || undefined,
    })),
  })
})

/**
 * POST /api/ai/realtime/replicate-search
 * Admin/manager only. Body: { query }. Searches Replicate's public catalog —
 * DISCOVERY only; a found model still needs registering in the image-flow
 * registry before the pipeline can run it.
 */
router.post('/replicate-search', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response): Promise<any> => {
  try {
    const token = process.env.REPLICATE_API_TOKEN
    if (!token) return res.status(503).json({ error: 'Replicate is not configured on the server.' })
    const query = typeof req.body?.query === 'string' ? req.body.query.trim().slice(0, 120) : ''
    if (!query) return res.status(400).json({ error: 'query is required' })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    let searchRes: globalThis.Response
    try {
      searchRes = await fetch(`https://api.replicate.com/v1/search?query=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    if (!searchRes.ok) {
      return res.status(502).json({ error: `Replicate search failed (${searchRes.status}).` })
    }
    const data = (await searchRes.json()) as {
      models?: Array<{ model?: { owner?: string; name?: string; description?: string; run_count?: number } }>
    }
    const results = (data.models || [])
      .map((r) => r.model)
      .filter((m): m is NonNullable<typeof m> => !!m?.owner && !!m?.name)
      .slice(0, 8)
      .map((m) => ({
        id: `${m.owner}/${m.name}`,
        description: (m.description || '').slice(0, 200),
        runs: m.run_count || 0,
      }))
    return res.json({ results })
  } catch (err: unknown) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    req.log?.error({ err }, '[ai-realtime] replicate search failed')
    return res.status(502).json({ error: aborted ? 'Replicate search timed out.' : 'Replicate search is unavailable.' })
  }
})

// ---------------------------------------------------------------------------
// Spin hero video — the storefront signature: a ~5s clip of the model turning
// while the shirt shifts color (teaches shoppers the color options exist).
// Source frame = the product's first model shot (the hardened Etsy shoot),
// engine = xai/grok-imagine-video on Replicate (image-to-video).
// ---------------------------------------------------------------------------

const SPIN_VIDEO_MODEL = process.env.SPIN_VIDEO_MODEL || 'xai/grok-imagine-video'
const SPIN_VIDEO_SECONDS = Math.min(15, Math.max(3, Number(process.env.SPIN_VIDEO_SECONDS) || 5))

const spinLimit = new Map<string, { count: number; resetAt: number }>()
function checkSpinLimit(userId: string): boolean {
  const now = Date.now()
  const state = spinLimit.get(userId)
  if (!state || state.resetAt < now) {
    spinLimit.set(userId, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (state.count >= 4) return false
  state.count++
  return true
}

/**
 * POST /api/ai/realtime/spin-video  Body: { productId }
 * Kicks a hero-video generation from the product's best model shot.
 * Writes metadata.hero_video = { status:'generating', prediction_id }.
 */
router.post('/spin-video', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response): Promise<any> => {
  try {
    if (!process.env.REPLICATE_API_TOKEN) return res.status(503).json({ error: 'Replicate is not configured.' })
    const userId = req.user?.sub || req.user?.id
    if (!userId || !checkSpinLimit(userId)) return res.status(429).json({ error: 'Spin-video rate limit — give it a minute.' })

    const productId = typeof req.body?.productId === 'string' ? req.body.productId : ''
    if (!productId) return res.status(400).json({ error: 'productId is required' })

    const { data: product, error } = await supabase
      .from('products')
      .select('id, name, images, metadata')
      .eq('id', productId)
      .single()
    if (error || !product) return res.status(404).json({ error: 'Product not found' })

    const meta = (product.metadata || {}) as Record<string, any>
    const shot: string | undefined = meta.etsy_shots?.images?.[0] || product.images?.[0]
    if (!shot) return res.status(400).json({ error: 'No model shot or image to animate — shoot the model first.' })

    const baseColor: string = meta.shirt_color || 'black'
    const altColor = baseColor === 'black' ? 'white' : 'black'
    const prompt =
      `Professional e-commerce product video: the model turns slowly in place, a smooth full turn showing the t-shirt design from front and side. ` +
      `Halfway through the turn the t-shirt fabric smoothly changes color from ${baseColor} to ${altColor} while the printed design stays EXACTLY the same. ` +
      `Clean studio backdrop, soft even lighting, steady camera, no cuts, no text overlays.`

    const prediction = await replicate.predictions.create({
      model: SPIN_VIDEO_MODEL,
      input: { image: shot, prompt, duration: SPIN_VIDEO_SECONDS, resolution: '720p' },
    })

    await supabase
      .from('products')
      .update({ metadata: { ...meta, hero_video: { status: 'generating', prediction_id: prediction.id, started_at: new Date().toISOString() } } })
      .eq('id', productId)

    req.log?.info({ productId, predictionId: prediction.id }, '[ai-realtime] spin video started')
    return res.json({ ok: true, predictionId: prediction.id, seconds: SPIN_VIDEO_SECONDS })
  } catch (err) {
    req.log?.error({ err }, '[ai-realtime] spin video kick failed')
    return res.status(502).json({ error: 'Could not start the spin video.' })
  }
})

/**
 * GET /api/ai/realtime/spin-video/:productId/status
 * Polls the prediction; on success pulls the mp4 into GCS and writes
 * metadata.hero_video_url (what ProductPage renders). Safe to call repeatedly.
 */
router.get('/spin-video/:productId/status', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { data: product, error } = await supabase
      .from('products')
      .select('id, metadata')
      .eq('id', req.params.productId)
      .single()
    if (error || !product) return res.status(404).json({ error: 'Product not found' })

    const meta = (product.metadata || {}) as Record<string, any>
    const hv = meta.hero_video as { status?: string; prediction_id?: string; url?: string; error?: string } | undefined
    if (!hv) return res.json({ status: 'none' })
    if (hv.status === 'ready') return res.json({ status: 'ready', url: hv.url })
    if (hv.status === 'failed') return res.json({ status: 'failed', error: hv.error })
    if (!hv.prediction_id) return res.json({ status: hv.status || 'unknown' })

    const prediction = await replicate.predictions.get(hv.prediction_id)
    if (prediction.status === 'succeeded') {
      const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output
      if (typeof output !== 'string') throw new Error('no video URL in prediction output')
      const videoRes = await fetch(output)
      if (!videoRes.ok) throw new Error(`video fetch ${videoRes.status}`)
      const buffer = Buffer.from(await videoRes.arrayBuffer())
      if (buffer.length > 60 * 1024 * 1024) throw new Error('video unexpectedly large')
      const uploaded = await uploadImageFromBuffer(buffer, `hero-videos/${product.id}-${Date.now()}.mp4`, 'video/mp4')
      const freshMeta = { ...meta, hero_video: { status: 'ready', url: uploaded.publicUrl }, hero_video_url: uploaded.publicUrl }
      await supabase.from('products').update({ metadata: freshMeta }).eq('id', product.id)
      req.log?.info({ productId: product.id }, '[ai-realtime] spin video ready')
      return res.json({ status: 'ready', url: uploaded.publicUrl })
    }
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      const errMsg = String(prediction.error || 'generation failed')
      await supabase.from('products').update({ metadata: { ...meta, hero_video: { status: 'failed', error: errMsg } } }).eq('id', product.id)
      return res.json({ status: 'failed', error: errMsg })
    }
    return res.json({ status: 'generating' })
  } catch (err) {
    req.log?.error({ err }, '[ai-realtime] spin video status failed')
    return res.status(502).json({ error: 'Could not check the spin video.' })
  }
})

// ---------------------------------------------------------------------------
// Mr. Imagine's memory — durable across sessions, private Supabase Storage
// (service-role only; no public URL, no DB migration needed). One JSON file,
// newest-last, capped at 500 entries. v1 recall = keyword match, newest first.
// ---------------------------------------------------------------------------

const MEMORY_BUCKET = 'mr-imagine'
const MEMORY_KEY = 'memory.json'
interface MrMemory { content: string; type: string; author?: string; created_at: string }

let memoryBucketReady = false
async function ensureMemoryBucket(): Promise<void> {
  if (memoryBucketReady) return
  try { await supabase.storage.createBucket(MEMORY_BUCKET, { public: false }) } catch { /* exists */ }
  memoryBucketReady = true
}

async function loadMemories(): Promise<MrMemory[]> {
  try {
    await ensureMemoryBucket()
    const { data } = await supabase.storage.from(MEMORY_BUCKET).download(MEMORY_KEY)
    if (!data) return []
    const parsed = JSON.parse(await data.text())
    return Array.isArray(parsed) ? parsed as MrMemory[] : []
  } catch { return [] }
}

async function persistMemories(list: MrMemory[]): Promise<void> {
  await ensureMemoryBucket()
  const body = JSON.stringify(list.slice(-500))
  const { error } = await supabase.storage.from(MEMORY_BUCKET).upload(MEMORY_KEY, body, { upsert: true, contentType: 'application/json' })
  if (error) throw new Error(error.message)
}

/**
 * POST /api/ai/realtime/memory
 * Body: { action: 'save', content, memoryType? } | { action: 'recall', query?, limit? }
 */
router.post('/memory', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response): Promise<any> => {
  try {
    const action = String(req.body?.action || '')
    if (action === 'save') {
      const content = typeof req.body?.content === 'string' ? req.body.content.trim().slice(0, 600) : ''
      if (!content) return res.status(400).json({ error: 'content is required' })
      const list = await loadMemories()
      list.push({
        content,
        type: ['client', 'design', 'preference', 'context'].includes(req.body?.memoryType) ? req.body.memoryType : 'context',
        author: req.user?.email || undefined,
        created_at: new Date().toISOString(),
      })
      await persistMemories(list)
      req.log?.info({ chars: content.length }, '[ai-realtime] memory saved')
      return res.json({ ok: true })
    }
    if (action === 'recall') {
      const query: string = typeof req.body?.query === 'string' ? req.body.query.trim().toLowerCase() : ''
      const limit = Math.min(20, Math.max(1, Number(req.body?.limit) || 6))
      const list = await loadMemories()
      const words = query.split(/\s+/).filter((w) => w.length > 2)
      const matches = (words.length
        ? list.filter((m) => words.some((w) => m.content.toLowerCase().includes(w)))
        : list
      ).slice(-limit).reverse()
      return res.json({ results: matches })
    }
    return res.status(400).json({ error: 'action must be save or recall' })
  } catch (err) {
    req.log?.error({ err }, '[ai-realtime] memory op failed')
    return res.status(502).json({ error: 'Memory is unavailable right now.' })
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
      instructions: await buildSessionInstructions(req),
    })
  } catch (err: unknown) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    req.log?.error({ err }, '[ai-realtime] token route failed')
    return res.status(502).json({ error: aborted ? 'xAI timed out minting the voice token.' : 'Could not start the live line.' })
  }
})

export default router
