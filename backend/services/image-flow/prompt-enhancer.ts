// Prompt enhancer — runs Money's raw prompt through Gemini 2.5 Pro via OpenRouter,
// using the target model's promptCraft playbook so the rewritten prompt fits that model.
// Ported from david-trinidad-com (Watchtower) at src/modules/image-flow/lib/prompt-enhancer.ts.

import type { ImageModel, Purpose } from './models.js'

const ENHANCER_MODEL = 'google/gemini-2.5-pro'

export interface EnhanceResult {
  enhanced: string
  rationale: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

const PURPOSE_HINT: Record<Purpose, string> = {
  product:
    'A single isolated graphic illustration meant to be printed. Describe ONLY the artwork itself — one clear subject, bold clean shapes, strong central focal point, crisp edges. NEVER describe a t-shirt, hoodie, garment, person, model, mannequin, or mockup, and never use the words "fabric" or "transparent background". Assume the art sits centered on a solid color background.',
  'product-edit':
    'Edit pass on an existing product/design image. Preserve identity and overall composition unless explicitly asked to change them.',
  mockup:
    'Garment mockup / product photography. Show the design applied to apparel realistically (flat lay, ghost mannequin, or worn). Pure white or neutral background.',
  hero: 'Large landing-page hero. Cinematic composition, strong focal point, negative space for headline copy.',
  banner: 'Wide banner format. Horizontal flow, breathable composition, lead-space for text overlay.',
  gallery: 'Gallery thumbnail. Clear subject, good crop at square/3:4, no wasted margins.',
  thumbnail: 'Tiny thumbnail. One high-contrast subject, minimal background detail.',
  avatar: 'Round-crop avatar. Centered face/subject, simple background, high recognizability at small size.',
  logo: 'Logo or mark. Vector-ready, flat or minimal gradient, works at 16px and 1024px.',
  icon: 'UI icon. Glyph clarity at small sizes, 1-2 colors, consistent stroke weight.',
  background: 'Background image. Low-attention composition, even luminance, supports overlaid UI.',
  'social-post': 'Square/vertical social-post. Scroll-stopping focal point, brand-palette consistent.',
  'email-header': 'Email header strip. Horizontal, loads fast, minimal detail in dark-mode-safe palette.',
  'blog-cover': 'Blog cover. Editorial feel, slight atmospheric depth, supports headline overlay.',
  concept: 'Concept art. Freer composition, stronger mood/color story, exploration-friendly.',
  reference: 'Reference image. Clean accurate rendering of the subject for downstream edits.',
}

const TIER_FALLBACK: Record<string, string> = {
  draft: 'Keep it short (<25 words), keyword-heavy, no cinematic prose.',
  workhorse: '40–100 words, balanced prose. Lead with subject, then lighting, then style.',
  hero: '80–150 words of cinematic prose.',
  'text-in-image': "Put the exact text in double quotes at the top, then describe the visual around it.",
  vector: 'Flat vector language. Specify style, color count, geometry. Under 40 words.',
  edit: 'Instruction-style, not description. State what changes AND what must stay the same.',
  bg: 'Describe only the new background (replace) or return unchanged (remove).',
}

export async function enhancePrompt(opts: {
  prompt: string
  purpose: Purpose
  model?: ImageModel
}): Promise<EnhanceResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not set — cannot enhance prompts')
  }

  const hint = PURPOSE_HINT[opts.purpose] ?? ''
  const modelBlock = opts.model
    ? [
        `Target model: ${opts.model.label} (${opts.model.id})`,
        `Tier: ${opts.model.tier}`,
        `Strengths: ${opts.model.strengths.join(', ')}`,
        `Playbook: ${opts.model.promptCraft ?? TIER_FALLBACK[opts.model.tier] ?? 'Write clear, specific prose.'}`,
      ].join('\n')
    : 'Target model: unknown — write clear, specific prose that works across most generators.'

  const systemPrompt = `You are a creative director and prompt craftsperson for an apparel/print e-commerce stack. You've studied every model in the roster and know their quirks. Your job: take the user's raw one-liner and rewrite it as the prompt THIS specific model wants to see.

RULES:
1. Keep the user's core intent. Do not invent subjects they didn't mention.
2. Follow the model's playbook below EXACTLY. A photoreal model wants camera specs; a vector model wants flat-design language; a draft model wants keywords; an edit model wants instructions.
3. Match the PURPOSE (where this image will live).
4. Single paragraph. No markdown, no bullets, no quotes around the whole thing.
5. Return VALID JSON ONLY: {"enhanced": "...", "rationale": "one sentence on what you added and why"}.

Purpose: ${opts.purpose} — ${hint}

${modelBlock}`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://imaginethisprinted.com',
      'X-Title': 'ITP Image Flow Prompt Enhancer',
    },
    body: JSON.stringify({
      model: ENHANCER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: opts.prompt },
      ],
      max_tokens: 2000,
      temperature: 0.6,
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`enhancer ${res.status}: ${err.slice(0, 300)}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const raw = data.choices?.[0]?.message?.content?.trim() ?? ''
  const inputTokens = data.usage?.prompt_tokens ?? 0
  const outputTokens = data.usage?.completion_tokens ?? 0

  const parsed = tryParseEnhancerJson(raw)

  // Gemini 2.5 Pro pricing on OpenRouter: $1.25/M in, $10/M out (approx).
  const costUsd = (inputTokens / 1_000_000) * 1.25 + (outputTokens / 1_000_000) * 10
  return {
    enhanced: parsed.enhanced,
    rationale: parsed.rationale,
    inputTokens,
    outputTokens,
    costUsd,
  }
}

function tryParseEnhancerJson(raw: string): { enhanced: string; rationale: string } {
  const attempts: string[] = [raw]
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) attempts.push(fenced[1].trim())
  const bs = raw.indexOf('{')
  const be = raw.lastIndexOf('}')
  if (bs !== -1 && be !== -1 && be > bs) attempts.push(raw.slice(bs, be + 1))

  for (const candidate of attempts) {
    try {
      const obj = JSON.parse(candidate)
      if (typeof obj.enhanced === 'string') {
        return {
          enhanced: obj.enhanced,
          rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
        }
      }
    } catch {
      // try next
    }
  }
  const enhancedMatch = raw.match(/"enhanced"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (enhancedMatch) {
    try {
      const unescaped = JSON.parse(`"${enhancedMatch[1]}"`)
      if (unescaped) return { enhanced: unescaped, rationale: 'recovered from truncated JSON' }
    } catch {
      // fall through
    }
  }
  const fallback = (fenced ? fenced[1] : raw).trim().replace(/^["']|["']$/g, '')
  return { enhanced: fallback || raw, rationale: 'fallback — model did not return JSON' }
}
