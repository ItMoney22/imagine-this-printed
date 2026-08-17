import OpenAI from 'openai'
import { searchTrends } from './serpapi-search.js'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

// gpt-4.1-mini is being migrated off per the 2026-07 OpenAI model audit.
// Env-configurable, current default. Matches product-trends.ts / serpapi-search.ts.
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-nano'
const isReasoningModel = /^(o[1-9]|gpt-5)/.test(OPENAI_TEXT_MODEL)

export interface DesignBrief {
  id: string
  rank: number
  score: number
  theme: string
  saying: string
  styleNotes: string
  targetHoliday: string
  targetDate: string
  niche: string
  audience: string
  productType: 'tshirt' | 'hoodie' | 'tank'
  evidence: string[]
  saturation: 'low' | 'medium' | 'high'
  riskFlags: string[]
  sourceQueries: string[]
}

export interface DesignBriefQueue {
  generatedAt: string
  briefs: DesignBrief[]
  note: string
}

// Two marketplace signal sources, both reached through SerpAPI (the same
// ToS-compliant search channel already used by product-trends.ts) rather than
// direct scraping of etsy.com/amazon.com, which their terms of service forbid.
// Etsy has no public "trending/best-seller" endpoint on Open API v3 (only
// listing CRUD, which is what backend/services/etsy.ts already uses to POST
// listings) — SerpAPI's google engine, scoped with site: filters, is the
// practical substitute called out in the task's own acceptance criteria.
const MARKETPLACE_SITE_FILTERS = ['site:etsy.com', 'site:amazon.com OR site:redbubble.com OR site:teepublic.com']

interface HolidaySeed {
  name: string
  month: number // 1-12
  day: number
  niche: string
}

// Fixed-date gifting/apparel holidays. Movable-feast dates (Easter, Mother's/
// Father's Day) are approximated to a fixed day-of-month, which is accurate
// enough for a 60-day lead-time ranking signal.
const HOLIDAYS: HolidaySeed[] = [
  { name: "New Year's Day", month: 1, day: 1, niche: 'motivational new-year resolutions' },
  { name: "Valentine's Day", month: 2, day: 14, niche: 'romantic and galentine gift sayings' },
  { name: "St. Patrick's Day", month: 3, day: 17, niche: 'lucky and Irish-pride humor' },
  { name: "Mother's Day", month: 5, day: 10, niche: 'mom life and grandma sayings' },
  { name: "Father's Day", month: 6, day: 15, niche: 'dad jokes and girl-dad sayings' },
  { name: '4th of July', month: 7, day: 4, niche: 'patriotic americana' },
  { name: 'Back to School', month: 8, day: 15, niche: 'teacher appreciation and first-day-of-school' },
  { name: 'Halloween', month: 10, day: 31, niche: 'spooky season and horror-comedy' },
  { name: 'Thanksgiving', month: 11, day: 24, niche: 'grateful and family-gathering humor' },
  { name: 'Christmas', month: 12, day: 25, niche: 'holiday matching family and ugly-sweater humor' },
]

// Evergreen best-seller niches that stay relevant regardless of the calendar.
const EVERGREEN_NICHES = [
  'dog mom and cat mom sarcastic sayings',
  'nurse and healthcare worker humor',
  'sarcastic coffee-addict humor',
  'retro vintage sunset streetwear',
  'camping and outdoors lifestyle sayings',
  'gym and fitness motivational quotes',
]

function nextOccurrence(month: number, day: number, from: Date): Date {
  const year = from.getFullYear()
  let candidate = new Date(Date.UTC(year, month - 1, day))
  if (candidate.getTime() < from.getTime()) {
    candidate = new Date(Date.UTC(year + 1, month - 1, day))
  }
  return candidate
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

interface SeedTarget {
  niche: string
  targetHoliday: string
  targetDate: string
  isHoliday: boolean
  daysUntil: number
}

// Picks the seed list for a run: every holiday inside the next ~65 days
// (so the design queue always looks ahead far enough for production lead
// time) plus a rotating slice of evergreen niches to fill out the queue.
function pickSeedTargets(now: Date, evergreenCount = 4): SeedTarget[] {
  const holidayTargets: SeedTarget[] = HOLIDAYS.map((h) => {
    const date = nextOccurrence(h.month, h.day, now)
    return {
      niche: h.niche,
      targetHoliday: h.name,
      targetDate: date.toISOString().slice(0, 10),
      isHoliday: true,
      daysUntil: daysBetween(now, date),
    }
  }).filter((t) => t.daysUntil <= 65)

  // Rotate the evergreen slice by day-of-year so the same niches aren't
  // repeated verbatim every single run.
  const dayOfYear = Math.floor((now.getTime() - Date.UTC(now.getFullYear(), 0, 0)) / 86400000)
  const rotated = [...EVERGREEN_NICHES.slice(dayOfYear % EVERGREEN_NICHES.length), ...EVERGREEN_NICHES.slice(0, dayOfYear % EVERGREEN_NICHES.length)]
  const evergreenTargets: SeedTarget[] = rotated.slice(0, evergreenCount).map((niche) => ({
    niche,
    targetHoliday: 'Evergreen',
    targetDate: 'ongoing',
    isHoliday: false,
    daysUntil: 999,
  }))

  return [...holidayTargets, ...evergreenTargets]
}

function scoreBrief(target: SeedTarget, saturation: DesignBrief['saturation'], evidenceCount: number): number {
  const holidayScore = target.isHoliday ? Math.max(0, 60 - target.daysUntil) : 35
  const saturationBonus = saturation === 'low' ? 20 : saturation === 'medium' ? 10 : 0
  const evidenceBonus = Math.min(evidenceCount * 5, 15)
  return Math.max(0, Math.min(100, Math.round(holidayScore + saturationBonus + evidenceBonus)))
}

function briefId(theme: string, index: number): string {
  return `${theme.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48) || 'brief'}-${index + 1}`
}

function parseJsonArray(raw: string): any[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed.briefs)) return parsed.briefs
  } catch {
    const start = raw.indexOf('[')
    const end = raw.lastIndexOf(']')
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1))
        if (Array.isArray(parsed)) return parsed
      } catch {
        return []
      }
    }
  }
  return []
}

function fallbackBriefsFor(target: SeedTarget): Array<{ theme: string; saying: string; styleNotes: string; audience: string }> {
  const label = target.niche
  return [
    {
      theme: `${target.targetHoliday === 'Evergreen' ? 'Evergreen' : target.targetHoliday} — ${label}`,
      saying: 'MADE FOR THIS',
      styleNotes: 'Bold centered typography, high contrast, one accent color, easy to read at thumbnail size.',
      audience: 'Gift buyers browsing this niche',
    },
  ]
}

async function generateBriefsForTarget(target: SeedTarget): Promise<DesignBrief[]> {
  const marketplaceQueries = MARKETPLACE_SITE_FILTERS.map(
    (filter) => `${filter} best selling t-shirt "${target.niche}" ${target.isHoliday ? target.targetHoliday : 'trending'}`
  )
  const contextParts = await Promise.all(marketplaceQueries.map((q) => searchTrends(q)))
  const trendContext = contextParts.filter(Boolean).join('\n\n---\n\n').slice(0, 4000)
  const evidence = contextParts.filter(Boolean)

  if (!trendContext) {
    return fallbackBriefsFor(target).map((b, i) => ({
      id: briefId(b.theme, i),
      rank: 0,
      score: scoreBrief(target, 'medium', 0),
      theme: b.theme,
      saying: b.saying,
      styleNotes: b.styleNotes,
      targetHoliday: target.targetHoliday,
      targetDate: target.targetDate,
      niche: target.niche,
      audience: b.audience,
      productType: 'tshirt',
      evidence: ['No live marketplace context returned — used a safe evergreen fallback brief.'],
      saturation: 'medium',
      riskFlags: [],
      sourceQueries: marketplaceQueries,
    }))
  }

  const completion = await openai.chat.completions.create({
    model: OPENAI_TEXT_MODEL,
    ...(isReasoningModel ? {} : { temperature: 0.6 }),
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a t-shirt design market scout for a print-on-demand shop. Turn Etsy/Amazon/Redbubble/TeePublic search snippets into concrete, sellable t-shirt design briefs. Return strict JSON only: {"briefs":[...]}. Sayings must be original text (2-6 words), commercially safe: no brand names, celebrities, sports teams, song lyrics, movie quotes, political slogans, trademarked catchphrases, profanity, or copyrighted language. Bias toward phrases/themes the snippets show real demand for.',
      },
      {
        role: 'user',
        content: `Niche: ${target.niche}
Target occasion: ${target.targetHoliday}${target.isHoliday ? ` (${target.targetDate})` : ''}
Return exactly 2 design briefs for this niche.

Each brief needs:
- theme: short design concept name
- saying: the exact on-shirt text, original wording, 2-6 words, uppercase
- styleNotes: layout/typography/color direction a designer can execute directly
- audience: who buys this
- productType: tshirt, hoodie, or tank
- saturation: low, medium, or high — how crowded this exact angle looks in the snippets
- riskFlags: array of practical IP/content risks, empty array if low risk

Marketplace snippets:
${trendContext}`,
      },
    ],
  })

  const raw = completion.choices[0]?.message?.content ?? '{"briefs":[]}'
  const parsed = parseJsonArray(raw)

  const briefs: DesignBrief[] = parsed.slice(0, 3).map((raw: any, index: number) => {
    const saturation: DesignBrief['saturation'] = ['low', 'medium', 'high'].includes(raw?.saturation) ? raw.saturation : 'medium'
    const theme = typeof raw?.theme === 'string' && raw.theme.trim() ? raw.theme.trim().slice(0, 80) : `${target.niche} idea ${index + 1}`
    return {
      id: briefId(theme, index),
      rank: 0,
      score: scoreBrief(target, saturation, evidence.length),
      theme,
      saying: typeof raw?.saying === 'string' && raw.saying.trim() ? raw.saying.trim().toUpperCase().slice(0, 60) : 'MADE FOR THIS',
      styleNotes: typeof raw?.styleNotes === 'string' && raw.styleNotes.trim() ? raw.styleNotes.trim().slice(0, 220) : 'Bold centered typography, high contrast, one accent color.',
      targetHoliday: target.targetHoliday,
      targetDate: target.targetDate,
      niche: target.niche,
      audience: typeof raw?.audience === 'string' ? raw.audience.slice(0, 120) : 'Gift buyers browsing this niche',
      productType: ['tshirt', 'hoodie', 'tank'].includes(raw?.productType) ? raw.productType : 'tshirt',
      evidence: evidence.slice(0, 2).map((e) => e.slice(0, 160)),
      saturation,
      riskFlags: Array.isArray(raw?.riskFlags) ? raw.riskFlags.filter((v: any) => typeof v === 'string').slice(0, 4) : [],
      sourceQueries: marketplaceQueries,
    }
  })

  return briefs.length ? briefs : fallbackBriefsFor(target).map((b, i) => ({
    id: briefId(b.theme, i),
    rank: 0,
    score: scoreBrief(target, 'medium', evidence.length),
    theme: b.theme,
    saying: b.saying,
    styleNotes: b.styleNotes,
    targetHoliday: target.targetHoliday,
    targetDate: target.targetDate,
    niche: target.niche,
    audience: b.audience,
    productType: 'tshirt',
    evidence: evidence.slice(0, 2).map((e) => e.slice(0, 160)),
    saturation: 'medium',
    riskFlags: [],
    sourceQueries: marketplaceQueries,
  }))
}

/**
 * Runs the daily scout pass: pulls upcoming-holiday + evergreen niche
 * targets, gets live marketplace search context for each, has the model
 * turn that context into concrete design briefs, scores every brief with a
 * deterministic ranking function, and returns the top N sorted descending.
 */
export async function runDesignBriefScout(input: { minBriefs?: number } = {}): Promise<DesignBriefQueue> {
  const minBriefs = input.minBriefs ?? 10
  const now = new Date()
  const targets = pickSeedTargets(now)

  const perTarget = await Promise.all(targets.map((t) => generateBriefsForTarget(t)))
  let all = perTarget.flat()

  // pickSeedTargets already caps at 65 days out, but guarantee the floor
  // even if a marketplace call comes back empty for every target.
  if (all.length < minBriefs) {
    const extra = EVERGREEN_NICHES
      .filter((n) => !targets.some((t) => t.niche === n))
      .slice(0, minBriefs - all.length)
      .map((niche) => ({ niche, targetHoliday: 'Evergreen', targetDate: 'ongoing', isHoliday: false, daysUntil: 999 }))
    const extraBriefs = await Promise.all(extra.map((t) => generateBriefsForTarget(t)))
    all = all.concat(extraBriefs.flat())
  }

  all.sort((a, b) => b.score - a.score)
  const ranked = all.slice(0, Math.max(minBriefs, 12)).map((b, i) => ({ ...b, rank: i + 1 }))

  return {
    generatedAt: now.toISOString(),
    briefs: ranked,
    note: 'Design Brief Scout ranks by holiday proximity, evergreen-niche weight, live-search saturation, and evidence strength. Review sayings for trademark/IP overlap before a design agent produces artwork.',
  }
}
