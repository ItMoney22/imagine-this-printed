import OpenAI from 'openai'
import { searchTrends } from './serpapi-search.js'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export type TrendSource = 'all' | 'tiktok' | 'etsy' | 'amazon'
export type TrendFamily = 'all' | 'apparel' | 'tumblers' | 'dtf-transfers' | 'stickers' | 'metal-art' | '3d-toys'
export type ExecutableProductCategory = 'dtf-transfers' | 'shirts' | 'hoodies' | 'tumblers'

export interface ProductTrendIdea {
  id: string
  title: string
  source: 'TikTok' | 'Etsy' | 'Amazon' | 'Google'
  productFamily: string
  category: ExecutableProductCategory
  prompt: string
  targetAudience: string
  primaryColors: string
  designStyle: string
  priceTarget: number
  imageStyle: 'realistic' | 'cartoon' | 'semi-realistic'
  productType: 'tshirt' | 'hoodie' | 'tank'
  shirtColor: 'black' | 'white' | 'gray'
  printPlacement: 'front-center' | 'left-pocket' | 'back-only' | 'pocket-front-back-full'
  printStyle: 'clean' | 'halftone' | 'grunge'
  whyItMaySell: string
  evidence: string[]
  saturation: 'low' | 'medium' | 'high'
  riskFlags: string[]
}

export interface ProductTrendResponse {
  ideas: ProductTrendIdea[]
  searchedQueries: string[]
  generatedAt: string
  note: string
}

export interface SimpleWordPhrase {
  id: string
  phrase: string
  audience: string
  vibe: string
  whyItMaySell: string
  riskFlags: string[]
}

export interface SimpleWordPhraseResponse {
  phrases: SimpleWordPhrase[]
  searchedQueries: string[]
  generatedAt: string
  note: string
}

const FAMILY_QUERY: Record<TrendFamily, string> = {
  all: 'print on demand products apparel tumblers stickers wall art custom gifts',
  apparel: 'graphic tees hoodies streetwear print on demand shirts',
  tumblers: 'custom tumblers cup designs drinkware gifts',
  'dtf-transfers': 'DTF transfers heat press gang sheet shirt designs',
  stickers: 'vinyl stickers laptop decals planner stickers',
  'metal-art': 'metal wall art posters room decor print trends',
  '3d-toys': 'collectible toys desk toys custom 3d printed figures',
}

const SOURCE_QUERY: Record<TrendSource, string[]> = {
  all: ['TikTok Shop trending products', 'Etsy best selling custom products', 'Amazon handmade trending gifts'],
  tiktok: ['TikTok Shop trending products', 'TikTok Creative Center top products', 'TikTok viral product trends'],
  etsy: ['Etsy best selling custom products', 'Etsy trending handmade gifts', 'Etsy popular print on demand designs'],
  amazon: ['Amazon best sellers custom gifts', 'Amazon handmade trending gifts', 'Amazon creators product ideas'],
}

function cleanSource(source: TrendSource): ProductTrendIdea['source'] {
  if (source === 'tiktok') return 'TikTok'
  if (source === 'etsy') return 'Etsy'
  if (source === 'amazon') return 'Amazon'
  return 'Google'
}

function safeId(title: string, index: number): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48) || 'trend'}-${index + 1}`
}

function parseJsonArray(raw: string): any[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed.ideas)) return parsed.ideas
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

function coerceIdea(raw: any, index: number, fallbackSource: ProductTrendIdea['source']): ProductTrendIdea {
  const category: ExecutableProductCategory = ['dtf-transfers', 'shirts', 'hoodies', 'tumblers'].includes(raw?.category)
    ? raw.category
    : 'shirts'
  const imageStyle: ProductTrendIdea['imageStyle'] = ['realistic', 'cartoon', 'semi-realistic'].includes(raw?.imageStyle)
    ? raw.imageStyle
    : 'semi-realistic'
  const productType: ProductTrendIdea['productType'] = ['tshirt', 'hoodie', 'tank'].includes(raw?.productType)
    ? raw.productType
    : category === 'hoodies' ? 'hoodie' : 'tshirt'
  const shirtColor: ProductTrendIdea['shirtColor'] = ['black', 'white', 'gray'].includes(raw?.shirtColor)
    ? raw.shirtColor
    : 'black'
  const printPlacement: ProductTrendIdea['printPlacement'] = ['front-center', 'left-pocket', 'back-only', 'pocket-front-back-full'].includes(raw?.printPlacement)
    ? raw.printPlacement
    : 'front-center'
  const printStyle: ProductTrendIdea['printStyle'] = ['clean', 'halftone', 'grunge'].includes(raw?.printStyle)
    ? raw.printStyle
    : 'clean'
  const title = typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 80) : `Trend idea ${index + 1}`

  return {
    id: safeId(title, index),
    title,
    source: ['TikTok', 'Etsy', 'Amazon', 'Google'].includes(raw?.source) ? raw.source : fallbackSource,
    productFamily: typeof raw?.productFamily === 'string' ? raw.productFamily.slice(0, 60) : 'Print product',
    category,
    prompt: typeof raw?.prompt === 'string' && raw.prompt.trim() ? raw.prompt.trim() : title,
    targetAudience: typeof raw?.targetAudience === 'string' ? raw.targetAudience.slice(0, 120) : '',
    primaryColors: typeof raw?.primaryColors === 'string' ? raw.primaryColors.slice(0, 120) : '',
    designStyle: typeof raw?.designStyle === 'string' ? raw.designStyle.slice(0, 120) : '',
    priceTarget: Number.isFinite(Number(raw?.priceTarget)) ? Math.max(1, Number(raw.priceTarget)) : category === 'tumblers' ? 28 : 25,
    imageStyle,
    productType,
    shirtColor,
    printPlacement,
    printStyle,
    whyItMaySell: typeof raw?.whyItMaySell === 'string' ? raw.whyItMaySell.slice(0, 220) : 'Matches current marketplace signals and can be produced with the existing AI product pipeline.',
    evidence: Array.isArray(raw?.evidence) ? raw.evidence.filter((v: any) => typeof v === 'string').slice(0, 3) : [],
    saturation: ['low', 'medium', 'high'].includes(raw?.saturation) ? raw.saturation : 'medium',
    riskFlags: Array.isArray(raw?.riskFlags) ? raw.riskFlags.filter((v: any) => typeof v === 'string').slice(0, 4) : [],
  }
}

function fallbackIdeas(source: TrendSource, family: TrendFamily): ProductTrendIdea[] {
  const label = family === 'all' ? 'custom print' : family.replace(/-/g, ' ')
  return [
    coerceIdea({
      title: `Bold ${label} statement graphic`,
      source: cleanSource(source),
      productFamily: label,
      category: family === 'tumblers' ? 'tumblers' : 'shirts',
      prompt: `A bold, high-contrast ${label} design with modern typography, a clean central icon, and a premium streetwear feel.`,
      targetAudience: 'Gift buyers and trend-driven shoppers',
      primaryColors: 'black, white, electric purple',
      designStyle: 'streetwear typography',
      whyItMaySell: 'Broad enough for quick production, easy to adapt across shirts, hoodies, transfers, and tumblers.',
      evidence: ['Fallback idea used because live trend search did not return enough context.'],
      saturation: 'medium',
      riskFlags: ['Validate demand before bulk publishing.'],
    }, 0, cleanSource(source)),
  ]
}

function phraseId(phrase: string, index: number): string {
  return `${phrase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 42) || 'phrase'}-${index + 1}`
}

function parseJsonObject(raw: string): any {
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1))
      } catch {
        return {}
      }
    }
  }
  return {}
}

function coercePhrase(raw: any, index: number): SimpleWordPhrase {
  const phrase = typeof raw?.phrase === 'string' && raw.phrase.trim()
    ? raw.phrase.trim().replace(/\s+/g, ' ').slice(0, 48)
    : `MAKE IT HAPPEN ${index + 1}`
  return {
    id: phraseId(phrase, index),
    phrase,
    audience: typeof raw?.audience === 'string' ? raw.audience.slice(0, 90) : 'trend buyers',
    vibe: typeof raw?.vibe === 'string' ? raw.vibe.slice(0, 80) : 'bold minimal',
    whyItMaySell: typeof raw?.whyItMaySell === 'string'
      ? raw.whyItMaySell.slice(0, 180)
      : 'Short, readable phrases work well as fast-turn front-print products.',
    riskFlags: Array.isArray(raw?.riskFlags) ? raw.riskFlags.filter((v: any) => typeof v === 'string').slice(0, 3) : [],
  }
}

function fallbackPhrases(): SimpleWordPhrase[] {
  return [
    { phrase: 'GOOD THINGS TAKE TIME', audience: 'gift buyers', vibe: 'minimal optimistic', whyItMaySell: 'Positive, broad, and easy to wear across age groups.', riskFlags: [] },
    { phrase: 'OFF DUTY', audience: 'weekend shoppers', vibe: 'clean streetwear', whyItMaySell: 'Short lifestyle phrase that works with bold front placement.', riskFlags: [] },
    { phrase: 'PROTECT YOUR PEACE', audience: 'wellness and self-care buyers', vibe: 'calm minimal', whyItMaySell: 'Self-care language stays broadly giftable and shareable.', riskFlags: [] },
    { phrase: 'LOCAL LEGEND', audience: 'local pride shoppers', vibe: 'bold varsity', whyItMaySell: 'Flexible for city, school, and event drops without using protected marks.', riskFlags: [] },
  ].map((p, index) => coercePhrase(p, index))
}

export async function suggestSimpleWordPhrases(input: {
  source?: TrendSource
  seed?: string
  limit?: number
}): Promise<SimpleWordPhraseResponse> {
  const source = input.source ?? 'all'
  const limit = Math.min(Math.max(input.limit ?? 10, 4), 16)
  const seed = input.seed?.trim()
  const sourceQueries = SOURCE_QUERY[source] ?? SOURCE_QUERY.all
  const searchedQueries = [
    ...sourceQueries.slice(0, 2).map((q) => `${q} simple text shirt phrases`),
    `viral short shirt sayings typography apparel ${seed || ''}`.trim(),
    `best selling minimalist quote shirts ${seed || ''}`.trim(),
  ]

  const contextParts = await Promise.all(searchedQueries.map((query) => searchTrends(query)))
  const trendContext = contextParts.filter(Boolean).join('\n\n---\n\n').slice(0, 5000)

  if (!trendContext) {
    return {
      phrases: fallbackPhrases(),
      searchedQueries,
      generatedAt: new Date().toISOString(),
      note: 'Live trend search returned no context, so this response used safe evergreen phrase ideas.',
    }
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.9,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You generate short text-only shirt phrases for a custom print shop. Return strict JSON only: {"phrases":[...]}. Phrases must be original, generic, commercially safe, 2-5 words, easy to read on a shirt, and not use brands, celebrities, team names, song lyrics, movie quotes, political slogans, trademarked catchphrases, profanity, hate, medical claims, or copyrighted language. Do not promise profit.',
      },
      {
        role: 'user',
        content: `Generate ${limit} fast-turn front-print phrase ideas.
Optional focus: ${seed || 'none'}

Each phrase item:
- phrase: exact words in uppercase, 2-5 words, no punctuation unless necessary
- audience
- vibe
- whyItMaySell
- riskFlags: practical IP/content risks, empty array if low risk

Trend snippets:
${trendContext}`,
      },
    ],
  })

  const obj = parseJsonObject(completion.choices[0]?.message?.content ?? '{}')
  const phrases = Array.isArray(obj.phrases)
    ? obj.phrases.slice(0, limit).map((p: any, index: number) => coercePhrase(p, index))
    : []

  return {
    phrases: phrases.length ? phrases : fallbackPhrases(),
    searchedQueries,
    generatedAt: new Date().toISOString(),
    note: 'Phrase Scout uses live trend snippets plus AI. Review phrases before publishing, especially for trademark or slogan overlap.',
  }
}

export async function suggestProductTrends(input: {
  source?: TrendSource
  family?: TrendFamily
  seed?: string
  limit?: number
}): Promise<ProductTrendResponse> {
  const source = input.source ?? 'all'
  const family = input.family ?? 'all'
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 8)
  const sourceQueries = SOURCE_QUERY[source] ?? SOURCE_QUERY.all
  const familyQuery = FAMILY_QUERY[family] ?? FAMILY_QUERY.all
  const seedClause = input.seed?.trim() ? ` ${input.seed.trim()}` : ''
  const searchedQueries = sourceQueries.slice(0, 3).map((q) => `${q} ${familyQuery}${seedClause}`.trim())

  const trendContextParts = await Promise.all(searchedQueries.map((query) => searchTrends(query)))
  const trendContext = trendContextParts.filter(Boolean).join('\n\n---\n\n').slice(0, 6000)

  if (!trendContext) {
    return {
      ideas: fallbackIdeas(source, family),
      searchedQueries,
      generatedAt: new Date().toISOString(),
      note: 'Live trend search returned no context, so this response used a safe fallback idea.',
    }
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.55,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You turn marketplace/social trend snippets into practical custom-print product ideas for store staff. Return strict JSON only: {"ideas":[...]}. Do not copy trademarked characters, brand logos, celebrity names, team names, or protected phrases. Use generic visual directions inspired by demand signals. Every idea must be executable by the current product builder categories only: dtf-transfers, shirts, hoodies, tumblers.',
      },
      {
        role: 'user',
        content: `Source filter: ${source}
Product family filter: ${family}
Return ${limit} ideas.

Each idea needs:
- title
- source: TikTok, Etsy, Amazon, or Google
- productFamily
- category: one of dtf-transfers, shirts, hoodies, tumblers
- prompt: production-ready design prompt, no garment/mockup wording unless category is tumblers
- targetAudience
- primaryColors
- designStyle
- priceTarget: number in dollars
- imageStyle: realistic, cartoon, or semi-realistic
- productType: tshirt, hoodie, or tank
- shirtColor: black, white, or gray
- printPlacement: front-center, left-pocket, back-only, or pocket-front-back-full
- printStyle: clean, halftone, or grunge
- whyItMaySell
- evidence: 1-3 short evidence bullets from the snippets
- saturation: low, medium, or high
- riskFlags: array of practical risks, especially trademark/IP concerns

Trend snippets:
${trendContext}`,
      },
    ],
  })

  const raw = completion.choices[0]?.message?.content ?? '{"ideas":[]}'
  const ideas = parseJsonArray(raw)
    .slice(0, limit)
    .map((idea, index) => coerceIdea(idea, index, cleanSource(source)))

  return {
    ideas: ideas.length ? ideas : fallbackIdeas(source, family),
    searchedQueries,
    generatedAt: new Date().toISOString(),
    note: 'Trend Scout uses live search snippets plus AI ranking. Confirm demand and IP risk before publishing at scale.',
  }
}
