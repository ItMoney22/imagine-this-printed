// ---------------------------------------------------------------------------
// Design-library importer: walks David's local design bundle
// (E:\Business\Imagine-This-Printed\Imagine This Printed (Designs)),
// uploads each design's transparent PNG to GCS, names/categorizes it with
// OPENAI_VISION_MODEL (detail:low — pennies per design), and creates catalogued
// DRAFT products (status flips per collection via --activate after review).
//
// Every image is stored as a permanent /api/media/<gcs-path> URL (routes/media.ts
// signs it per request) — NOT a 365-day signed URL, which would 403 the whole
// catalog a year after import. The .ai/.svg/.eps originals are uploaded beside
// the PNG so metadata.source_files is reachable off David's machine, and pixel
// dimensions + DPI are recorded so nothing low-res gets catalogued as printable.
//
// Idempotent: each design carries metadata.import_key = its path under
// DESIGN_ROOT minus the ".png" ("Gaming/controller", "8. Fishing/Fishing (50
// Designs)/bass"); re-runs skip anything already imported. The scan is
// recursive — scripts/lib/design-scan.mjs explains why both of those matter.
//
// Usage (from backend/, reads backend/.env):
//   node scripts/import-designs.mjs --dir Gaming --limit 2      # smoke test
//   node scripts/import-designs.mjs --all                       # full run
//   node scripts/import-designs.mjs --all --include-psd         # + layered PSDs (~11 GB)
//   node scripts/import-designs.mjs --all --no-sources          # PNGs only, skip originals
//   node scripts/import-designs.mjs --activate Gaming           # go live
//   node scripts/import-designs.mjs --status                    # counts
// ---------------------------------------------------------------------------
// override:true for the same reason load-env.ts does it — an OS-level
// SUPABASE_SERVICE_ROLE_KEY (David's vault loader exports one) otherwise wins
// over backend/.env and the whole run dies on "Invalid API key".
import dotenv from 'dotenv'
dotenv.config({ override: true })

import fs from 'node:fs'
import path from 'node:path'
import { Storage } from '@google-cloud/storage'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { planImports, groupByCollection } from './lib/design-scan.mjs'
import { stableMediaUrl, readImageStats, uploadSources } from './lib/design-media.mjs'

const DESIGN_ROOT = process.env.DESIGN_LIBRARY_ROOT ||
  'E:\\Business\\Imagine-This-Printed\\Imagine This Printed (Designs)'
const PRICE = Number(process.env.IMPORT_PRICE || 24.99)
const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL']
const COLORS = ['Black', 'White']
const CONCURRENCY = 3
// Anything bigger than this is left on disk with a note in metadata rather than
// stalling a 2,700-design run on one giant PSD.
const SOURCE_MAX_BYTES = Number(process.env.IMPORT_SOURCE_MAX_MB || 300) * 1024 * 1024

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  credentials: process.env.GCS_CREDENTIALS ? JSON.parse(process.env.GCS_CREDENTIALS) : undefined
})
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME || 'imagine-this-printed-main')
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

// gpt-4o-mini is retired from OpenAI's current model + pricing pages (gpt-4
// family hard shutdown 2026-10-23). Sends an image_url, so it reads the shared
// OPENAI_VISION_MODEL var used by the backend services.
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra'
// gpt-5.x/o-series reasoning models reject the legacy `max_tokens` param and
// bill hidden reasoning tokens against the same allowance — hence the bigger
// budget under `max_completion_tokens`.
const isReasoningModel = (m) => /^(o[1-9]|gpt-5)/.test(m)

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null
}

const slugify = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

// "41. American Patriots vol2" / "Gaming (100 designs)" → "American Patriots vol2" / "Gaming"
const cleanCollection = (dir) => dir.replace(/^\d+\.\s*/, '').replace(/\s*\(\d+\s*designs?\)\s*$/i, '').trim()

async function nameDesign(pngPath, collection) {
  const fallback = {
    title: `${collection} Design ${path.basename(pngPath, '.png')}`,
    description: `${collection}-themed design, custom printed by Imagine This Printed.`,
    tags: [collection.toLowerCase()]
  }
  if (!openai) return fallback
  try {
    const b64 = fs.readFileSync(pngPath).toString('base64')
    const completion = await openai.chat.completions.create({
      model: OPENAI_VISION_MODEL,
      response_format: { type: 'json_object' },
      ...(isReasoningModel(OPENAI_VISION_MODEL) ? { max_completion_tokens: 900 } : { max_tokens: 300 }),
      messages: [
        {
          role: 'system',
          content: 'You name t-shirt designs for an ecommerce catalog. Look at the design image and reply ONLY with JSON: ' +
            '{"title": string (catchy 3-7 word product name reflecting the design text/imagery, no quotes-in-quotes, no "T-Shirt" suffix), ' +
            '"description": string (1-2 sentences, natural, mentions what the design shows), ' +
            '"tags": string[] (5-8 lowercase search tags)}. Never invent brand names.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Collection theme: ${collection}` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'low' } }
          ]
        }
      ]
    })
    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}')
    if (!parsed.title) return fallback
    return {
      title: String(parsed.title).slice(0, 90),
      description: String(parsed.description || fallback.description).slice(0, 500),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 8) : fallback.tags
    }
  } catch (err) {
    // A bad OPENAI_VISION_MODEL (unknown id, or a param the model rejects)
    // fails on EVERY image, so the whole run silently produces mechanical
    // "Collection Design <file-id>" names that look like real output. Call
    // that out as the config bug it is instead of burying it per-image.
    if (err?.status === 400 || err?.status === 404) {
      console.error(
        `  [ai] MODEL CONFIG ERROR — OPENAI_VISION_MODEL="${OPENAI_VISION_MODEL}" rejected the request ` +
        `(${err.status}: ${err.message}). Every design will fall back to mechanical naming. Fix the model id and re-run.`
      )
    } else {
      console.error(`  [ai] naming failed for ${path.basename(pngPath)} (${err.message}) — using fallback`)
    }
    return fallback
  }
}

async function uploadPng(pngPath, dest) {
  const file = bucket.file(dest)
  const buffer = fs.readFileSync(pngPath)
  await file.save(buffer, {
    contentType: 'image/png',
    resumable: false,
    metadata: { cacheControl: 'public, max-age=31536000, immutable' }
  })
  // Permanent address. The signature is minted per request by routes/media.ts,
  // so this URL keeps working long after any signed URL would have expired.
  const image = await readImageStats(buffer).catch(err => {
    console.error(`  [dims] could not measure ${path.basename(pngPath)}: ${err.message}`)
    return null
  })
  return { publicUrl: stableMediaUrl(dest), path: dest, image }
}

async function loadExisting() {
  const keys = new Set()
  const slugs = new Set()
  let from = 0
  for (;;) {
    // .order() is not decoration: PostgREST pagination without a stable sort
    // can hand back the same row twice across pages and drop another, so some
    // already-imported keys would never load and the next run would insert
    // them a second time. Ordering by id is what makes the skip reliable.
    const { data, error } = await supabase
      .from('products')
      .select('slug, metadata')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`preload failed: ${error.message}`)
    for (const row of data || []) {
      if (row.slug) slugs.add(row.slug)
      if (row.metadata?.import_key) keys.add(row.metadata.import_key)
    }
    if (!data || data.length < 1000) break
    from += 1000
  }
  return { keys, slugs }
}

function uniqueSlug(base, slugs) {
  let s = base || 'design'
  let n = 2
  while (slugs.has(s)) s = `${base}-${n++}`
  slugs.add(s)
  return s
}

async function importDesign(design, existing, stats) {
  const { importKey, designId, collectionDir, subDirs, dirPath, fullPath: pngPath } = design
  if (existing.keys.has(importKey)) { stats.skipped++; return }

  const collection = cleanCollection(collectionDir)
  const collectionSlug = slugify(collection)
  // Nested folders survive into the object name too. Without them two designs
  // called "bass.png" in sibling subfolders of one collection would upload to
  // the same GCS object and the second would silently overwrite the first.
  const storageId = [...subDirs.map(slugify), designId].join('/')

  const [named, uploaded] = await Promise.all([
    nameDesign(pngPath, collection),
    uploadPng(pngPath, `design-library/${collectionSlug}/${storageId}.png`)
  ])

  // Originals go to GCS too — recording the E:\ path made metadata.source_files
  // useless to anyone but the machine that ran the import.
  let sourceFiles = {}
  let sourcesSkipped = []
  if (!flag('no-sources')) {
    try {
      const uploadedSources = await uploadSources(bucket, {
        dirPath,
        designId,
        collectionSlug,
        includePsd: flag('include-psd'),
        maxBytes: SOURCE_MAX_BYTES
      })
      sourceFiles = uploadedSources.sourceFiles
      sourcesSkipped = uploadedSources.skipped
    } catch (err) {
      console.error(`  [sources] upload failed for ${importKey}: ${err.message}`)
    }
  }

  const slug = uniqueSlug(slugify(named.title), existing.slugs)
  const { data: product, error } = await supabase
    .from('products')
    .insert({
      name: named.title,
      slug,
      description: named.description,
      price: PRICE,
      images: [uploaded.publicUrl],
      category: 'shirts',
      status: 'draft',
      print_locations: ['front_image'],
      sizes: SIZES,
      colors: COLORS,
      is_user_generated: false,
      metadata: {
        import_source: 'design-library',
        import_key: importKey,
        collection,
        design_id: designId,
        gcs_path: uploaded.path,
        source_files: sourceFiles,
        ...(sourcesSkipped.length ? { source_files_skipped: sourcesSkipped } : {}),
        image: uploaded.image,
        ai_tags: named.tags,
        media_version: 2,
        imported_at: new Date().toISOString()
      }
    })
    .select('id')
    .single()
  if (error) throw new Error(`insert failed for ${importKey}: ${error.message}`)

  const tags = [...new Set([...named.tags, collection.toLowerCase()])]
  await supabase.from('product_tags').insert(tags.map(tag => ({ product_id: product.id, tag })))

  existing.keys.add(importKey)
  stats.imported++
}

async function run() {
  if (flag('status')) {
    const { data } = await supabase
      .from('products')
      .select('status, metadata')
      .eq('metadata->>import_source', 'design-library')
    const byCollection = {}
    for (const p of data || []) {
      const c = p.metadata?.collection || '?'
      byCollection[c] = byCollection[c] || { draft: 0, active: 0 }
      byCollection[c][p.status === 'active' ? 'active' : 'draft']++
    }
    console.table(byCollection)
    console.log(`total imported: ${(data || []).length}`)
    return
  }

  const activate = opt('activate')
  if (activate) {
    const { data, error } = await supabase
      .from('products')
      .update({ status: 'active' })
      .eq('metadata->>import_source', 'design-library')
      .ilike('metadata->>collection', `%${activate}%`)
      .eq('status', 'draft')
      .select('id')
    if (error) throw new Error(error.message)
    console.log(`✅ Activated ${data?.length ?? 0} products in collections matching "${activate}" (SEO packs generate on the worker's next hourly sweep)`)
    return
  }

  const dirFilter = opt('dir')
  const limit = Number(opt('limit') || 0)

  const existing = await loadExisting()
  console.log(`Preloaded ${existing.keys.size} already-imported keys, ${existing.slugs.size} slugs`)

  // Recursive: 22 of 56 collection folders nest their designs one level deeper
  // and the old readdirSync(<collection>) walk skipped all 1,392 of them.
  const plan = planImports(DESIGN_ROOT, existing.keys, { dirFilter, limit })
  const byCollection = groupByCollection(plan)
  if (!plan.length) {
    console.log(dirFilter
      ? `Nothing to import: no new designs under a collection matching "${dirFilter}" (check the spelling, or everything already imported).`
      : 'Nothing to import — every PNG under DESIGN_ROOT is already in the catalogue.')
    return
  }

  const sourceMode = flag('no-sources')
    ? 'skipped'
    : flag('include-psd') ? 'vectors + PSD' : 'vectors + jpg (PSD skipped, pass --include-psd)'
  console.log(`Importing ${plan.length} new design(s) from ${byCollection.size} collection(s)${limit ? ` (limit ${limit}/collection)` : ''} — price $${PRICE}, status draft`)
  console.log(`Image URLs: permanent ${stableMediaUrl('design-library')}/<collection>/<design>.png · original sources: ${sourceMode}`)

  const stats = { imported: 0, skipped: 0, failed: 0 }
  const started = Date.now()

  for (const [dir, designs] of byCollection) {
    console.log(`\n📁 ${dir} — ${designs.length} design(s)`)
    for (let i = 0; i < designs.length; i += CONCURRENCY) {
      await Promise.all(designs.slice(i, i + CONCURRENCY).map(design =>
        importDesign(design, existing, stats).catch(err => {
          stats.failed++
          console.error(`  ❌ ${design.relPath}: ${err.message}`)
        })
      ))
      const done = stats.imported + stats.skipped + stats.failed
      if (done % 25 < CONCURRENCY) console.log(`  … ${stats.imported} imported / ${stats.skipped} skipped / ${stats.failed} failed (${Math.round((Date.now() - started) / 1000)}s)`)
    }
  }

  console.log(`\n✅ DONE: ${stats.imported} imported, ${stats.skipped} skipped (already in), ${stats.failed} failed, ${Math.round((Date.now() - started) / 60000)} min`)
  console.log('Products are DRAFT. Review in /admin?tab=products, then: node scripts/import-designs.mjs --activate "<collection>"')
}

run().catch(err => { console.error('FATAL:', err); process.exit(1) })
