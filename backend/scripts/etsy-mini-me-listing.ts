// Create the Mini-Me Etsy listing (task d76d6501) on the connected shop.
//
//   cd backend
//   npx tsx scripts/etsy-mini-me-listing.ts                      # dry run: prints the listing, touches nothing
//   npx tsx --env-file=.env scripts/etsy-mini-me-listing.ts --create --photos <dir>
//   npx tsx --env-file=.env scripts/etsy-mini-me-listing.ts --create --photos <dir> --activate
//
// --create makes a DRAFT (free, invisible) with the sample photos, the photo-upload
// personalization, the name-on-base question and the 8 priced Size x Colour combos,
// then reads the personalization back to prove the upload question landed.
// --activate also publishes it ($0.20 listing fee, goes live on Etsy).
//
// It refuses to create anything while backend/shared/mini-me.ts still says the
// prices are unapproved, or without photos of the first REAL printed sample (task
// e0c81e3c): never renders or placeholders. Every Etsy limit is checked before the
// first write, because our token has no listings_d scope: a half-built draft can
// only be deleted by hand in Shop Manager.
//
// Needs (with --create): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the Etsy token
// lives in etsy_connection), ETSY_KEYSTRING + ETSY_SHARED_SECRET, and
// ETSY_SHIPPING_PROFILE_ID (or --shipping-profile). ETSY_RETURN_POLICY_ID optional.
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import {
  MINI_ME_PROCESSING_DAYS,
  MINI_ME_TITLE_MARK,
  inventoryProblems,
  miniMeCombos,
  miniMeCopyProblems,
  miniMeDraftListingForm,
  miniMeGoLiveBlockers,
  miniMeInventory,
  miniMeListingCopy,
  miniMePersonalization,
  personalizationProblems
} from '../services/etsy-mini-me-listing.js'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const photoDir = opt('photos')
const photoFiles = photoDir
  ? readdirSync(photoDir).filter(f => statSync(join(photoDir, f)).isFile()).sort().map(f => join(photoDir, f))
  : []

const copy = miniMeListingCopy()
const personalization = miniMePersonalization()
const inventoryPreview = miniMeInventory(0)
const problems = [
  ...miniMeCopyProblems(copy),
  ...personalizationProblems(personalization.personalization_questions),
  ...inventoryProblems(inventoryPreview)
]
const blockers = miniMeGoLiveBlockers({ photoFiles })

console.log(`TITLE (${copy.title.length}): ${copy.title}`)
console.log(`TAGS: ${copy.tags.join(', ')}`)
console.log(`\nDESCRIPTION:\n${copy.description}\n`)
console.log('PERSONALIZATION:')
for (const q of personalization.personalization_questions) {
  console.log(`  - [${q.question_type}${q.required ? ', required' : ''}] ${q.question_text} :: ${q.instructions ?? ''}`
    + (q.max_allowed_files ? ` (up to ${q.max_allowed_files} files)` : '')
    + (q.max_allowed_characters ? ` (up to ${q.max_allowed_characters} chars)` : ''))
}
console.log('\nVARIATIONS (Size x Colour):')
for (const c of miniMeCombos()) console.log(`  ${c.sku.padEnd(17)} ${c.sizeLabel.padEnd(17)} ${c.colourLabel.padEnd(18)} $${(c.priceCents / 100).toFixed(2)}`)
console.log(`\nPHOTOS: ${photoFiles.length ? photoFiles.join(', ') : 'none'}`)
console.log(`RULE PROBLEMS: ${problems.length ? '\n  - ' + problems.join('\n  - ') : 'none'}`)
console.log(`GO-LIVE BLOCKERS: ${blockers.length ? '\n  - ' + blockers.join('\n  - ') : 'none'}`)

if (problems.length) process.exit(1)
if (!flag('create')) {
  console.log('\nDry run only. Add --create --photos <dir> to make the draft.')
  process.exit(0)
}
if (blockers.length) {
  console.error('\nRefusing to create: clear the blockers above first.')
  process.exit(1)
}

const etsy = await import('../services/etsy.js')
const { token, shopId } = await etsy.getAccessToken()
if (!shopId) throw new Error('The connected Etsy account has no shop')

const shippingProfileId = Number(opt('shipping-profile') || process.env.ETSY_SHIPPING_PROFILE_ID)
if (!shippingProfileId) throw new Error('Set ETSY_SHIPPING_PROFILE_ID or pass --shipping-profile <id>')
const returnPolicyId = Number(process.env.ETSY_RETURN_POLICY_ID) || undefined

// One Mini-Me listing per shop: a second would split reviews and sales.
for (const state of ['active', 'draft', 'inactive']) {
  const res = await etsy.etsyFetch(`/application/shops/${shopId}/listings?state=${state}&limit=100`, { token })
  const hit = (res?.results ?? []).find((l: any) => String(l.title || '').startsWith(MINI_ME_TITLE_MARK))
  if (hit) throw new Error(`Mini-Me is already listed: ${hit.listing_id} (${state}) https://www.etsy.com/listing/${hit.listing_id}`)
}

// Processing time: reuse a made-to-order definition with our days, else make one.
const defs = await etsy.etsyFetch(`/application/shops/${shopId}/readiness-state-definitions`, { token })
let readinessStateId: number | undefined = (defs?.results ?? []).find((d: any) =>
  d.readiness_state === 'made_to_order'
  && d.min_processing_days === MINI_ME_PROCESSING_DAYS.min
  && d.max_processing_days === MINI_ME_PROCESSING_DAYS.max)?.readiness_state_id
if (!readinessStateId) {
  const made = await etsy.etsyFetch(`/application/shops/${shopId}/readiness-state-definitions`, {
    method: 'POST',
    token,
    form: {
      readiness_state: 'made_to_order',
      min_processing_time: MINI_ME_PROCESSING_DAYS.min,
      max_processing_time: MINI_ME_PROCESSING_DAYS.max,
      processing_time_unit: 'days'
    }
  })
  readinessStateId = made.readiness_state_id
  console.log(`made readiness state ${readinessStateId} (${MINI_ME_PROCESSING_DAYS.min}-${MINI_ME_PROCESSING_DAYS.max} days)`)
}
const readiness = Number(readinessStateId)

const listing = await etsy.etsyFetch(`/application/shops/${shopId}/listings`, {
  method: 'POST',
  token,
  form: miniMeDraftListingForm({ readinessStateId: readiness, shippingProfileId, returnPolicyId })
})
const listingId: number = listing.listing_id
console.log(`\ndraft listing ${listingId} https://www.etsy.com/listing/${listingId}`)
console.log('(if a later step fails, this draft stays: delete it by hand in Shop Manager)')

for (const file of photoFiles) {
  const buf = readFileSync(file)
  if (buf.byteLength > 10 * 1024 * 1024) throw new Error(`${file} is over Etsy's 10MB image limit`)
  const fd = new FormData()
  fd.append('image', new Blob([buf]), file.split(/[\\/]/).pop() || 'photo.jpg')
  await etsy.etsyFetch(`/application/shops/${shopId}/listings/${listingId}/images`, { method: 'POST', token, multipart: fd })
  console.log(`uploaded ${file}`)
}

await etsy.etsyFetch(
  `/application/shops/${shopId}/listings/${listingId}/personalization?supports_multiple_personalization_questions=true`,
  { method: 'POST', token, json: personalization }
)
await etsy.etsyFetch(`/application/listings/${listingId}/inventory`, { method: 'PUT', token, json: miniMeInventory(readiness) })

// Read back what Etsy stored, not what we sent.
const stored = await etsy.etsyFetch(`/application/listings/${listingId}/personalization`, { token })
const uploads = (stored?.personalization_questions ?? []).filter((q: any) => String(q.question_type).endsWith('upload'))
const inv = await etsy.etsyFetch(`/application/listings/${listingId}/inventory`, { token })
console.log(`stored: ${stored?.personalization_questions?.length ?? 0} questions, ${uploads.length} upload (max ${uploads[0]?.max_allowed_files}), ${inv?.products?.length ?? 0} variation combos`)
if (uploads.length !== 1 || uploads[0].max_allowed_files !== miniMePersonalization().personalization_questions[0].max_allowed_files) {
  throw new Error('Etsy did not store exactly one photo-upload question as sent: check the draft before activating')
}
if ((inv?.products?.length ?? 0) !== miniMeCombos().length) throw new Error('Etsy did not store all 8 variation combos')

if (flag('activate')) {
  await etsy.etsyFetch(`/application/shops/${shopId}/listings/${listingId}`, { method: 'PATCH', token, form: { state: 'active' } })
  console.log(`LIVE: https://www.etsy.com/listing/${listingId}`)
} else {
  console.log('Draft ready. Re-run is refused by the duplicate guard; publish it in Shop Manager or PATCH state=active.')
}
