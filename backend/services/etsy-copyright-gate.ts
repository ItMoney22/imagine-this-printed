// Etsy copyright / IP + AI-disclosure gate — playbook §4, REQUIRED and fail-closed.
// NOTHING publishes to Etsy unless runCopyrightGate(...).pass === true.
//
// v1 = deterministic checks (trademark/brand denylist + AI-disclosure enforcement).
// This is intentionally conservative and cheap; upgrade path is to call an LLM / IP API
// for nuanced lookalike + character detection. Keep the fail-closed contract on any upgrade.

export interface CopyrightGateInput {
  name?: string
  description?: string
  tags?: string[]
  // true unless the product is explicitly flagged as NOT AI-assisted. ITP is an AI-design
  // platform, so we default to requiring the disclosure (over-disclosing is policy-safe).
  aiGenerated?: boolean
}

export interface CopyrightGateResult {
  pass: boolean
  reasons: string[]           // why it was blocked (empty when pass === true)
  aiGenerated: boolean
  disclosure?: string         // AI disclosure to append to the listing description (when aiGenerated)
  matchedTerms: string[]      // trademark/brand terms that tripped the gate
}

// Starter denylist of third-party trademarks / franchises / brands that must never appear on an
// ITP listing without human IP clearance. Not exhaustive — expand or replace with an IP service.
const TRADEMARK_DENYLIST: string[] = [
  'disney', 'pixar', 'marvel', 'avengers', 'spider-man', 'spiderman', 'star wars', 'mandalorian',
  'harry potter', 'hogwarts', 'pokemon', 'pikachu', 'nintendo', 'super mario', 'sonic', 'minecraft',
  'fortnite', 'roblox', 'sanrio', 'hello kitty', 'spongebob', 'simpsons', 'peppa pig', 'bluey',
  'sesame street', 'grinch', 'dr seuss', 'barbie', 'lego', 'nike', 'adidas', 'jordan', 'gucci',
  'louis vuitton', 'chanel', 'supreme', 'coca-cola', 'coca cola', 'pepsi', 'starbucks', 'nfl', 'nba',
  'mlb', 'nhl', 'nascar', 'olympics', 'super bowl', 'taylor swift', 'stanley cup', 'in my era',
  // Sports-event and governing-body marks. Added 2026-07-25 after a live catalogue
  // sweep found four active ITP shirts (FIFA World Cup 2026, two Argentina World Cup,
  // Team USA Soccer) that the original list waved through. FIFA and the USOPC both
  // enforce aggressively, and "Olympic"/"Team USA" are protected by statute in the US
  // (36 U.S.C. §220506), not just trademark law.
  'fifa', 'world cup', 'team usa', 'olympic', 'paralympic', 'uefa', 'premier league',
  'champions league', 'march madness', 'final four', 'wimbledon', 'ryder cup',
  // Character/franchise marks that survive as adjectives and so miss the plural forms above.
  'disney princess', 'mickey mouse', 'winnie the pooh', 'looney tunes', 'dc comics',
  'batman', 'superman', 'wonder woman', 'stranger things', 'squid game', 'jujutsu kaisen',
  'dragon ball', 'naruto', 'my little pony', 'transformers',
  'jurassic park', 'ghostbusters', 'top gun', 'john deere', 'jeep', 'harley davidson',
  'harley-davidson', 'ford', 'chevrolet', 'yeti', 'carhartt', 'patagonia', 'north face'
]

export const AI_DISCLOSURE =
  'This design is a seller-prompted, AI-assisted creation, directed and curated by ImagineThisPrinted.'

const DISCLOSURE_PRESENT = /seller[- ]prompted|ai[- ]assisted|ai creation|ai-generated art/i

// Word-boundary matcher for a denylist term. Terms are trusted (module constants),
// but escape anyway so a future entry with regex punctuation can't break the gate open.
const denyCache = new Map<string, RegExp>()
function denyPattern(term: string): RegExp {
  let re = denyCache.get(term)
  if (!re) {
    re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    denyCache.set(term, re)
  }
  return re
}

export function runCopyrightGate(input: CopyrightGateInput): CopyrightGateResult {
  const reasons: string[] = []
  const haystack = [input.name, input.description, ...(input.tags || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  // 1) Trademark / brand scan — fail-closed on any hit. Matched on word boundaries
  // rather than raw substring so short marks ("ford", "sonic", "jeep") don't block
  // innocent words like "Oxford", "supersonic" or "jeepers".
  const matchedTerms = TRADEMARK_DENYLIST.filter((term) => denyPattern(term).test(haystack))
  if (matchedTerms.length) {
    reasons.push(
      `Possible third-party trademark/brand reference (${matchedTerms.join(', ')}). ` +
        'Requires human IP review before it can go to Etsy.'
    )
  }

  // 2) AI-disclosure enforcement. Default to requiring disclosure unless explicitly non-AI.
  const aiGenerated = input.aiGenerated !== false
  let disclosure: string | undefined
  if (aiGenerated) {
    disclosure = AI_DISCLOSURE
    // We attach the disclosure automatically (see worker), so this never blocks — it just ensures
    // the description carries it. If the description already discloses, we skip the duplicate.
    if (DISCLOSURE_PRESENT.test(input.description || '')) disclosure = undefined
  }

  return { pass: reasons.length === 0, reasons, aiGenerated, disclosure, matchedTerms }
}
