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
  'mlb', 'nhl', 'nascar', 'olympics', 'super bowl', 'taylor swift', 'stanley cup', 'in my era'
]

export const AI_DISCLOSURE =
  'This design is a seller-prompted, AI-assisted creation, directed and curated by ImagineThisPrinted.'

const DISCLOSURE_PRESENT = /seller[- ]prompted|ai[- ]assisted|ai creation|ai-generated art/i

export function runCopyrightGate(input: CopyrightGateInput): CopyrightGateResult {
  const reasons: string[] = []
  const haystack = [input.name, input.description, ...(input.tags || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  // 1) Trademark / brand scan — fail-closed on any hit.
  const matchedTerms = TRADEMARK_DENYLIST.filter((term) => haystack.includes(term))
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
