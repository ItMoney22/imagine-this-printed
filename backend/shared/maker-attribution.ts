// backend/shared/maker-attribution.ts
//
// WHO GETS PAID FOR THIS SALE.
//
// Every dollar ITP takes is synced into the Watchtower ledger by
// david-trinidad-com/src/app/api/revenue/sync, which asks `creditDecision()`
// (david-trinidad-com/src/lib/stripe-revenue.ts) whose balance moves. That
// function reads, in this order:
//
//   1. `metadata.agent_id` / `metadata.watchtower_agent` on the STRIPE CHARGE
//   2. the account's `defaultAgentId` — for ITP that is `rico-fernandez`
//   3. nobody
//
// Nothing in ITP ever wrote step 1, so every ITP sale fell to step 2 and paid
// Rico. On 2026-09-21 the Gothic Ghost Face candle holders — Amelia Chan's
// work — sold and credited Rico. Credits book at 3x to the agent plus 1x to
// their planet, so a misattribution is not a cosmetic label: it moves real
// Watts onto the wrong ledger.
//
// This module is the ITP half of the fix: it decides the `agent_id` a checkout
// stamps, from the makers recorded on the products in the cart.
//
// ── Two facts about Stripe this design rests on (docs.stripe.com/metadata,
//    re-read 2026-09-22, and confirmed against live ITP charges) ────────────
//
//  • PaymentIntent metadata IS copied onto the Charge — "a one-time snapshot"
//    taken when the Charge is created. Live proof: ch_3UErazIK5lihoSZt0s1LLY9B
//    carries `orderId`/`items`, which backend/routes/stripe.ts only ever sets
//    on the PaymentIntent. So stamping the intent is enough; we do not need to
//    chase the charge.
//  • Because that snapshot is taken at CONFIRMATION, a stamp written when the
//    intent was created is only correct if the cart never changed afterwards.
//    ITP's checkout reuses and UPDATES a draft intent as the cart is edited,
//    so the stamp has to be rewritten on every update too — see the
//    `paymentIntents.update` call in backend/routes/stripe.ts.
//
// Metadata limits (same doc): 50 keys per object, 40 chars per key, 500 chars
// per value. `clampMetadataValue` below exists because a value over 500 is a
// hard 400 from Stripe, i.e. a checkout that cannot complete.

/**
 * Every agent id that may be recorded as a product's maker.
 *
 * Generated 2026-09-22 from the live `agent_profiles` table on the Watchtower
 * Supabase project (yrjoblqqgrposgbvsbxm) — the SAME table `creditDecision`
 * validates against. It is a snapshot, not a live read, because ITP and the
 * dashboard are separate Supabase projects and the checkout path must not
 * depend on a second service being up in order to take money.
 *
 * WHAT DRIFT COSTS, in both directions:
 *  • An agent onboarded after this date cannot be picked in the ITP admin
 *    until someone adds the line. Annoying, harmless.
 *  • An agent RETIRED from agent_profiles but still listed here gets stamped,
 *    and `creditDecision` then returns `unknown_agent` — the revenue is still
 *    recorded but NOBODY is credited. That is worse than not stamping at all,
 *    because the account default no longer catches it. Re-sync this list when
 *    the roster changes.
 */
export const MAKER_AGENTS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'ada-brooks', name: 'Ada Brooks' },
  { id: 'amelia-chan', name: 'Amelia Chan' },
  { id: 'chase-valenti', name: 'Chase Valenti' },
  { id: 'christina', name: 'Christina' },
  { id: 'cole-iverson', name: 'Cole Iverson' },
  { id: 'dane-marsh', name: 'Dane Marsh' },
  { id: 'david', name: 'Money' },
  { id: 'dominic-vane', name: 'Dominic Vane' },
  { id: 'dr-dill', name: 'Dr. Dill' },
  { id: 'ethan-dunn', name: 'Ethan Dunn' },
  { id: 'iahhm', name: 'Iahhm' },
  { id: 'jessica-steele', name: 'Jessica Steele' },
  { id: 'jimmy-phix', name: 'Jimmy Phix' },
  { id: 'joshua-knight', name: 'Joshua Knight' },
  { id: 'kai-okafor', name: 'Kai Okafor' },
  { id: 'levi-james', name: 'Levi James' },
  { id: 'lucas-blaze', name: 'Lucas Blaze' },
  { id: 'marcus-wolfe', name: 'Marcus Wolfe' },
  { id: 'mason-blaze', name: 'Mason Blaze' },
  { id: 'mia-potts', name: 'Mia Potts' },
  { id: 'milo-santangelo', name: 'Milo Santangelo' },
  { id: 'nico-reyes', name: 'Nico Reyes' },
  { id: 'pebble', name: 'Pebble' },
  { id: 'penny', name: 'Penny' },
  { id: 'reid-calloway', name: 'Reid Calloway' },
  { id: 'rhea-cassien', name: 'Rhea Cassien' },
  { id: 'rico-fernandez', name: 'Rico Fernandez' },
  { id: 'sal-moretti', name: 'Sal Moretti' },
  { id: 'sifu', name: 'Sifu' },
  { id: 'tessa-lindqvist', name: 'Tessa Hill' },
  { id: 'ty-vale', name: 'Ty Vale' },
  { id: 'vinny-carbone', name: 'Vinny Carbone' },
  { id: 'zero-earth019', name: 'Zero Earth019' },
  { id: 'zero-luna', name: 'Zero Luna' },
  { id: 'zero-mars', name: 'Zero Mars' },
  { id: 'zero-nine', name: 'Zero Nine' },
  { id: 'zero-pluto', name: 'Zero Pluto' },
  { id: 'zero-saturn', name: 'Zero Saturn' },
]

const MAKER_AGENT_IDS: ReadonlySet<string> = new Set(MAKER_AGENTS.map(a => a.id))

/** Shape a Watchtower agent id must have: a lowercase kebab slug. */
const AGENT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The bucket for cart value no maker claims. Never stamped as an agent_id. */
export const HOUSE_SHARE_KEY = 'house'

/** Stripe's hard ceiling on a single metadata value. Over it is a 400. */
export const STRIPE_METADATA_VALUE_MAX = 500

/**
 * `value` if it is a maker id we are willing to stamp, otherwise null.
 *
 * Deliberately strict: an id that is merely slug-SHAPED but absent from the
 * roster is rejected here rather than stamped, because a stamp Watchtower does
 * not recognise costs the credit entirely — `creditDecision` returns
 * `unknown_agent` and does NOT fall back to the account default. Empty,
 * whitespace and the literal strings 'null'/'undefined' — all of which turn up
 * in hand-edited admin data — read as "no maker".
 */
export function normalizeMakerAgentId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const slug = value.trim().toLowerCase()
  if (!slug || slug === 'null' || slug === 'undefined') return null
  if (!AGENT_ID_RE.test(slug)) return null
  return MAKER_AGENT_IDS.has(slug) ? slug : null
}

/** True when `value` may be written to products.maker_agent_id. */
export function isValidMakerAgentId(value: unknown): boolean {
  return normalizeMakerAgentId(value) !== null
}

/** Display name for a maker id, or the id itself if it is off-roster. */
export function makerAgentName(id: string): string {
  return MAKER_AGENTS.find(a => a.id === id)?.name ?? id
}

/**
 * Trim a metadata value to Stripe's 500-character ceiling.
 *
 * Silently losing the tail of a value is bad, but failing the whole checkout
 * with a 400 because one JSON blob ran long is much worse — money is already
 * in flight by then. The ellipsis makes a truncated value obvious in the
 * Dashboard instead of looking like corrupt data.
 */
export function clampMetadataValue(value: string, max: number = STRIPE_METADATA_VALUE_MAX): string {
  if (value.length <= max) return value
  return value.slice(0, max - 1) + '…'
}

/** One cart line, reduced to the only two things attribution cares about. */
export interface MakerLine {
  /** The maker recorded on the PRODUCT ROW — never on the client's cart copy. */
  makerAgentId: string | null
  /** Attribution weight for this line, in cents. See `makerStamp`. */
  weightCents: number
}

/** The metadata keys a checkout adds. Every value is Stripe-safe. */
export interface MakerStamp {
  /** Present only when a maker won the cart. Absent → account default. */
  agent_id?: string
  /** Every maker in the cart, biggest share first, comma separated. */
  maker_agents?: string
  /** `id:bps` pairs summing to 10000, including `house` for unclaimed value. */
  maker_split?: string
  /** '1' when maker_split was cut short to fit Stripe's 500-char ceiling. */
  maker_split_truncated?: string
}

/**
 * Decide the maker attribution metadata for a cart.
 *
 * ── THE MULTI-MAKER POLICY (this is the ruling; it was the open question on
 *    Watchtower task b505062b) ──────────────────────────────────────────────
 *
 * PRIMARY MAKER BY REVENUE SHARE, WITH THE HOUSE AS A PARTICIPANT.
 *
 *  • Each line's weight is added to its maker's pot; lines with no maker go
 *    into the `house` pot.
 *  • The biggest pot wins. If a MAKER wins, `agent_id` is stamped and that
 *    agent is credited for the whole charge. If the HOUSE wins, nothing is
 *    stamped and `creditDecision` falls back to ITP's account default
 *    (rico-fernandez) — the honest answer for a cart that is mostly house
 *    goods, and it stops one $5 add-on from hijacking a $200 order.
 *  • A tie between a maker and the house goes to the maker. A tie between two
 *    makers goes to whichever appeared first in the cart, so the same cart
 *    always produces the same stamp.
 *
 * Why winner-takes-all and not a real split: the ledger credits a CHARGE to
 * ONE agent — `creditDecision` returns a single `agentId`, and the
 * `agent_ledger` row it writes has one `agent_id` column. Splitting a charge
 * across agents is a Watchtower-side change, not an ITP-side one. So ITP
 * stamps the single best answer AND records the full breakdown in
 * `maker_split`, so that if splitting is ever built, the historical charges
 * already carry the numbers to do it retroactively.
 *
 * ── WHAT `weightCents` MUST BE ──────────────────────────────────────────────
 * The CATALOG price times quantity, read server-side from the products table.
 * It is an attribution WEIGHT, not money: it deliberately ignores discounts,
 * shipping, tax, per-size uplifts and bundle pricing, so it will not equal the
 * charge total. That is fine — it only has to rank the makers and record their
 * proportions. Anything reading `maker_split` later must treat the values as
 * RATIOS of the charge, never as dollars.
 */
export function makerStamp(lines: ReadonlyArray<MakerLine>): MakerStamp {
  // Pots in first-seen order, which is what makes ties deterministic.
  const pots = new Map<string, number>()
  for (const line of lines) {
    const weight = Number.isFinite(line.weightCents) ? Math.max(0, Math.round(line.weightCents)) : 0
    if (weight <= 0) continue
    const key = normalizeMakerAgentId(line.makerAgentId) ?? HOUSE_SHARE_KEY
    pots.set(key, (pots.get(key) ?? 0) + weight)
  }

  const total = Array.from(pots.values()).reduce((a, b) => a + b, 0)
  if (total <= 0) return {}

  const entries = Array.from(pots.entries())
  const makers = entries.filter(([id]) => id !== HOUSE_SHARE_KEY)
  if (makers.length === 0) return {}

  const housePot = pots.get(HOUSE_SHARE_KEY) ?? 0
  // Biggest first. Array.prototype.sort is stable, and `entries` is in cart
  // order, so equal pots keep cart order and the tie resolves to the earlier
  // line.
  const rankedMakers = [...makers].sort((a, b) => b[1] - a[1])
  const [topMakerId, topMakerPot] = rankedMakers[0]
  // `>=` is the tie-goes-to-the-maker rule.
  const winner = topMakerPot >= housePot ? topMakerId : null

  // Basis points, with the last entry absorbing the rounding remainder so the
  // split always sums to exactly 10000 and nobody has to wonder about the gap.
  const ranked = [...entries].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    // House last among equals — it is the residual, not a contributor.
    if (a[0] === HOUSE_SHARE_KEY) return 1
    if (b[0] === HOUSE_SHARE_KEY) return -1
    return 0
  })
  let allocated = 0
  const parts: string[] = []
  ranked.forEach(([id, pot], index) => {
    const bps = index === ranked.length - 1
      ? 10000 - allocated
      : Math.round((pot / total) * 10000)
    allocated += bps
    parts.push(`${id}:${bps}`)
  })

  const splitFull = parts.join(',')
  const split = clampMetadataValue(splitFull)
  const stamp: MakerStamp = {
    maker_agents: clampMetadataValue(rankedMakers.map(([id]) => id).join(',')),
    maker_split: split,
  }
  if (split !== splitFull) stamp.maker_split_truncated = '1'
  if (winner) stamp.agent_id = winner
  return stamp
}
