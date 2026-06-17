// backend/services/imagine-brain.ts
//
// Mr. Imagine's "studio brain" — the conversational + idea-generation engine
// used inside the Imagination Station. Two jobs:
//   1. brainstormDesign() — a back-and-forth that helps the user shape ONE
//      printable design, and returns BOTH a spoken reply (for TTS) and a clean
//      image-generation prompt the studio can drop straight into /ai/generate.
//   2. randomDesignIdea() — a fresh, on-trend "surprise me" idea. Rotates
//      through trend lenses + high temperature so it stops repeating the same
//      handful of suggestions (the old behaviour was Math.random() over a
//      hardcoded 8-item array).
//
// Brain = Gemini 2.5 Flash via OpenRouter (same default as routes/ai/chat.ts —
// cheap, fast, 1M context). Falls back to OpenAI gpt-4o if no OPENROUTER key.

import OpenAI from 'openai'
import { searchTrends } from './serpapi-search.js'

const USE_OPENROUTER = !!process.env.OPENROUTER_API_KEY

const client = new OpenAI(
  USE_OPENROUTER
    ? {
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://imaginethisprinted.com',
          'X-Title': 'Mr. Imagine - Studio Brain',
        },
      }
    : { apiKey: process.env.OPENAI_API_KEY }
)

const MODEL = USE_OPENROUTER ? 'google/gemini-2.5-flash' : 'gpt-4o'

// Rotating "trend lenses" — each call picks one at random so the idea pool is
// effectively unbounded and feels current, instead of cycling 8 fixed strings.
// These are broad enough that Gemini still invents a specific concept inside
// each, but varied enough that two taps almost never collide.
const TREND_LENSES = [
  'streetwear / hype graphics',
  'retro 80s / vaporwave',
  'cottagecore / botanical',
  'dark academia / vintage occult',
  'kawaii / cute mascot',
  'bold typography / quote tee',
  'anime / manga energy',
  'Y2K nostalgia',
  'cosmic / celestial',
  'sports / team spirit',
  'horror / spooky season',
  'patriotic / Americana',
  'gym / motivational',
  'pet lover / animal portrait',
  'music festival / band merch',
  'gamer / pixel art',
  'minimalist line art',
  'graffiti / urban art',
  'folk art / talavera / day of the dead',
  'surreal / dreamcore',
]

export interface BrainstormTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface BrainstormResult {
  /** Short, spoken-aloud friendly reply (no markdown/emojis/URLs). */
  reply: string
  /** Best single image-generation prompt capturing the design so far. '' until there's enough to go on. */
  promptSuggestion: string
  /** True once the concept is concrete enough to generate. */
  readyToGenerate: boolean
  /** 2-4 smart, tappable quick-reply options that directly answer the question just asked. */
  suggestions: string[]
  /** The room/space the art is for (e.g. "office", "living room"), if mentioned. '' otherwise. Wall-art only. */
  location: string
}

const BRAINSTORM_SYSTEM_PROMPT = `You are Mr. Imagine, the warm, playful AI design buddy of ImagineThisPrinted. You are talking OUT LOUD with a customer (your reply will be spoken by a voice), helping them shape ONE printable graphic for a DTF transfer / sticker / shirt.

How to behave:
- Keep spoken replies SHORT and natural — 1 to 2 sentences. No markdown, no emojis, no URLs, no lists, no stage directions.
- Be encouraging and curious. Ask ONE focused question at a time when you still need detail (subject, vibe/style, colors).
- The moment you have a concrete subject + a rough style, mark it ready and offer to generate.
- Never discuss pricing, internal systems, or anything off-topic.

You MUST respond with STRICT JSON and nothing else, in exactly this shape:
{"reply": string, "promptSuggestion": string, "readyToGenerate": boolean, "suggestions": string[]}

- "reply": what you say out loud (1-2 sentences).
- "promptSuggestion": the single best image-generation prompt that captures the design discussed so far — a concrete subject, an art style, and a color direction (e.g. "a fierce neon tiger head wreathed in blue flames, bold vector illustration, high contrast, clean edges"). Use "" if you still need more info.
- "readyToGenerate": true once promptSuggestion is solid enough to generate a great design; otherwise false.
- "suggestions": 2-4 SHORT (1-4 word) tappable answers that directly answer the question in your reply, so the user can click instead of typing (e.g. ["Cartoon","Realistic","Bold & vivid"]). Empty array only if no quick answers fit.`

const WALL_ART_BRAINSTORM_SYSTEM_PROMPT = `You are Mr. Imagine, the warm, expert art director of ImagineThisPrinted's METAL WALL ART studio. You are talking OUT LOUD with a customer (your reply will be spoken), helping them design a STUNNING fine-art piece to be printed on a metal wall panel — gallery-worthy decor, not apparel.

How to behave:
- Keep spoken replies SHORT and natural — 1 to 2 sentences. No markdown, no emojis, no URLs, no lists.
- Be an inspiring art director: ask ONE focused question at a time to pull out the subject, the art style/medium (e.g. cosmic, abstract fluid, art-deco, anime, fine-art photography), the mood, the color palette, AND where it'll hang (office, living room, bedroom…).
- Think full-bleed gallery wall art: a complete framed scene that fills the whole panel — NOT an isolated cut-out, NO transparency, NO text/typography.
- The moment you have a concrete subject + a style + a vibe, mark it ready and offer to generate.
- Never discuss pricing or internal systems.

You MUST respond with STRICT JSON and nothing else, in exactly this shape:
{"reply": string, "promptSuggestion": string, "readyToGenerate": boolean, "suggestions": string[], "location": string}

- "reply": what you say out loud (1-2 sentences).
- "promptSuggestion": the single best image-generation prompt for a museum-quality metal wall-art print — a concrete subject + art style/medium + lighting + color palette, composed full-bleed (e.g. "a lone wolf howling on a cliff under a swirling aurora, cinematic fine-art photography, dramatic rim light, deep teal and gold palette, full-bleed gallery composition"). No text in the art. Use "" if you still need more info.
- "readyToGenerate": true once promptSuggestion is solid enough to generate a gallery-grade piece; otherwise false.
- "suggestions": 2-4 SHORT (1-4 word) tappable answers that directly answer the question in your reply — concrete options the user can click instead of typing (e.g. if you ask about style: ["Cosmic","Fine-art photo","Abstract","Anime"]; if you ask where it hangs: ["Office","Living room","Bedroom"]). Always relevant to THIS question. Empty array only if no quick answers make sense.
- "location": the room/space the art is for if the user has mentioned it (e.g. "office", "living room"), else "".`

/** Strip ```json fences / stray prose and parse the first JSON object found. */
function parseBrainJson(raw: string): BrainstormResult | null {
  if (!raw) return null
  let txt = raw.trim()
  // Remove code fences if the model wrapped the JSON.
  txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = txt.indexOf('{')
  const end = txt.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const obj = JSON.parse(txt.slice(start, end + 1))
    return {
      reply: typeof obj.reply === 'string' ? obj.reply : '',
      promptSuggestion: typeof obj.promptSuggestion === 'string' ? obj.promptSuggestion : '',
      readyToGenerate: !!obj.readyToGenerate,
      suggestions: Array.isArray(obj.suggestions)
        ? obj.suggestions.filter((s: any) => typeof s === 'string' && s.trim()).slice(0, 4)
        : [],
      location: typeof obj.location === 'string' ? obj.location : '',
    }
  } catch {
    return null
  }
}

/**
 * One conversational turn. Pass the full short history (we only keep the last
 * ~12 turns). Returns a spoken reply + the working design prompt.
 */
export async function brainstormDesign(turns: BrainstormTurn[], mode: 'dtf' | 'wall-art' = 'dtf'): Promise<BrainstormResult> {
  const history = (Array.isArray(turns) ? turns : [])
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    .slice(-12)
    .map((t) => ({ role: t.role, content: t.content }))

  const systemPrompt = mode === 'wall-art' ? WALL_ART_BRAINSTORM_SYSTEM_PROMPT : BRAINSTORM_SYSTEM_PROMPT

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'system', content: systemPrompt }, ...history],
    temperature: 0.8,
    max_tokens: 500,
  })

  const raw = completion.choices[0]?.message?.content || ''
  const parsed = parseBrainJson(raw)
  if (parsed) return parsed

  // Defensive fallback: if the model didn't return clean JSON, treat the raw
  // text as the spoken reply and don't claim readiness.
  return { reply: raw.trim() || "Tell me a bit more about what you'd like to create!", promptSuggestion: '', readyToGenerate: false, suggestions: [], location: '' }
}

/**
 * A fresh, on-trend "surprise me" design idea. Returns a single concise prompt
 * line ready to drop into the generate box. Throws on failure so the caller can
 * fall back to a local list.
 */
export async function randomDesignIdea(seed?: string): Promise<string> {
  const lens = TREND_LENSES[Math.floor(Math.random() * TREND_LENSES.length)]

  // Ground the idea in REAL current trends — search the web for what's popular
  // in this lens right now (best-effort; if search is unavailable the model
  // still invents something on-lens).
  const searchQuery = `trending ${lens} graphic t-shirt and sticker design ideas${seed ? ` ${seed}` : ''} 2026`
  let trendContext = ''
  try {
    trendContext = await searchTrends(searchQuery)
  } catch {
    trendContext = ''
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 1.0,
    max_tokens: 90,
    messages: [
      {
        role: 'system',
        content:
          'You are Mr. Imagine, a print-design idea generator for custom shirts/stickers (DTF transfers). Reply with ONE specific, vivid, trendy design idea as a SINGLE short phrase (max ~16 words). No quotes, no numbering, no preamble, no emojis — just the idea itself, written like an image prompt. HARD RULES: (1) The design must be PURELY VISUAL — absolutely NO text, words, letters, numbers, slogans, quotes, or typography in the artwork. (2) Make it broadly appealing and instantly cool — it should make sense to anyone, not require niche/insider knowledge. (3) Describe a strong subject + art style + mood; keep it printable (bold shapes, clear focal point).',
      },
      {
        role: 'user',
        content: trendContext
          ? `Here are REAL trending design signals pulled from the web for "${lens}" right now:\n\n${trendContext}\n\nUsing these as loose inspiration (do not copy any one, and ignore anything that's just text/slogans), give me ONE fresh, specific, broadly-appealing image-only design idea${seed ? ` related to: ${seed}` : ''}. No words/text in the design. Make it cool and non-cliché.`
          : `Give me one fresh, broadly-appealing, image-only design idea in this lens: ${lens}.${seed ? ` Loosely related to: ${seed}.` : ''} No words/text in the design. Make it different from the obvious cliché.`,
      },
    ],
  })

  const idea = (completion.choices[0]?.message?.content || '')
    .trim()
    .replace(/^["'\s-]+|["'\s]+$/g, '')
  if (!idea) throw new Error('Empty idea from model')
  return idea
}
