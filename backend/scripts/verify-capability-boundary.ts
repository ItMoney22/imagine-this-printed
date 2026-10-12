// ---------------------------------------------------------------------------
// Capability boundary dry run — Watchtower 72adcc9c.
//
// Proves the three things the acceptance criteria ask for, against the REAL
// modules, with no OpenAI spend, no Replicate spend and no database write:
//
//   1. no polo survives anywhere in Mrs. Imagine's garment path;
//   2. no banned decoration term survives the hard output filter, the QA gate,
//      or the brief parser;
//   3. no metal brief survives while the standing hold is active.
//
// It is a dry run on purpose. A real batch costs image generations and writes
// draft rows to the live products table, which is a spend and a customer-facing
// change — neither of which belongs in a verification step. What this DOES
// exercise is every pure decision the batch makes about capability, which is
// the part the fix changed.
//
//   npx tsx backend/scripts/verify-capability-boundary.ts
//
// Exit code 0 = boundary holds. Non-zero = something got through; the line
// above the failure says exactly what.
// ---------------------------------------------------------------------------

// OFFLINE BY CONSTRUCTION. mrs-imagine.ts and presentation-qa.ts both pull in
// the shared Supabase client, which throws at construction without a URL. This
// run never issues a query, so it is handed placeholders rather than the real
// credentials — that way the script cannot reach production even by accident,
// and it runs on a laptop with no .env at all. The imports below are dynamic
// for the same reason: static ones hoist above this assignment.
process.env.SUPABASE_URL ||= 'https://offline.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'offline-dry-run'
process.env.SUPABASE_ANON_KEY ||= 'offline-dry-run'

const {
  GARMENT_IDS,
  NOT_OFFERED,
  normalizeGarment,
  scanListingCopy,
  assertCopyIsFulfillable,
  findBannedDecorationTerms,
  isLineOnHold,
  heldLines,
  methodForLine,
  BANNED_DECORATION_TERMS,
} = await import('../shared/catalog-capability.js')
const { parseBriefsResponse, dtfPrompt } = await import('../services/mrs-imagine.js')
type DesignBrief = import('../services/mrs-imagine.js').DesignBrief
const { checkSeo, checkCapability } = await import('../services/presentation-qa.js')

let failures = 0
const pass = (m: string) => console.log(`  ok    ${m}`)
const fail = (m: string) => {
  failures++
  console.error(`  FAIL  ${m}`)
}
const check = (ok: boolean, m: string) => (ok ? pass(m) : fail(m))

const LONG =
  'A bold retro sunset emblem with a clean silhouette and dead air around it, ' +
  'limited palette, heavy outline, built to read from across a room.'

const brief = (over: Record<string, unknown> = {}) => ({
  key: 'dry-run',
  garment: 'tshirt',
  buyer: 'hikers in their 30s',
  prompt: LONG,
  priceUsd: 24.99,
  trendBasis: 'top tag this week',
  ...over,
})

console.log('\n1. POLO IS GONE')
check(!(GARMENT_IDS as string[]).includes('polo'), `GarmentType is [${GARMENT_IDS.join(', ')}] — no polo`)
check(normalizeGarment('polo') === null, 'normalizeGarment("polo") is null')
check((NOT_OFFERED as readonly string[]).includes('polo'), 'polo is recorded in NOT_OFFERED')
for (const value of ['polo', 'Polo', 'polo-shirt', 'tank', 'sublimation-garment']) {
  const out = parseBriefsResponse({ garments: [brief({ garment: value })], metal: [] }, { garments: 1, metal: 0 })
  check(out[0]?.garment === 'tshirt', `a "${value}" brief from the brain coerces to tshirt`)
}
for (const id of GARMENT_IDS) {
  const p = dtfPrompt(brief({ garment: id }) as unknown as DesignBrief).toLowerCase()
  check(!p.includes('polo'), `the ${id} render prompt never says polo`)
}

console.log('\n2. BANNED DECORATION VOCABULARY IS REJECTED')
const CLEAN_DESC =
  'A bold retro sunset emblem for anyone who would rather be on a trail.\n\n' +
  'The design is printed with a DTF transfer and heat-pressed onto a soft cotton tee, so the ' +
  'colours stay put wash after wash. Made to order in Georgia and shipped in two to four days. ' +
  'Sizes run S through 3XL with youth sizes on the same listing, and the whole thing is machine ' +
  'washable inside out on cold. An easy gift for the hiker or camper in your life.'
const CLEAN_TAGS = [
  'retro sunset tee', 'mountain graphic tee', 'hiking gift shirt', 'camping tee', 'national park tee',
  'trail lover gift', 'outdoors graphic tee', 'retro mountain shirt', 'hiker gift idea', 'nature lover tee',
  'adventure tshirt', 'sunset graphic tee', 'wilderness shirt',
]
const CLEAN_TITLE = 'Retro Sunset Mountain Emblem Graphic Tee for Hikers'

// The exact words the acceptance criteria name, plus the garments we do not make.
const ADVERSARIAL = [
  'Hand embroidered mountain crest.',
  'Every letter is carefully stitched.',
  'That classic screen print feel.',
  'Cut from durable heat transfer vinyl.',
  'Laser engraved for a lasting finish.',
  'Woven from the softest cotton.',
  'A chunky knit look you will love.',
  'Also available as a polo.',
  'Pairs well with our tank top.',
  'Applied with HTV for a crisp edge.',
]
for (const line of ADVERSARIAL) {
  const dirty = { title: CLEAN_TITLE, description: `${line}\n\n${CLEAN_DESC}`, tags: CLEAN_TAGS }
  const hits = scanListingCopy(dirty)
  check(hits.length > 0, `filter catches: "${line}"`)

  let threw = false
  try {
    assertCopyIsFulfillable(dirty, 'dry run')
  } catch {
    threw = true
  }
  check(threw, `  hard output filter REFUSES the insert for: "${line}"`)

  const seo = checkSeo({ channel: 'etsy', ...dirty })
  check(!seo.ok && seo.findings.some(f => f.severity === 'block'), `  presentation QA BLOCKS it`)
}

// ...and the copy we actually want is untouched by any of it.
const cleanCopy = { title: CLEAN_TITLE, description: CLEAN_DESC, tags: CLEAN_TAGS }
check(scanListingCopy(cleanCopy).length === 0, 'honest DTF copy passes the filter clean')
check(checkSeo({ channel: 'etsy', ...cleanCopy }).ok, 'honest DTF copy passes the QA SEO criterion')

// The filter is called in a loop by the batch runner — a stateful regex would
// let every second listing through.
const repeat = 'Embroidered polo with vinyl accents'
const firstScan = JSON.stringify(findBannedDecorationTerms(repeat))
check(
  Array.from({ length: 10 }, () => JSON.stringify(findBannedDecorationTerms(repeat))).every(s => s === firstScan),
  'the filter is stateless across repeated scans'
)
check(BANNED_DECORATION_TERMS.length >= 14, `${BANNED_DECORATION_TERMS.length} banned terms declared`)

console.log('\n3. THE METAL HOLD IS ENFORCED')
const metalBrief = { key: 'wall-art', buyer: 'cabin owners', prompt: LONG, priceUsd: 45, trendBasis: 'x' }
const held = isLineOnHold('metal-art')
check(held, `metal art is on hold (${heldLines().map(l => l.label).join(', ') || 'nothing held'})`)
if (held) {
  const out = parseBriefsResponse({ garments: [brief()], metal: [metalBrief, metalBrief] }, { garments: 1, metal: 5 })
  check(out.filter(b => b.kind === 'metal').length === 0, 'the brief parser drops every metal brief')
  check(out.filter(b => b.kind === 'garment').length === 1, '...and keeps the garment briefs')
  check(!checkCapability({ category: 'metal-art' }).ok, 'presentation QA BLOCKS a metal-art listing')
  check(checkCapability({ category: 't-shirts' }).ok, '...while apparel still passes')
  check(checkCapability({ category: '3d-prints' }).ok, '...and an unmodelled lane is not blocked on ignorance')
} else {
  fail('ITP_METAL_ART_HOLD is lifted in this environment — the hold path was not exercised')
}

console.log('\n4. EVERY LINE DECLARES A REAL METHOD')
check(methodForLine('apparel')?.id === 'dtf', 'apparel copy declares DTF')
check(methodForLine('metal-art')?.id === 'sublimation', 'metal art declares sublimation')
check(methodForLine('tumblers')?.id === 'uv-dtf', 'tumblers declare UV DTF')
check(!methodForLine('apparel')?.copyPhrase.match(/sublimat/i), 'apparel never claims sublimation')

console.log(
  failures === 0
    ? '\nBOUNDARY HOLDS — no polo, no banned decoration term, no metal brief.\n'
    : `\n${failures} CHECK(S) FAILED — the boundary leaks.\n`
)
process.exit(failures === 0 ? 0 : 1)
