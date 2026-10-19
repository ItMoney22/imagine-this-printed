#!/usr/bin/env node
// Imports REAL Etsy reviews for shop 67055923 into src/data/realReviews.ts.
//   node backend/scripts/import-etsy-reviews.mjs            # rewrite the data file
//   node backend/scripts/import-etsy-reviews.mjs --dry-run  # print, write nothing
//   node backend/scripts/import-etsy-reviews.mjs --with-photos
//
// Needs ETSY_KEYSTRING, ETSY_SHARED_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// (backend/.env). Reviews are public, so the app key alone reads them.
// Quotes are copied verbatim; nothing is edited, filled in or invented.
// Etsy review photos are only included with --with-photos, because a photo
// public on Etsy is not the same as the buyer's OK to reuse it on our site:
// pass the flag only once that permission is documented.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const envFile = process.env.ENV_FILE || path.join(here, '..', '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const SHOP_ID = 67055923
const dryRun = process.argv.includes('--dry-run')
const withPhotos = process.argv.includes('--with-photos')
const { ETSY_KEYSTRING, ETSY_SHARED_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
for (const [k, v] of Object.entries({ ETSY_KEYSTRING, ETSY_SHARED_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) throw new Error(`${k} is not set`)
}

async function fetchAllReviews() {
  const all = []
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(
      `https://api.etsy.com/v3/application/shops/${SHOP_ID}/reviews?limit=100&offset=${offset}`,
      { headers: { 'x-api-key': `${ETSY_KEYSTRING}:${ETSY_SHARED_SECRET}` } },
    )
    if (!res.ok) throw new Error(`Etsy reviews ${res.status}: ${await res.text()}`)
    const body = await res.json()
    all.push(...body.results)
    if (all.length >= body.count || body.results.length === 0) return all
  }
}

async function productIdsByListing() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/etsy_listings?select=listing_id,product_id`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  })
  if (!res.ok) throw new Error(`etsy_listings ${res.status}: ${await res.text()}`)
  return new Map((await res.json()).map((r) => [Number(r.listing_id), r.product_id]))
}

const raw = await fetchAllReviews()
const products = await productIdsByListing()

const reviews = raw
  .filter((r) => r.rating >= 1 && r.review && r.review.trim())
  .map((r) => ({
    sourceRef: `${r.listing_id}-${r.transaction_id}`,
    source: 'etsy',
    etsyListingId: r.listing_id,
    productId: products.get(r.listing_id) ?? null,
    rating: r.rating,
    quote: r.review,
    buyerName: 'Etsy buyer',
    reviewedAt: new Date((r.update_timestamp || r.create_timestamp) * 1000).toISOString().slice(0, 10),
    photos:
      withPhotos && r.image_url_fullxfull
        ? [{ url: r.image_url_fullxfull, permission: 'Etsy review image; buyer permission confirmed by operator' }]
        : [],
  }))

console.log(`Etsy returned ${raw.length} reviews; ${reviews.length} have text and a rating.`)
if (dryRun) {
  console.log(JSON.stringify(reviews, null, 2))
  process.exit(0)
}

const target = path.join(here, '..', '..', 'src', 'data', 'realReviews.ts')
const src = fs.readFileSync(target, 'utf8')
const next = src.replace(/export const REAL_REVIEWS: RealReview\[\] = [\s\S]*$/, `export const REAL_REVIEWS: RealReview[] = ${JSON.stringify(reviews, null, 2)}\n`)
fs.writeFileSync(target, next)
console.log(`Wrote ${reviews.length} reviews to src/data/realReviews.ts`)
